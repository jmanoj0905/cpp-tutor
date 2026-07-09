import { describe, expect, it, vi } from "vitest";
import { fireEvent, renderHook } from "@testing-library/react";
import { isEditableTarget, useShortcuts } from "../src/shortcuts/useShortcuts";

const traceCtx = { mode: "trace" as const, helpOpen: false, loading: false };

describe("useShortcuts", () => {
  it("dispatches the resolved action and prevents default", () => {
    const next = vi.fn();
    renderHook(() => useShortcuts(traceCtx, { next }));
    // fireEvent returns false when preventDefault was called
    expect(fireEvent.keyDown(window, { key: "ArrowRight" })).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("leaves unresolved keys untouched (no preventDefault)", () => {
    const next = vi.fn();
    renderHook(() => useShortcuts(traceCtx, { next }));
    expect(fireEvent.keyDown(window, { key: "a" })).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it("does not preventDefault when the action has no handler", () => {
    renderHook(() => useShortcuts(traceCtx, {}));
    expect(fireEvent.keyDown(window, { key: "ArrowRight" })).toBe(true);
  });

  it("ignores stepping keys when focus is in an input", () => {
    const next = vi.fn();
    renderHook(() => useShortcuts(traceCtx, { next }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(next).not.toHaveBeenCalled();
    input.remove();
  });

  it("reads the latest context without re-binding the listener", () => {
    const stop = vi.fn();
    const { rerender } = renderHook(
      ({ mode }) => useShortcuts({ ...traceCtx, mode }, { stop }),
      { initialProps: { mode: "edit" as "edit" | "trace" } },
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(stop).not.toHaveBeenCalled();
    rerender({ mode: "trace" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("removes the listener on unmount", () => {
    const next = vi.fn();
    const { unmount } = renderHook(() => useShortcuts(traceCtx, { next }));
    unmount();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("isEditableTarget", () => {
  const el = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild!;
  };

  it("true for input, textarea, select, contenteditable, and inside .cm-editor", () => {
    expect(isEditableTarget(el("<input type='range'>"))).toBe(true);
    expect(isEditableTarget(el("<textarea></textarea>"))).toBe(true);
    expect(isEditableTarget(el("<select></select>"))).toBe(true);
    expect(isEditableTarget(el("<div contenteditable=''></div>"))).toBe(true);
    expect(isEditableTarget(el("<div class='cm-editor'><div class='cm-content'></div></div>").firstElementChild)).toBe(true);
  });

  it("false for buttons, plain divs, and non-elements", () => {
    expect(isEditableTarget(el("<button>x</button>"))).toBe(false);
    expect(isEditableTarget(el("<div></div>"))).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
