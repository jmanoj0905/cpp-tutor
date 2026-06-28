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

describe("CodePanel exec arrows", () => {
  it("renders a green marker on just-executed line and red on next line", async () => {
    const { container } = render(
      <CodePanel
        value={"int main(){\n  int a=1;\n  int b=2;\n  return 0;\n}"}
        onChange={() => {}}
        exec={{ justExecuted: 2, next: 3 }}
        readOnly
        breakpoints={new Set()}
        onToggleBreakpoint={() => {}}
      />,
    );
    // CodeMirror renders asynchronously; flush a frame.
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".exec-arrow.green")).toBeTruthy();
    expect(container.querySelector(".exec-arrow.red")).toBeTruthy();
  });
});
