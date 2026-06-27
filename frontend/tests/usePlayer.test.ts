import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePlayer } from "../src/player/usePlayer";
import type { Trace } from "../src/types/trace";

const mk = (n: number): Trace => ({
  code: "x",
  trace: Array.from({ length: n }, (_, i) => ({
    line: i + 1, event: "step_line", func_name: "main",
    stack_to_render: [], heap: {}, globals: {}, ordered_globals: [], stdout: "",
  })),
});

const mkLines = (lines: number[]): Trace => ({
  code: "x",
  trace: lines.map((line) => ({
    line, event: "step_line", func_name: "main",
    stack_to_render: [], heap: {}, globals: {}, ordered_globals: [], stdout: "",
  })),
});

describe("usePlayer", () => {
  it("steps and clamps at bounds", () => {
    const { result } = renderHook(() => usePlayer(mk(3)));
    expect(result.current.index).toBe(0);
    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    act(() => { result.current.last(); result.current.next(); });
    expect(result.current.index).toBe(2); // clamped
    act(() => { result.current.first(); result.current.prev(); });
    expect(result.current.index).toBe(0); // clamped
    expect(result.current.total).toBe(3);
  });

  it("exposes prevLine and nextLine around the current step", () => {
    const { result } = renderHook(() => usePlayer(mk(3)));
    expect(result.current.prevLine).toBeNull();      // at index 0
    expect(result.current.nextLine).toBe(2);
    act(() => result.current.next());
    expect(result.current.prevLine).toBe(1);
    expect(result.current.nextLine).toBe(3);
    act(() => result.current.last());
    expect(result.current.nextLine).toBeNull();      // at last
  });

  it("hitSteps returns indices whose line is a breakpoint", () => {
    const { result } = renderHook(() => usePlayer(mkLines([5, 6, 5, 7, 5])));
    expect(result.current.hitSteps(new Set([5]))).toEqual([0, 2, 4]);
    expect(result.current.hitSteps(new Set([6, 7]))).toEqual([1, 3]);
    expect(result.current.hitSteps(new Set())).toEqual([]);
  });

  it("nextHit jumps to the next step on a breakpoint line", () => {
    const { result } = renderHook(() => usePlayer(mkLines([5, 6, 5, 7, 5])));
    act(() => result.current.nextHit(new Set([5])));
    expect(result.current.index).toBe(2);
    act(() => result.current.nextHit(new Set([5])));
    expect(result.current.index).toBe(4);
    act(() => result.current.nextHit(new Set([5]))); // none ahead
    expect(result.current.index).toBe(4);            // no-op
  });
});
