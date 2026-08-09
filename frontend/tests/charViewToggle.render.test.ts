import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { MemoryCell } from "../src/viz/MemoryCell";
import type { NormalizedCell } from "../src/viz/memoryModel";

const charChild = (id: string, ch: string): NormalizedCell => ({
  id, name: `[${id}]`, source: "stack", kind: "scalar", address: null, type: "char",
  displayValue: ch, rawValue: null,
});

function stringCell(toggle?: "on" | "off"): NormalizedCell {
  return {
    id: "s", name: "s", source: "stack", kind: "container", address: null, type: "string",
    displayValue: '"hi"', rawValue: null, containerKind: "string", elementType: "char", length: 2,
    charViewToggle: toggle,
    children: [charChild("0", "h"), charChild("1", "i")],
  };
}

describe("char-view toggle button rendering", () => {
  it("renders a '⇄ chars' button on an off, togglable string cell", () => {
    const onToggle = vi.fn();
    render(createElement(MemoryCell, { cell: stringCell("off"), view: { onCharViewToggle: onToggle } }));
    const btn = screen.getByRole("button", { name: /⇄ chars/ });
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledWith("s");
  });

  it("renders a '⇄ string' button when the toggle is on", () => {
    render(createElement(MemoryCell, { cell: stringCell("on"), view: { onCharViewToggle: vi.fn() } }));
    expect(screen.getByRole("button", { name: /⇄ string/ })).toBeTruthy();
  });

  it("renders no toggle button when the cell has no charViewToggle affordance", () => {
    render(createElement(MemoryCell, { cell: stringCell(undefined), view: { onCharViewToggle: vi.fn() } }));
    expect(screen.queryByRole("button", { name: /⇄/ })).toBeNull();
  });

  it("renders no toggle button when no onCharViewToggle handler is provided", () => {
    render(createElement(MemoryCell, { cell: stringCell("off") }));
    expect(screen.queryByRole("button", { name: /⇄/ })).toBeNull();
  });
});
