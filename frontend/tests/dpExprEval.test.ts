import { describe, expect, it } from "vitest";
import { evalIndexExpr } from "../src/viz/dp/exprEval";

const env = new Map([["i", 5], ["j", 2], ["n", 10]]);

describe("evalIndexExpr", () => {
  it.each<[string, number]>([
    ["i", 5],
    ["i - 1", 4],
    ["i-2", 3],
    ["j + 1", 3],
    ["2 * i", 10],
    ["n / 3", 3],          // C truncation
    ["-n / 3", -3],        // truncates toward zero, not floor
    ["n % 3", 1],
    ["(i + j) * 2", 14],
    ["-i + 6", 1],
    ["7", 7],
  ])("evaluates %s", (src, expected) => {
    expect(evalIndexExpr(src, env)).toBe(expected);
  });

  it.each<string>([
    "k",            // unknown identifier
    "f(i)",         // call
    "i++",          // not in grammar
    "arr[i]",       // subscript of an array not in the array env
    "i / 0",        // div by zero
    "i % 0",
    "(int)i",       // cast
    "",             // empty
    "i +",          // dangling
  ])("rejects %s with null", (src) => {
    expect(evalIndexExpr(src, env)).toBeNull();
  });
});

// Index expressions in real DP recurrences routinely subscript a second array:
// coin change writes `dp[a - coins[k]]`, knapsack `dp[i-1][c-w[i-1]]`. Without
// these, the read arrows of the two most common DP demos never render.
describe("evalIndexExpr: subscripts of known arrays", () => {
  const arrays = new Map<string, ReadonlyArray<number | readonly number[]>>([
    ["coins", [1, 3, 4]],
    ["w", [1, 3, 4, 5]],
    ["grid", [[1, 2], [3, 4]]],
  ]);

  it.each<[string, number]>([
    ["coins[j]", 4],
    ["n - coins[0]", 9],
    ["i - coins[j - 1]", 2],   // coins[1] = 3
    ["w[i - 4] * 2", 6],       // w[1] = 3
    ["grid[1][0]", 3],
    ["grid[j - 2][j - 1]", 2], // grid[0][1] = 2
  ])("evaluates %s", (src, expected) => {
    expect(evalIndexExpr(src, env, arrays)).toBe(expected);
  });

  it.each<string>([
    "coins[9]",     // index past the end
    "coins[j - 5]", // negative index
    "coins[k]",     // unknown index identifier
    "coins",        // a whole array is not a number
    "coins[0][0]",  // over-subscripted
    "grid[0]",      // under-subscripted: still an array
    "other[0]",     // unknown array
  ])("rejects %s with null", (src) => {
    expect(evalIndexExpr(src, env, arrays)).toBeNull();
  });
});
