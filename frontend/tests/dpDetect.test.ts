import { describe, expect, it } from "vitest";
import climbBottomup from "./fixtures/dp/climb-bottomup.json";
import climbTopdown from "./fixtures/dp/climb-topdown.json";
import gridPaths from "./fixtures/dp/grid-paths.json";
import inputFill from "./fixtures/dp/input-fill.json";
import type { ExecPoint, Trace } from "../src/types/trace";
import { detectDpTables } from "../src/viz/dp/detect";

const detect = (t: Trace) => detectDpTables(t.trace, t.code);

// --- Synthetic trace: unrelated read on the line before a plain fill write. ---
// A non-DP program whose source text happens to place a 1-occurrence read line
// (printf of arr[i-1]) directly above a 1-occurrence write line (arr[i] = i*i).
// Summing subscript occurrences across source-adjacent lines would call this
// self-referential (1 + 1 >= 2) — a false positive. Detection must reject it.
// Point semantics mirror real traces: point.line = next line to execute; a write
// becomes visible at step s and was performed by trace[s - 1].line.
const printfFillCode = `#include <cstdio>
int main() {
  int n = 4;
  int arr[5];
  for (int i = 1; i <= n; i++) {
    printf("prev=%d\\n", arr[i - 1]);
    arr[i] = i * i;
  }
  printf("%d\\n", arr[n]);
  return 0;
}`;

type SyntheticLocals = { n?: number; i?: number; arr: (number | "<UNINITIALIZED>")[] };

function printfFillPoint(line: number, locals: SyntheticLocals): ExecPoint {
  const encoded: Record<string, unknown> = { arr: [
    "C_ARRAY", "0x2000",
    ...locals.arr.map((v, k) => ["C_DATA", `0x${(0x2000 + 4 * k).toString(16)}`, "int", v]),
  ] };
  const ordered = ["arr"];
  if (locals.n !== undefined) { encoded.n = ["C_DATA", "0x1000", "int", locals.n]; ordered.push("n"); }
  if (locals.i !== undefined) { encoded.i = ["C_DATA", "0x1004", "int", locals.i]; ordered.push("i"); }
  return {
    line, event: "step_line", func_name: "main",
    stack_to_render: [{
      func_name: "main", frame_id: "0xFFF000B00_0", unique_hash: "main_0xFFF000B00_0",
      encoded_locals: encoded, ordered_varnames: ordered,
      is_highlighted: true, is_parent: false, is_zombie: false, line,
      parent_frame_id_list: [],
    }],
    heap: {}, globals: {}, ordered_globals: [], stdout: "",
  };
}

function printfFillTrace(): ExecPoint[] {
  const U = "<UNINITIALIZED>" as const;
  const arr: (number | "<UNINITIALIZED>")[] = [U, U, U, U, U];
  const points: ExecPoint[] = [
    printfFillPoint(2, { arr: [...arr] }),                 // about to enter body
    printfFillPoint(3, { arr: [...arr] }),                 // locals materialized
    printfFillPoint(4, { n: 4, arr: [...arr] }),           // n assigned
    printfFillPoint(5, { n: 4, arr: [...arr] }),           // arr declared; at for
  ];
  for (let i = 1; i <= 4; i++) {
    points.push(printfFillPoint(6, { n: 4, i, arr: [...arr] })); // about to printf
    points.push(printfFillPoint(7, { n: 4, i, arr: [...arr] })); // printf ran; about to write
    arr[i] = i * i;                                              // line 7 executes...
    points.push(printfFillPoint(5, { n: 4, i, arr: [...arr] })); // ...write visible here
  }
  points.push(printfFillPoint(9, { n: 4, arr: [...arr] }));
  points.push(printfFillPoint(10, { n: 4, arr: [...arr] }));
  return points;
}

describe("detectDpTables", () => {
  it("climb-bottomup: confirms dp as 1D bottom-up with chronological writes", () => {
    const [c, ...rest] = detect(climbBottomup as Trace);
    expect(rest).toEqual([]);
    expect(c.name).toBe("dp");
    expect(c.mode).toBe("bottom-up");
    expect(c.dims).toEqual([7]);
    expect(c.writes.length).toBeGreaterThanOrEqual(5); // dp[2..6] at least
    const steps = c.writes.map((w) => w.step);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(c.writes.at(-1)!.coord).toEqual([6]);
  });

  it("climb-topdown: confirms memo as top-down", () => {
    const [c] = detect(climbTopdown as Trace);
    expect(c.name).toBe("memo");
    expect(c.mode).toBe("top-down");
  });

  it("grid-paths: confirms dp as 2D with [3,4] dims and 2D coords", () => {
    const [c] = detect(gridPaths as Trace);
    expect(c.dims).toEqual([3, 4]);
    expect(c.writes.at(-1)!.coord).toEqual([2, 3]);
  });

  it("input-fill: confirms nothing (no self-reads)", () => {
    expect(detect(inputFill as Trace)).toEqual([]);
  });

  it("rejects an unrelated read on the source line above a plain fill write", () => {
    // Regression: evidence must come from single lines that actually executed
    // (write line, or the guard line run just before it), never from summing
    // occurrences across source-adjacent lines.
    expect(detectDpTables(printfFillTrace(), printfFillCode)).toEqual([]);
  });
});
