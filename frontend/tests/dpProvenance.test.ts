import { describe, expect, it } from "vitest";
import gridPaths from "./fixtures/dp/grid-paths.json";
import climbBottomup from "./fixtures/dp/climb-bottomup.json";
import memoFib from "./fixtures/dp/memo-fib-vector.json";
import minCost from "./fixtures/dp/min-cost-stairs.json";
import editDistance from "./fixtures/dp/edit-distance.json";
import type { Trace } from "../src/types/trace";
import { detectDpTables } from "../src/viz/dp/detect";
import { explainWrite, splitAssignment, splitOperands, pickWinner } from "../src/viz/dp/provenance";

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
    expect(p.rhs).toBe("dp[0][1] + dp[1][0]");
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
    expect(p.rhs).toBe("dp[1] + dp[0]");
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

describe("explainWrite — branches", () => {
  it("splits a min() that wraps the whole RHS and picks the smaller arm", () => {
    // min-cost-stairs lines 9-12:
    //   dp[i] = min(dp[i-1] + cost[i-1], dp[i-2] + cost[i-2]);
    // at i=2 with cost = {10,15,20}, dp = {0,0}: arms are 15 and 10.
    const t = minCost as Trace;
    const lines = t.code.split("\n");
    const [cand] = detectDpTables(t.trace, t.code);
    const w = cand.writes.find((x) => x.coord[0] === 2)!;
    const p = explainWrite(cand, [2], w.step, t.trace, lines)!;
    expect(p.op).toBe("min");
    expect(p.operands).toHaveLength(2);
    expect(p.operands[0].text).toBe("dp[1] + cost[i-1]");
    expect(p.operands.map((o) => o.value)).toEqual([15, 10]);
    expect(p.winner).toBe(1);
    expect(p.written).toBe("10");
  });

  it("splits a min() nested inside a larger RHS, leaving the inner call unevaluated", () => {
    // edit-distance line 13:
    //   else dp[i][j] = 1 + min(dp[i-1][j-1], min(dp[i-1][j], dp[i][j-1]));
    const t = editDistance as Trace;
    const lines = t.code.split("\n");
    const cand = detectDpTables(t.trace, t.code).find((c) => c.name === "dp")!;
    const w = cand.writes.find((x) => x.coord[0] === 1 && x.coord[1] === 2)!;
    const p = explainWrite(cand, [1, 2], w.step, t.trace, lines)!;
    expect(p.op).toBe("min");
    expect(p.operands).toHaveLength(2);
    expect(p.operands[1].value).toBeNull();       // the nested min() call
    expect(p.rhs.startsWith("1 + min(")).toBe(true);
  });

  it("a single-operand RHS has no op and no winner", () => {
    const w = gridWrite(1, 1);
    const p = explainWrite(gridCand, [1, 1], w.step, grid.trace, gridLines)!;
    expect(p.op).toBeNull();
    expect(p.winner).toBeNull();
  });

  it("winner is null when fewer than two operands evaluated", () => {
    const t = editDistance as Trace;
    const lines = t.code.split("\n");
    const cand = detectDpTables(t.trace, t.code).find((c) => c.name === "dp")!;
    const w = cand.writes.find((x) => x.coord[0] === 1 && x.coord[1] === 2)!;
    const p = explainWrite(cand, [1, 2], w.step, t.trace, lines)!;
    expect(p.operands.filter((o) => o.value !== null)).toHaveLength(1);
    expect(p.winner).toBeNull();
  });
});

describe("splitAssignment", () => {
  it("splits a plain assignment and strips the semicolon", () => {
    expect(splitAssignment("dp[i] = dp[i-1] + 1;", "dp"))
      .toEqual({ assign: "=", rhs: "dp[i-1] + 1" });
  });
  it("carries a compound operator", () => {
    expect(splitAssignment("dp[i] += cost[i];", "dp"))
      .toEqual({ assign: "+=", rhs: "cost[i]" });
  });
  it("ignores an = inside a for-header's parens", () => {
    expect(splitAssignment("for (int j = 0; j < 4; j++) dp[0][j] = 1;", "dp"))
      .toEqual({ assign: "=", rhs: "1" });
  });
  it("rejects comparisons and assignments to something else", () => {
    expect(splitAssignment("if (dp[i] == 3) x = 1;", "dp")).toBeNull();
    expect(splitAssignment("best = dp[i];", "dp")).toBeNull();
  });
});

describe("splitOperands", () => {
  it("splits max args at top-level commas only", () => {
    expect(splitOperands("max(a, f(b, c))")).toEqual({ op: "max", parts: ["a", "f(b, c)"] });
  });
  it("accepts a std:: prefix", () => {
    expect(splitOperands("std::min(a, b)")).toEqual({ op: "min", parts: ["a", "b"] });
  });
  it("finds a call nested in a larger expression", () => {
    expect(splitOperands("1 + min(a, b)")).toEqual({ op: "min", parts: ["a", "b"] });
  });
  it("splits a ternary into its two arms, not confused by ::", () => {
    expect(splitOperands("c ? std::x : y")).toEqual({ op: "ternary", parts: ["std::x", "y"] });
  });
  it("falls back to a single operand", () => {
    expect(splitOperands("a + b")).toEqual({ op: null, parts: ["a + b"] });
  });
});

describe("pickWinner", () => {
  const ops = (...vs: (number | null)[]) => vs.map((v) => ({ text: "", value: v }));
  it("max picks the largest evaluated arm", () => {
    expect(pickWinner("max", ops(6, 7), "7")).toBe(1);
  });
  it("min picks the smallest, ties go to the first", () => {
    expect(pickWinner("min", ops(4, 4), "4")).toBe(0);
  });
  it("ternary picks the arm equal to the written value", () => {
    expect(pickWinner("ternary", ops(6, 7), "7")).toBe(1);
  });
  it("ternary yields null when no arm matches", () => {
    expect(pickWinner("ternary", ops(6, 7), "9")).toBeNull();
  });
  it("null op and single-evaluated cases yield null", () => {
    expect(pickWinner(null, ops(1, 2), "1")).toBeNull();
    expect(pickWinner("max", ops(3, null), "3")).toBeNull();
  });
});
