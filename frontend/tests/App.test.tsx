import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../src/App";
import vectorTrace from "./fixtures/vector-trace.json";
import { fetchTrace } from "../src/api/client";
import type { Trace } from "../src/types/trace";

vi.mock("../src/api/client", () => ({
  fetchTrace: vi.fn(),
}));

describe("App shell", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts in editing state: Visualize shown, Stop absent", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /visualize/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^stop$/i })).toBeNull();
  });

  it("shows Stop and hides Visualize after a successful visualize", async () => {
    (fetchTrace as any).mockResolvedValue(vectorTrace as unknown as Trace);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });
    expect(screen.queryByRole("button", { name: /visualize/i })).toBeNull();
  });

  it("highlights the compile-error line in the editor", async () => {
    (fetchTrace as any).mockResolvedValue({ status: "compile_error", message: "expected ';'", line: 2 });
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByText("expected ';'");
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".cm-line.cm-error-line")).toBeTruthy();
    expect(container.querySelector(".error-marker")).toBeTruthy();
  });

  it("clears the error highlight on the next visualize", async () => {
    (fetchTrace as any).mockResolvedValueOnce({ status: "compile_error", message: "expected ';'", line: 2 });
    (fetchTrace as any).mockResolvedValueOnce(vectorTrace as unknown as Trace);
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByText("expected ';'");
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });
    expect(container.querySelector(".cm-error-line")).toBeNull();
    expect(screen.queryByText("expected ';'")).toBeNull();
  });

  it("stdout pane auto-sizes with content until dragged, and reset returns to auto", async () => {
    (fetchTrace as any).mockResolvedValue(vectorTrace as unknown as Trace);
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });

    const rightCol = container.querySelector(".right-col") as HTMLElement;
    // Auto mode: no inline pin, CSS min/max-height defaults drive the size.
    expect(rightCol.style.getPropertyValue("--stdout-min")).toBe("");
    expect(rightCol.style.getPropertyValue("--stdout-max")).toBe("");

    rightCol.getBoundingClientRect = () => ({ top: 0, height: 1000 } as DOMRect);
    const divider = container.querySelector(".divider-h") as HTMLElement;
    fireEvent.pointerDown(divider, { pointerId: 1 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(divider, { pointerId: 1 });
    // Manual mode: drag pins the pane to an exact height.
    expect(rightCol.style.getPropertyValue("--stdout-min")).toBe("30%");
    expect(rightCol.style.getPropertyValue("--stdout-max")).toBe("30%");

    fireEvent.doubleClick(divider);
    expect(rightCol.style.getPropertyValue("--stdout-min")).toBe("");
    expect(rightCol.style.getPropertyValue("--stdout-max")).toBe("");
  });

  it("tints a cell after stepping to a point where its value changed", async () => {
    const point = (line: number, x: number) => ({
      line, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {}, heap: {},
      stack_to_render: [{
        unique_hash: "f1", frame_id: "f1", func_name: "main",
        ordered_varnames: ["x"],
        encoded_locals: { x: ["C_DATA", "0x10", "int", x] },
      }],
    });
    (fetchTrace as any).mockResolvedValue({ code: "int x;", trace: [point(1, 41), point(2, 42)] });
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });
    expect(container.querySelector(".cell-changed")).toBeNull();      // first step: no prev
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(container.querySelector('[data-cell-id="stack-f1-x"]')?.className).toContain("cell-changed");
  });
});

describe("keyboard shortcuts", () => {
  beforeEach(() => vi.clearAllMocks());

  const visualize = async () => {
    (fetchTrace as any).mockResolvedValue(vectorTrace as unknown as Trace);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });
  };

  it("Ctrl+Enter visualizes from edit mode", async () => {
    (fetchTrace as any).mockResolvedValue(vectorTrace as unknown as Trace);
    render(<App />);
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await screen.findByRole("button", { name: /^stop$/i });
    expect(fetchTrace).toHaveBeenCalledTimes(1);
  });

  it("arrows step, End/Home jump, Escape stops", async () => {
    await visualize();
    expect(screen.getByText(/^Step 1 of /)).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText(/^Step 2 of /)).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText(/^Step 1 of /)).toBeTruthy();
    fireEvent.keyDown(window, { key: "End" });
    const total = (vectorTrace as unknown as Trace).trace.length;
    expect(screen.getByText(new RegExp(`^Step ${total} of ${total}`))).toBeTruthy();
    fireEvent.keyDown(window, { key: "Home" });
    expect(screen.getByText(/^Step 1 of /)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: /visualize/i })).toBeTruthy();
  });

  it("? opens help; Escape closes it without stopping the trace", async () => {
    await visualize();
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /^stop$/i })).toBeTruthy();
  });

  it("has no topbar help button; ? key toggles the overlay in edit mode", () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: /keyboard shortcuts/i })).toBeNull();
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stepping keys are inert in edit mode", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "End" });
    expect(screen.getByRole("button", { name: /visualize/i })).toBeTruthy();
  });
});
