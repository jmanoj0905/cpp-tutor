import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CodePanel } from "../src/CodePanel";

const base = {
  value: "int x;",
  onChange: () => {},
  exec: null,
  breakpoints: new Set<number>(),
  onToggleBreakpoint: () => {},
};

describe("CodePanel readOnly", () => {
  it("is editable when readOnly is false", () => {
    const { container } = render(<CodePanel {...base} readOnly={false} />);
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");
  });

  it("is locked when readOnly is true", () => {
    const { container } = render(<CodePanel {...base} readOnly />);
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
  });

  it("switches to locked when readOnly changes to true", () => {
    const { container, rerender } = render(<CodePanel {...base} readOnly={false} />);
    rerender(<CodePanel {...base} readOnly />);
    expect(container.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
  });
});
