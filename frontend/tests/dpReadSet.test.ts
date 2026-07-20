import { describe, expect, it } from "vitest";
import { countSubscripts, resolveOccurrences, subscriptOccurrences } from "../src/viz/dp/readSet";

describe("subscriptOccurrences", () => {
  it("finds 1D occurrences", () => {
    expect(subscriptOccurrences("dp[i] = dp[i - 1] + dp[i - 2];", "dp"))
      .toEqual([["i"], ["i - 1"], ["i - 2"]]);
  });
  it("finds 2D occurrences", () => {
    expect(subscriptOccurrences("dp[i][j] = dp[i - 1][j] + dp[i][j - 1];", "dp"))
      .toEqual([["i", "j"], ["i - 1", "j"], ["i", "j - 1"]]);
  });
  it("does not match other names or substrings", () => {
    expect(subscriptOccurrences("memo2[i] = xdp[i];", "dp")).toEqual([]);
  });
  it("handles member access syntax on vectors identically", () => {
    expect(subscriptOccurrences("if (memo[n] != -1) return memo[n];", "memo"))
      .toEqual([["n"], ["n"]]);
  });
});

describe("resolveOccurrences", () => {
  const env = new Map([["i", 2], ["j", 3]]);
  it("evaluates to coords", () => {
    expect(resolveOccurrences("dp[i][j] = dp[i - 1][j] + dp[i][j - 1];", "dp", env))
      .toEqual([[2, 3], [1, 3], [2, 2]]);
  });
  it("drops unresolvable occurrences, keeps the rest", () => {
    expect(resolveOccurrences("dp[i] = dp[f(i)] + dp[i - 1];", "dp", env))
      .toEqual([[2], [1]]);
  });
});

describe("countSubscripts", () => {
  it("counts occurrences without evaluating", () => {
    expect(countSubscripts("dp[i] = dp[i - 1] + dp[i - 2];", "dp")).toBe(3);
    expect(countSubscripts("a[i] = i * 2;", "a")).toBe(1);
  });
});
