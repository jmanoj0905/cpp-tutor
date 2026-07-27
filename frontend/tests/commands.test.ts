import { describe, it, expect } from "vitest";
import { fuzzyScore } from "../src/palette/commands";

describe("fuzzyScore", () => {
  it("returns null when not a subsequence", () => {
    expect(fuzzyScore("zzz", "Next step")).toBeNull();
  });

  it("matches subsequence out of order-adjacency", () => {
    expect(fuzzyScore("nxt", "Next step")).not.toBeNull();
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("NEXT", "next step")).not.toBeNull();
  });

  it("scores a contiguous match higher than a scattered one", () => {
    const contiguous = fuzzyScore("next", "Next step")!;
    const scattered = fuzzyScore("net", "Next step")!;
    expect(contiguous).toBeGreaterThan(scattered);
  });

  it("scores an earlier match higher than a later one for equal contiguity", () => {
    const early = fuzzyScore("ab", "ab zz")!;
    const late = fuzzyScore("ab", "zz ab")!;
    expect(early).toBeGreaterThan(late);
  });

  it("returns 0 for an empty query", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });
});
