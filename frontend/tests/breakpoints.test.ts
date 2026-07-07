import { describe, it, expect } from "vitest";
import { toggleBreakpoint, deadBreakpointLines } from "../src/player/breakpoints";
import type { Trace } from "../src/types/trace";

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

const mkTrace = (lines: number[]): Trace => ({
  code: "x",
  trace: lines.map((line) => ({
    line, event: "step_line", func_name: "main",
    stack_to_render: [], heap: {}, globals: {}, ordered_globals: [], stdout: "",
  })),
});

describe("deadBreakpointLines", () => {
  it("returns breakpoint lines the trace never visits, sorted", () => {
    const out = deadBreakpointLines(new Set([7, 3, 5]), mkTrace([5, 6, 5]));
    expect(out).toEqual([3, 7]);
  });

  it("returns empty when every breakpoint is visited", () => {
    expect(deadBreakpointLines(new Set([5]), mkTrace([5, 6]))).toEqual([]);
  });

  it("returns empty when there are no breakpoints", () => {
    expect(deadBreakpointLines(new Set(), mkTrace([1, 2]))).toEqual([]);
  });
});
