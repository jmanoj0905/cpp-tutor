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

// --- Synthetic trace: leaf-recursion fill with an unrelated 2-occurrence debug
// line immediately before the write, no memoization guard. ---
// Every leaf-recursion write (single visit per invocation, no loop) lands
// "first time at the write line" in its own frame, so the guard-line fallback
// picks whatever line ran right before it. Here that's a debug printf that
// happens to read arr[n-1] AND arr[n] (2 occurrences) but is never gated by a
// self-lookup ("return"-free) and never derives the write from a prior value
// of the array (arr[n] = n * n does not depend on arr[n-1]). Must be rejected.
const fillCode = `#include <cstdio>
int fill(int n, int arr[]) {
  if (n == 0) return 0;
  fill(n - 1, arr);
  printf("dbg %d %d\\n", arr[n - 1], arr[n]);
  arr[n] = n * n;
  return 0;
}
int main() {
  int arr[5];
  fill(4, arr);
  printf("%d\\n", arr[4]);
  return 0;
}`;

type FillArr = (number | "<UNINITIALIZED>")[];
interface RawFrame { func_name: string; frame_id: string; unique_hash: string; encoded_locals: Record<string, unknown>;
  ordered_varnames: string[]; is_highlighted: boolean; is_parent: boolean; is_zombie: boolean; line: number;
  parent_frame_id_list: string[]; }

function fillTrace(): ExecPoint[] {
  const arr: FillArr = ["<UNINITIALIZED>", "<UNINITIALIZED>", "<UNINITIALIZED>", "<UNINITIALIZED>", "<UNINITIALIZED>"];

  const mainFrame = (): RawFrame => ({
    func_name: "main", frame_id: "main_0xB00_0", unique_hash: "main_0xB00_0",
    encoded_locals: { arr: ["C_ARRAY", "0x2000", ...arr.map((v, k) => ["C_DATA", `0x${(0x2000 + 4 * k).toString(16)}`, "int", v])] },
    ordered_varnames: ["arr"], is_highlighted: false, is_parent: true, is_zombie: false, line: 0, parent_frame_id_list: [],
  });
  const fillFrame = (depth: number, n: number): RawFrame => ({
    func_name: "fill(int, int*)", frame_id: `fill_0xF00${depth}`, unique_hash: `fill_0xF00${depth}`,
    encoded_locals: { n: ["C_DATA", `0x9${depth}0`, "int", n] }, ordered_varnames: ["n"],
    is_highlighted: true, is_parent: false, is_zombie: false, line: 0, parent_frame_id_list: [],
  });
  const stackFrames = (nStack: number[]): RawFrame[] =>
    [mainFrame(), ...nStack.map((n, i) => fillFrame(i + 1, n))];
  const point = (line: number, frames: RawFrame[]): ExecPoint => ({
    line, event: "step_line", func_name: frames.at(-1)!.func_name, stack_to_render: frames,
    heap: {}, globals: {}, ordered_globals: [], stdout: "",
  });

  const points: ExecPoint[] = [point(10, [mainFrame()]), point(11, [mainFrame()])];

  const recurse = (nStack: number[]) => {
    const n = nStack.at(-1)!;
    points.push(point(3, stackFrames(nStack))); // guard: if (n == 0) return 0;
    if (n === 0) return; // base case returns immediately, no write
    points.push(point(4, stackFrames(nStack))); // about to call fill(n - 1, arr)
    recurse([...nStack, n - 1]);
    points.push(point(5, stackFrames(nStack))); // back from recursion; about to printf
    points.push(point(6, stackFrames(nStack))); // printf ran; about to assign
    arr[n] = n * n;
    points.push(point(7, stackFrames(nStack))); // assignment ran (write now visible); about to return
  };
  recurse([4]);

  points.push(point(12, [mainFrame()]), point(13, [mainFrame()]));
  return points;
}

// --- Synthetic trace: leaf-recursion fill with a bounds-validation guard, not
// a memoization guard, immediately before the write. ---
// The guard has "return" AND 2 subscript occurrences on one line — same shape
// as a real memo guard (`if (memo[n] != -1) return memo[n];`) — but the
// returned expression is a sentinel (-1), not the array's own subscript. A
// check that only requires "return" to appear *somewhere* on the guard line
// (round 2's fix) cannot tell this apart from a real memo short-circuit; only
// checking that "return" is immediately followed by the array's own
// subscript can. Must be rejected.
const boundsGuardCode = `#include <cstdio>
int fill(int n, int arr[]) {
  if (n == 0) return 0;
  fill(n - 1, arr);
  if (arr[n] < 0 || arr[n] > 100) return -1;
  arr[n] = n * n;
  return 0;
}
int main() {
  int arr[5];
  fill(4, arr);
  printf("%d\\n", arr[4]);
  return 0;
}`;

function boundsGuardTrace(): ExecPoint[] {
  const arr: FillArr = ["<UNINITIALIZED>", "<UNINITIALIZED>", "<UNINITIALIZED>", "<UNINITIALIZED>", "<UNINITIALIZED>"];

  const mainFrame = (): RawFrame => ({
    func_name: "main", frame_id: "main_0xB00_0", unique_hash: "main_0xB00_0",
    encoded_locals: { arr: ["C_ARRAY", "0x2000", ...arr.map((v, k) => ["C_DATA", `0x${(0x2000 + 4 * k).toString(16)}`, "int", v])] },
    ordered_varnames: ["arr"], is_highlighted: false, is_parent: true, is_zombie: false, line: 0, parent_frame_id_list: [],
  });
  const fillFrame = (depth: number, n: number): RawFrame => ({
    func_name: "fill(int, int*)", frame_id: `fill_0xF00${depth}`, unique_hash: `fill_0xF00${depth}`,
    encoded_locals: { n: ["C_DATA", `0x9${depth}0`, "int", n] }, ordered_varnames: ["n"],
    is_highlighted: true, is_parent: false, is_zombie: false, line: 0, parent_frame_id_list: [],
  });
  const stackFrames = (nStack: number[]): RawFrame[] =>
    [mainFrame(), ...nStack.map((n, i) => fillFrame(i + 1, n))];
  const point = (line: number, frames: RawFrame[]): ExecPoint => ({
    line, event: "step_line", func_name: frames.at(-1)!.func_name, stack_to_render: frames,
    heap: {}, globals: {}, ordered_globals: [], stdout: "",
  });

  const points: ExecPoint[] = [point(10, [mainFrame()]), point(11, [mainFrame()])];

  const recurse = (nStack: number[]) => {
    const n = nStack.at(-1)!;
    points.push(point(3, stackFrames(nStack))); // guard: if (n == 0) return 0;
    if (n === 0) return; // base case returns immediately, no write
    points.push(point(4, stackFrames(nStack))); // about to call fill(n - 1, arr)
    recurse([...nStack, n - 1]);
    points.push(point(5, stackFrames(nStack))); // back from recursion; about to bounds-check
    points.push(point(6, stackFrames(nStack))); // bounds-check ran (passed); about to assign
    arr[n] = n * n;
    points.push(point(7, stackFrames(nStack))); // assignment ran (write now visible); about to return
  };
  recurse([4]);

  points.push(point(12, [mainFrame()]), point(13, [mainFrame()]));
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

  it("rejects leaf recursion whose pre-write line reads the array but isn't a memo guard", () => {
    // Regression: guard-line evidence requires the literal memoization idiom
    // (an early "return" gated on a self-lookup), not just any executed line
    // with >= 2 subscript occurrences. A debug printf reading arr[n-1] and
    // arr[n] right before a non-derived write (arr[n] = n * n) must not count.
    expect(detectDpTables(fillTrace(), fillCode)).toEqual([]);
  });

  it("rejects a bounds-validation guard that has \"return\" and 2 occurrences but returns a sentinel", () => {
    // Regression: `if (arr[n] < 0 || arr[n] > 100) return -1;` has "return"
    // AND 2 subscript occurrences on one line, same shape as a real memo
    // guard — but it returns -1, not arr[n]. Only a guard that hands back the
    // array's OWN subscripted value right after "return" is a memo
    // short-circuit; this must not be credited as self-reference evidence.
    expect(detectDpTables(boundsGuardTrace(), boundsGuardCode)).toEqual([]);
  });
});
