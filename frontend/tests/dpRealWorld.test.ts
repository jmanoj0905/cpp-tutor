import { describe, expect, it } from "vitest";
import memoFibVector from "./fixtures/dp/memo-fib-vector.json";
import frogJump from "./fixtures/dp/frog-jump.json";
import minCostStairs from "./fixtures/dp/min-cost-stairs.json";
import houseRobber from "./fixtures/dp/house-robber.json";
import countSubstrings from "./fixtures/dp/count-substrings.json";
import longestPalindromeSubstr from "./fixtures/dp/longest-palindrome-substr.json";
import houseRobberIi from "./fixtures/dp/house-robber-ii.json";
import longestPalindromeExpand from "./fixtures/dp/longest-palindrome-expand.json";
import knapsackStub from "./fixtures/dp/knapsack-stub.json";
import mapMemo from "./fixtures/dp/map-memo.json";
import mapCounter from "./fixtures/dp/map-counter.json";
import uniquePathsMemo from "./fixtures/dp/unique-paths-memo.json";
import tribonacciMemo from "./fixtures/dp/tribonacci-memo.json";
import compileErrorTrace from "./fixtures/dp/compile-error-trace.json";
import type { ExecPoint, Trace } from "../src/types/trace";
import { detectDpTables } from "../src/viz/dp/detect";
import { normalizeMemory } from "../src/viz/memoryModel";

export const realWorld = {
  "memo-fib-vector": memoFibVector as Trace,
  "frog-jump": frogJump as Trace,
  "min-cost-stairs": minCostStairs as Trace,
  "house-robber": houseRobber as Trace,
  // 2D vector<vector<bool>> table with a self-reference in the guard
  // condition (`s[i] == s[j] && dp[i+1][j-1]`).
  "count-substrings": countSubstrings as Trace,
  "longest-palindrome-substr": longestPalindromeSubstr as Trace,
  "house-robber-ii": houseRobberIi as Trace,
  "longest-palindrome-expand": longestPalindromeExpand as Trace,
  "knapsack-stub": knapsackStub as Trace,
  "map-memo": mapMemo as Trace,
  // The map analogue of the negatives above: a plain unordered_map frequency
  // counter (`freq[v[i]]++`) with no recurrence anywhere.
  "map-counter": mapCounter as Trace,
  // Base cases seeded by the DRIVER (`dp[m-1][n-1] = 0` in uniquePaths,
  // `dp[0..2]` in tribonacci) while the recurrence lives in the memoized
  // helper — so the table is written by two different functions. The dominant
  // top-down shape in Striver's sheet.
  "unique-paths-memo": uniquePathsMemo as Trace,
  "tribonacci-memo": tribonacciMemo as Trace,
};

const detect = (t: Trace) => detectDpTables(t.trace, t.code);

describe("real-world DP fixtures", () => {
  it.each(Object.entries(realWorld))("%s loads with code and steps", (_n, t) => {
    expect(t.code.length).toBeGreaterThan(0);
    expect(t.trace.length).toBeGreaterThan(0);
  });

  // Programs with no DP table at all. These must stay empty forever — they are
  // the false-positive guard for every detection change in this plan.
  it.each([
    ["house-robber-ii", "rolling scalars, no table"],
    ["knapsack-stub", "stub program"],
    ["longest-palindrome-expand", "positionsOdd/positionsEven are not tables"],
    ["map-counter", "unordered_map frequency counter, no recurrence"],
  ] as const)("%s detects no DP table (%s)", (name) => {
    expect(detect(realWorld[name])).toEqual([]);
  });

  // Multi-line recurrences: the write statement spans several source lines.
  it.each([
    ["frog-jump", "dp", [5], "bottom-up"],
    // cost={10,15,20} — the user's own input. dp is size n+1 = 4 and only two
    // writes ever land, both self-referential. Do NOT enlarge this input to
    // make detection easier; the small size is the point.
    ["min-cost-stairs", "dp", [4], "bottom-up"],
  ] as const)("%s detects %s%p as %s", (name, table, dims, mode) => {
    const found = detect(realWorld[name]);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe(table);
    expect(found[0].dims).toEqual(dims);
    expect(found[0].mode).toBe(mode);
  });

  // Memo guards and guard-condition self-reference.
  it.each([
    ["memo-fib-vector", "dp", "top-down"],
    ["count-substrings", "dp", "bottom-up"],
    ["longest-palindrome-substr", "dp", "bottom-up"],
    ["house-robber", "dp", "bottom-up"],
  ] as const)("%s detects %s as %s", (name, table, mode) => {
    const found = detect(realWorld[name]);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe(table);
    expect(found[0].mode).toBe(mode);
  });

  // Base cases seeded in the driver, recurrence in the memoized helper: the
  // table is written by two functions, but only one of them writes
  // self-referentially. Requiring a single WRITING function rejected these;
  // requiring a single self-referentially-writing function admits them while
  // still rejecting a global poked from unrelated places (which has no
  // self-referential writes at all).
  it.each([
    ["unique-paths-memo", "dp"],
    ["tribonacci-memo", "dp"],
  ] as const)("%s detects %s despite driver-seeded base cases", (name, table) => {
    const found = detect(realWorld[name]);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe(table);
    expect(found[0].mode).toBe("top-down");
  });

  it("map-memo detects the unordered_map memo as a top-down table", () => {
    const found = detect(realWorld["map-memo"]);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("memo");
    expect(found[0].mode).toBe("top-down");
    expect(found[0].dims).toEqual([5]);          // keys 2..4 → 0..4
    expect(found[0].keyed?.projection.numeric).toBe(true);
  });

  it("does not throw on a degenerate compile-error trace", () => {
    const t = compileErrorTrace as unknown as { trace: ExecPoint[] };
    expect(() => detectDpTables(t.trace, "")).not.toThrow();
    expect(detectDpTables(t.trace, "")).toEqual([]);
    expect(normalizeMemory(t.trace[0]).frames).toEqual([]);
  });
});
