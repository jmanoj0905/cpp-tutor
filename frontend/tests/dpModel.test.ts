import { describe, expect, it } from "vitest";
import climbBottomup from "./fixtures/dp/climb-bottomup.json";
import type { Trace } from "../src/types/trace";
import { normalizeMemory } from "../src/viz/memoryModel";
import { detectDpTables } from "../src/viz/dp/detect";
import { buildDpView, intEnv } from "../src/viz/dp/dpModel";

const t = climbBottomup as Trace;
const codeLines = t.code.split("\n");
const [cand] = detectDpTables(t.trace, t.code);

const viewAt = (step: number) =>
  buildDpView(cand, step, t.trace[step], normalizeMemory(t.trace[step]), codeLines);

describe("buildDpView", () => {
  it("before first write: all cells ghosts (writeStep null), no currentWrite", () => {
    const v = viewAt(0);
    expect(v.cells).toHaveLength(7);
    expect(v.cells.every((c) => c.writeStep === null)).toBe(true);
    expect(v.currentWrite).toBeNull();
  });

  it("at a recorded write step: currentWrite set, that cell's writeStep === step", () => {
    const w = cand.writes.find((w) => w.coord[0] === 4)!;
    const v = viewAt(w.step);
    expect(v.currentWrite).toEqual([4]);
    expect(v.cells[4].writeStep).toBe(w.step);
    expect(v.cells[3].writeStep).not.toBeNull(); // earlier write persists
  });

  it("on the recurrence line with i in scope: reads are [i-1] and [i-2]", () => {
    // find a step whose executing line is the recurrence and i is an int local
    const step = t.trace.findIndex((p, s) => {
      const env = intEnv(p);
      const i = env.get("i");
      return i !== undefined && i >= 2 &&
        (codeLines[p.line - 1] ?? "").includes("dp[i - 1]");
    });
    expect(step).toBeGreaterThan(0);
    const v = viewAt(step);
    const i = intEnv(t.trace[step]).get("i")!;
    expect(v.reads).toContainEqual([i - 1]);
    expect(v.reads).toContainEqual([i - 2]);
  });

  it("final step: all dp cells written, values present", () => {
    // The true last trace index is a "return" event: `dp` has already gone
    // out of scope (main's encoded_locals collapses to just `__return__`),
    // so buildDpView — deliberately stateless, given only this step's point
    // and mem — has nothing to read there. Use the last step where `dp` is
    // still an in-scope local, which is where the fully-computed table is
    // actually observable.
    let last = t.trace.length - 1;
    for (let s = t.trace.length - 1; s >= 0; s--) {
      const top = t.trace[s].stack_to_render.at(-1) as
        | { encoded_locals?: Record<string, unknown> } | undefined;
      if (top?.encoded_locals && cand.name in top.encoded_locals) { last = s; break; }
    }
    const v = viewAt(last);
    expect(v.cells.filter((c) => c.writeStep !== null).length).toBeGreaterThanOrEqual(5);
    expect(v.cells[6].value).toBe("13"); // fib-style climb(6)
  });
});
