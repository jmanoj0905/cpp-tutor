import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useElapsed } from "../src/player/useElapsed";

describe("useElapsed", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts at 0 when inactive", () => {
    const { result } = renderHook(({ a }) => useElapsed(a), {
      initialProps: { a: false },
    });
    expect(result.current).toBe(0);
  });

  it("counts up in seconds while active", () => {
    const { result } = renderHook(({ a }) => useElapsed(a), {
      initialProps: { a: true },
    });
    expect(result.current).toBe(0);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current).toBe(3);
  });

  it("resets to 0 on a new active edge", () => {
    const { result, rerender } = renderHook(({ a }) => useElapsed(a), {
      initialProps: { a: true },
    });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBe(2);
    rerender({ a: false });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(2); // frozen while inactive
    rerender({ a: true });
    expect(result.current).toBe(0); // reset on rising edge
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(1);
  });
});
