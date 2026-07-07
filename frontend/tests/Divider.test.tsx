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
});
