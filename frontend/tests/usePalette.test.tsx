import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePalette } from "../src/palette/usePalette";

describe("usePalette", () => {
  it("toggles open state", () => {
    const { result } = renderHook(() => usePalette());
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
  });

  it("close() sets open to false", () => {
    const { result } = renderHook(() => usePalette());
    act(() => result.current.toggle());
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });

  it("restores focus to the previously focused element on close", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    const { result } = renderHook(() => usePalette());
    act(() => result.current.toggle()); // captures btn as previously focused
    btn.blur();
    act(() => result.current.close());  // should refocus btn
    expect(document.activeElement).toBe(btn);
    btn.remove();
  });
});
