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
});
