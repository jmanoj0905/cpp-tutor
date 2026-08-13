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
    expect(onToggle).toHaveBeenCalledWith(["s"]);
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

  it("toggles the whole group when the cell carries one", () => {
    const onToggle = vi.fn();
    const cell = { ...stringCell("off"), charViewGroup: ["a", "b"] };
    render(createElement(MemoryCell, { cell, view: { onCharViewToggle: onToggle } }));
    fireEvent.click(screen.getByRole("button", { name: /⇄ chars/ }));
    expect(onToggle).toHaveBeenCalledWith(["a", "b"]);
  });
});

describe("string vs char-array child rendering", () => {
  // The flip has to be visible in the children, not just the header: a string
  // shows a bare glyph run, a vector<char> shows the indexed grid every other
  // array gets.
  const charArrayCell = (): NormalizedCell => ({
    ...stringCell("on"), containerKind: "vector", elementType: "char",
    displayValue: "vector<char> · 2",
  });

  it("renders string chars as bare glyphs, with no index or type chrome", () => {
    render(createElement(MemoryCell, { cell: stringCell("off"), view: {} }));
    const row = document.querySelector(".string-chars");
    expect(row).toBeTruthy();
    expect([...row!.querySelectorAll(".char-box")].map((b) => b.textContent)).toEqual(["h", "i"]);
    expect(row!.textContent).not.toMatch(/\[0\]|char/);
  });

  it("keeps each char addressable by cell id so diff highlighting still lands", () => {
    render(createElement(MemoryCell, {
      cell: stringCell("off"),
      view: { changedIds: new Set(["1"]) },
    }));
    expect(document.querySelector('.char-box[data-cell-id="1"]')!.className).toMatch(/cell-changed/);
    expect(document.querySelector('.char-box[data-cell-id="0"]')!.className).not.toMatch(/cell-changed/);
  });

  it("keeps a long string behind the collapse chip", () => {
    const long: NormalizedCell = {
      ...stringCell("off"),
      children: [..."abcdefghijkl"].map((ch, i) => charChild(String(i), ch)),
    };
    render(createElement(MemoryCell, { cell: long, view: {} }));
    expect(document.querySelector(".string-chars")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /show 12 chars/ }));
    expect(document.querySelectorAll(".char-box")).toHaveLength(12);
  });

  it("renders char-array children as indexed cells with their type", () => {
    render(createElement(MemoryCell, { cell: charArrayCell(), view: {} }));
    expect(document.querySelector(".string-chars")).toBeNull();
    expect(screen.getByText("[0]")).toBeTruthy();
    expect(screen.getAllByText("char")).toHaveLength(2);
  });
});
