import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { createElement } from "react";
import { HeapTreePanel } from "../../src/viz/stl/HeapTreePanel";
import { MemoryCell } from "../../src/viz/MemoryCell";
import type { NormalizedCell } from "../../src/viz/memoryModel";

const child = (i: number, v: string): NormalizedCell => ({
  id: `pq-${i}`, name: `[${i}]`, source: "stack", kind: "scalar",
  address: null, type: "int", displayValue: v, rawValue: null,
});

function pqCell(vals: string[]): NormalizedCell {
  return {
    id: "pq", name: "pq", source: "stack", kind: "container", address: null,
    type: "priority_queue<int, vector<int>, greater<int> >",
    displayValue: `priority_queue<int> · ${vals.length}`, rawValue: null,
    containerKind: "priority_queue", elementType: "int", heapKind: "min",
    length: vals.length, children: vals.map((v, i) => child(i, v)),
  };
}

describe("HeapTreePanel", () => {
  it("renders one node per child and one edge per non-root", () => {
    const { container } = render(createElement(HeapTreePanel, { cell: pqCell(["1", "2", "4", "3", "5"]) }));
    expect(container.querySelectorAll(".heap-node").length).toBe(5);
    expect(container.querySelectorAll(".heap-edges line").length).toBe(4);
  });

  it("marks the root node as the top", () => {
    const { container } = render(createElement(HeapTreePanel, { cell: pqCell(["1", "2", "4"]) }));
    const top = container.querySelector(".heap-node-top");
    expect(top?.textContent).toContain("1");
  });

  it("renders nothing but an empty frame for an empty heap", () => {
    const { container } = render(createElement(HeapTreePanel, { cell: pqCell([]) }));
    expect(container.querySelectorAll(".heap-node").length).toBe(0);
    expect(container.querySelector("[data-heap-tree]")).toBeTruthy();
  });
});

describe("priority_queue header badge + tree toggle", () => {
  it("shows a min-heap badge for a greater<> comparator", () => {
    render(createElement(MemoryCell, { cell: pqCell(["1", "2"]) }));
    expect(screen.getByText("min-heap")).toBeTruthy();
  });

  it("shows a '⇄ tree' button that fires onHeapToggle with the cell id", () => {
    const onHeapToggle = vi.fn();
    render(createElement(MemoryCell, { cell: pqCell(["1", "2"]), onHeapToggle }));
    fireEvent.click(screen.getByRole("button", { name: /⇄ tree/ }));
    expect(onHeapToggle).toHaveBeenCalledWith("pq");
  });

  it("renders the tree body (and a '⇄ array' button) when the toggle is on", () => {
    const { container } = render(createElement(MemoryCell, {
      cell: pqCell(["1", "2", "4"]),
      onHeapToggle: vi.fn(),
      heapViews: new Set(["pq"]),
    }));
    expect(container.querySelector("[data-heap-tree]")).toBeTruthy();
    expect(screen.getByRole("button", { name: /⇄ array/ })).toBeTruthy();
  });

  it("renders the flat array body when the toggle is off", () => {
    const { container } = render(createElement(MemoryCell, {
      cell: pqCell(["1", "2", "4"]), onHeapToggle: vi.fn(), heapViews: new Set(),
    }));
    expect(container.querySelector("[data-heap-tree]")).toBeNull();
  });
});
