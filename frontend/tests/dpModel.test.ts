import { describe, expect, it } from "vitest";
import climbBottomup from "./fixtures/dp/climb-bottomup.json";
import climbTopdown from "./fixtures/dp/climb-topdown.json";
import gridPaths from "./fixtures/dp/grid-paths.json";
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

  it("on the recurrence line about to execute: write target coord is absent from reads", () => {
    // Bug: detect.ts records a write as visible one step AFTER the line that
    // performed it executes, so at the step where `dp[i] = dp[i-1]+dp[i-2];`
    // is about to run, `currentWrite` is still null for THIS step (the write
    // shows up next step). The naive currentWrite-based exclusion in
    // buildDpView never fires here, so dp[i] (the write target) leaked into
    // `reads` alongside the real operand reads dp[i-1] and dp[i-2].
    const step = t.trace.findIndex((p) => {
      const env = intEnv(p);
      const i = env.get("i");
      return i !== undefined && i >= 2 &&
        (codeLines[p.line - 1] ?? "").includes("dp[i - 1]");
    });
    expect(step).toBeGreaterThan(0);
    const v = viewAt(step);
    const i = intEnv(t.trace[step]).get("i")!;
    expect(v.reads).not.toContainEqual([i]);
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

describe("buildDpView: top-down/recursive table (climb-topdown fixture)", () => {
  // Round 2 fix regression: detect.ts records a recursive/top-down write's
  // coord many steps after the assignment line that produced it executes
  // (the write isn't visible until the recursive calls on the RHS unwind),
  // so neither the currentWrite- nor the "step + 1"-based exclusion in
  // buildDpView can catch the write target here. The structural
  // isAssignmentLhs check must exclude it independent of write-visibility
  // timing.
  const td = climbTopdown as Trace;
  const tdCodeLines = td.code.split("\n");
  const [tdCand] = detectDpTables(td.trace, td.code);

  const tdViewAt = (step: number) =>
    buildDpView(tdCand, step, td.trace[step], normalizeMemory(td.trace[step]), tdCodeLines);

  it("at step 8 (n=6, memo[n] = solve(...) + solve(...) about to execute): write target [6] absent from reads", () => {
    const step = 8;
    const env = intEnv(td.trace[step]);
    const n = env.get("n");
    expect(n).toBe(6);
    expect(tdCodeLines[td.trace[step].line - 1]).toContain("memo[n] = solve(n - 1, memo) + solve(n - 2, memo);");
    const v = tdViewAt(step);
    expect(v.reads).not.toContainEqual([6]);
  });
});

describe("buildDpView: 2D table (grid-paths fixture)", () => {
  const g = gridPaths as Trace;
  const gCodeLines = g.code.split("\n");
  const [gCand] = detectDpTables(g.trace, g.code);

  const gViewAt = (step: number) =>
    buildDpView(gCand, step, g.trace[step], normalizeMemory(g.trace[step]), gCodeLines);

  it("row-major full dims: 3x4 grid produces 12 cells, indexed [r*4+c]", () => {
    const v = gViewAt(0);
    expect(v.cells).toHaveLength(12);
    expect(v.cells[0].coord).toEqual([0, 0]);
    expect(v.cells[3].coord).toEqual([0, 3]);
    expect(v.cells[4].coord).toEqual([1, 0]);
    expect(v.cells[11].coord).toEqual([2, 3]);
  });

  it("on the recurrence line about to execute: write target [i,j] absent from reads, operands [i-1,j] and [i,j-1] present", () => {
    // step 5: i=1, j=1, about to run `dp[i][j] = dp[i - 1][j] + dp[i][j - 1];`
    // The write for [1,1] becomes visible next step, not this one — same
    // detect.ts off-by-one-step behavior as the 1D case, exercised here
    // through the 2D leafAt/cells path.
    const step = g.trace.findIndex((p) => {
      const env = intEnv(p);
      const i = env.get("i");
      const j = env.get("j");
      return i !== undefined && j !== undefined && i >= 1 && j >= 1 &&
        (gCodeLines[p.line - 1] ?? "").includes("dp[i - 1][j]");
    });
    expect(step).toBeGreaterThan(0);
    const v = gViewAt(step);
    const env = intEnv(g.trace[step]);
    const i = env.get("i")!;
    const j = env.get("j")!;
    expect(v.reads).not.toContainEqual([i, j]);
    expect(v.reads).toContainEqual([i - 1, j]);
    expect(v.reads).toContainEqual([i, j - 1]);
  });

  it("final step: all dp cells written, corner value present", () => {
    let last = g.trace.length - 1;
    for (let s = g.trace.length - 1; s >= 0; s--) {
      const top = g.trace[s].stack_to_render.at(-1) as
        | { encoded_locals?: Record<string, unknown> } | undefined;
      if (top?.encoded_locals && gCand.name in top.encoded_locals) { last = s; break; }
    }
    const v = gViewAt(last);
    expect(v.cells.filter((c) => c.writeStep !== null).length).toBeGreaterThanOrEqual(10);
    expect(v.cells[11].value).not.toBe("?");
  });
});
