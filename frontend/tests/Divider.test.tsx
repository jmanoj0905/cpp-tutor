import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { Divider } from "../src/Divider.tsx";

describe("Divider", () => {
  it("resets to 50 on double click by default", () => {
    const onResize = vi.fn();
    const { container } = render(<Divider onResize={onResize} />);
    fireEvent.doubleClick(container.querySelector(".divider")!);
    expect(onResize).toHaveBeenCalledWith(50);
  });

  it("resets to a custom defaultPct on double click", () => {
    const onResize = vi.fn();
    const { container } = render(<Divider onResize={onResize} defaultPct={18} />);
    fireEvent.doubleClick(container.querySelector(".divider")!);
    expect(onResize).toHaveBeenCalledWith(18);
  });

  it("calls onReset instead of onResize on double click when provided", () => {
    const onResize = vi.fn();
    const onReset = vi.fn();
    const { container } = render(<Divider onResize={onResize} onReset={onReset} />);
    fireEvent.doubleClick(container.querySelector(".divider")!);
    expect(onReset).toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("renders horizontal orientation with the divider-h class", () => {
    const { container } = render(<Divider onResize={() => {}} orientation="horizontal" />);
    const el = container.querySelector(".divider")!;
    expect(el.classList.contains("divider-h")).toBe(true);
    expect(el.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("resizes from clientY when horizontal", () => {
    const onResize = vi.fn();
    const { container } = render(
      <div className="host" style={{ position: "relative" }}>
        <Divider onResize={onResize} container=".host" orientation="horizontal" min={8} max={60} />
      </div>,
    );
    const host = container.querySelector(".host")!;
    host.getBoundingClientRect = () => ({ top: 0, height: 1000 } as DOMRect);
    const el = container.querySelector(".divider")!;
    fireEvent.pointerDown(el, { pointerId: 1 });
    fireEvent.pointerMove(el, { pointerId: 1, clientY: 300 });
    expect(onResize).toHaveBeenCalledWith(30);
  });
});
