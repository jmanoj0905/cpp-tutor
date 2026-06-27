import { describe, it, expect } from "vitest";
import { toggleBreakpoint } from "../src/player/breakpoints";

describe("toggleBreakpoint", () => {
  it("adds a line that is absent", () => {
    expect([...toggleBreakpoint(new Set<number>(), 5)]).toEqual([5]);
  });

  it("removes a line that is present", () => {
    expect([...toggleBreakpoint(new Set([5]), 5)]).toEqual([]);
  });

  it("does not mutate the input set", () => {
    const input = new Set([1]);
    const out = toggleBreakpoint(input, 2);
    expect([...input]).toEqual([1]);
    expect([...out].sort()).toEqual([1, 2]);
  });
});
