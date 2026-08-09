import { describe, expect, it } from "vitest";
import gridPaths from "./fixtures/dp/grid-paths.json";
import climbBottomup from "./fixtures/dp/climb-bottomup.json";
import memoFib from "./fixtures/dp/memo-fib-vector.json";
import type { Trace } from "../src/types/trace";
import { detectDpTables } from "../src/viz/dp/detect";
import { explainWrite } from "../src/viz/dp/provenance";

const grid = gridPaths as Trace;
const gridLines = grid.code.split("\n");
const [gridCand] = detectDpTables(grid.trace, grid.code);
const gridWrite = (r: number, c: number) =>
  gridCand.writes.find((w) => w.coord[0] === r && w.coord[1] === c)!;

describe("explainWrite — statement and single operand", () => {
  it("resolves the table's own subscripts to concrete indices", () => {
    // grid-paths line 8: dp[i][j] = dp[i - 1][j] + dp[i][j - 1];  at i=1, j=1
    const w = gridWrite(1, 1);
    const p = explainWrite(gridCand, [1, 1], w.step, grid.trace, gridLines)!;
    expect(p).not.toBeNull();
    expect(p.lhs).toBe("dp[1][1]");
    expect(p.assign).toBe("=");
    expect(p.rhs).toBe("dp[0][1]+ dp[1][0]");
    expect(p.operands).toHaveLength(1);
    expect(p.operands[0].value).toBe(2);
    expect(p.written).toBe("2");
    expect(p.baseCase).toBe(false);
  });

  it("reads the written value at the write step, not at some later step", () => {
    const w = gridWrite(1, 1);
    const p = explainWrite(gridCand, [1, 1], w.step, grid.trace, gridLines)!;
    expect(p.written).toBe("2");
  });

  it("tags a seed write as a base case", () => {
    // grid-paths line 4: for (int j = 0; j < 4; j++) dp[0][j] = 1;
    const w = gridWrite(0, 2);
    const p = explainWrite(gridCand, [0, 2], w.step, grid.trace, gridLines)!;
    expect(p.lhs).toBe("dp[0][2]");
    expect(p.rhs).toBe("1");
    expect(p.operands[0].value).toBe(1);
    expect(p.baseCase).toBe(true);
  });

  it("does not tag a write whose operands hide behind calls as a base case", () => {
    // memo-fib-vector line 14: dp[n] = fib(n-1, dp) + fib(n-2, dp);
    const t = memoFib as Trace;
    const lines = t.code.split("\n");
    const [cand] = detectDpTables(t.trace, t.code);
    const w = cand.writes.find((x) => x.coord[0] === 6)!;
    const p = explainWrite(cand, [6], w.step, t.trace, lines)!;
    expect(p.operands[0].value).toBeNull();
    expect(p.baseCase).toBe(false);
  });

  it("handles a 1D recurrence", () => {
    // climb-bottomup line 8: dp[i] = dp[i - 1] + dp[i - 2];  at i=2
    const t = climbBottomup as Trace;
    const lines = t.code.split("\n");
    const [cand] = detectDpTables(t.trace, t.code);
    const w = cand.writes.find((x) => x.coord[0] === 2)!;
    const p = explainWrite(cand, [2], w.step, t.trace, lines)!;
    expect(p.lhs).toBe("dp[2]");
    expect(p.rhs).toBe("dp[1]+ dp[0]");
    expect(p.operands[0].value).toBe(2);
  });

  it("returns null for step 0 and for an out-of-range step", () => {
    expect(explainWrite(gridCand, [1, 1], 0, grid.trace, gridLines)).toBeNull();
    expect(explainWrite(gridCand, [1, 1], 99999, grid.trace, gridLines)).toBeNull();
  });

  it("returns null when the executing line is not an assignment to the table", () => {
    // grid-paths line 11 is `printf("%d\n", dp[2][3]);` — a read, not a write.
    // Derived rather than hardcoded: step indices shift when fixtures are
    // regenerated, line numbers do not.
    const step = grid.trace.findIndex((p) => p.line === 11);
    expect(step).toBeGreaterThan(0);
    expect(explainWrite(gridCand, [1, 1], step + 1, grid.trace, gridLines)).toBeNull();
  });
});
