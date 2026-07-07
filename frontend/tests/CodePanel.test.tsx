import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
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

describe("CodePanel breakpoint toggling", () => {
  it("toggles a breakpoint on gutter click in trace mode (readOnly)", async () => {
    let toggled: number | null = null;
    const { container } = render(
      <CodePanel {...base} value={"a\nb\nc"} readOnly
        onToggleBreakpoint={(ln) => { toggled = ln; }} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    const gutter = container.querySelector(".cm-exec-gutter");
    expect(gutter).toBeTruthy();
    fireEvent.mouseDown(gutter!);
    expect(toggled).not.toBeNull();
  });

  it("does not toggle breakpoints on gutter click in edit mode", async () => {
    let toggled: number | null = null;
    const { container } = render(
      <CodePanel {...base} value={"a\nb\nc"} readOnly={false}
        onToggleBreakpoint={(ln) => { toggled = ln; }} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    const gutter = container.querySelector(".cm-exec-gutter");
    expect(gutter).toBeTruthy();
    fireEvent.mouseDown(gutter!);
    expect(toggled).toBeNull();
  });
});

describe("CodePanel editing affordances", () => {
  it("renders a fold gutter", async () => {
    const { container } = render(
      <CodePanel {...base} value={"int main(){\n  return 0;\n}"} readOnly={false} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".cm-foldGutter")).toBeTruthy();
  });

  it("supports undo via history", async () => {
    let latest = "";
    const { container } = render(
      <CodePanel {...base} value={"abc"} readOnly={false} onChange={(v) => { latest = v; }} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    const { EditorView } = await import("@codemirror/view");
    const { undo } = await import("@codemirror/commands");
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    view.dispatch({ changes: { from: 3, insert: "d" }, userEvent: "input.type" });
    expect(latest).toBe("abcd");
    undo(view);
    expect(latest).toBe("abc");
  });
});

describe("CodePanel compile error", () => {
  it("highlights the error line and places a gutter marker", async () => {
    const { container } = render(
      <CodePanel {...base} value={"int main(){\n  broken\n}"} readOnly={false} errorLine={2} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".cm-line.cm-error-line")).toBeTruthy();
    expect(container.querySelector(".error-marker")).toBeTruthy();
  });

  it("shows no error styling when errorLine is null", async () => {
    const { container } = render(
      <CodePanel {...base} readOnly={false} errorLine={null} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".cm-line.cm-error-line")).toBeNull();
    expect(container.querySelector(".error-marker")).toBeNull();
  });

  it("clears the highlight when errorLine becomes null", async () => {
    const { container, rerender } = render(
      <CodePanel {...base} value={"a\nb\nc"} readOnly={false} errorLine={2} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".cm-error-line")).toBeTruthy();
    rerender(<CodePanel {...base} value={"a\nb\nc"} readOnly={false} errorLine={null} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".cm-error-line")).toBeNull();
  });
});

describe("CodePanel active-line highlight", () => {
  it("highlights the cursor line in edit mode", async () => {
    const { container } = render(
      <CodePanel {...base} value={"a\nb\nc"} readOnly={false} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".cm-activeLine")).toBeTruthy();
  });

  it("does not paint a stuck cursor line in trace mode", async () => {
    // the cursor is frozen at line 1 in trace mode (clicks toggle
    // breakpoints instead of moving it), so an active-line highlight
    // would just render line 1 permanently yellow
    const { container } = render(
      <CodePanel {...base} value={"a\nb\nc"} readOnly />,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".cm-activeLine")).toBeNull();
  });

  it("drops the highlight when switching into trace mode", async () => {
    const { container, rerender } = render(
      <CodePanel {...base} value={"a\nb\nc"} readOnly={false} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    rerender(<CodePanel {...base} value={"a\nb\nc"} readOnly />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".cm-activeLine")).toBeNull();
  });
});

describe("CodePanel dead breakpoints", () => {
  it("styles a never-reached breakpoint line as dead instead of active", async () => {
    const { container } = render(
      <CodePanel {...base} value={"a\nb\nc"} readOnly
        breakpoints={new Set([1, 2])} deadLines={new Set([2])} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    const active = container.querySelectorAll(".cm-line.cm-bp");
    const dead = container.querySelectorAll(".cm-line.cm-bp-dead");
    expect(active.length).toBe(1);
    expect(dead.length).toBe(1);
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
