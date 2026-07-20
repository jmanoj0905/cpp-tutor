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
    "arr[i]",       // nested subscript
    "i / 0",        // div by zero
    "i % 0",
    "(int)i",       // cast
    "",             // empty
    "i +",          // dangling
  ])("rejects %s with null", (src) => {
    expect(evalIndexExpr(src, env)).toBeNull();
  });
});
