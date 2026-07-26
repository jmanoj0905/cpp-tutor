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

/** A pair-shaped container child: header + two scalar members, exercising the
 *  composite path (as priority_queue<pair<int,int>> nodes look). */
function pairChild(i: number, a: string, b: string): NormalizedCell {
  return {
    id: `pq-${i}`, name: `[${i}]`, source: "stack", kind: "container", address: null,
    type: "pair<int, int>", displayValue: "pair", rawValue: null,
    containerKind: "pair",
    children: [
      { id: `pq-${i}-first`, name: "first", source: "stack", kind: "scalar", address: null, type: "int", displayValue: a, rawValue: null },
      { id: `pq-${i}-second`, name: "second", source: "stack", kind: "scalar", address: null, type: "int", displayValue: b, rawValue: null },
    ],
  };
}

function pqPairCell(vals: [string, string][]): NormalizedCell {
  return {
    id: "pq", name: "pq", source: "stack", kind: "container", address: null,
    type: "priority_queue<pair<int, int>, vector<pair<int, int> >, greater<pair<int, int> > >",
    displayValue: `priority_queue<pair<int, int>> · ${vals.length}`, rawValue: null,
    containerKind: "priority_queue", elementType: "pair<int, int>", heapKind: "min",
    length: vals.length, children: vals.map(([a, b], i) => pairChild(i, a, b)),
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

  it("regression: an all-scalar tree keeps the original fixed-grid pixel dimensions", () => {
    const { container } = render(createElement(HeapTreePanel, { cell: pqCell(["1", "2", "4"]) }));
    const tree = container.querySelector(".heap-tree") as HTMLElement;
    expect(tree.style.width).toBe("192px");
    expect(tree.style.height).toBe("128px");
  });

  it("content-aware pitch: a composite (pair) payload tree is strictly larger than the scalar tree of the same node count", () => {
    const scalarRender = render(createElement(HeapTreePanel, { cell: pqCell(["1", "2", "4"]) }));
    const scalarTree = scalarRender.container.querySelector(".heap-tree") as HTMLElement;
    const scalarWidth = parseFloat(scalarTree.style.width);
    const scalarHeight = parseFloat(scalarTree.style.height);

    const pairRender = render(createElement(HeapTreePanel, { cell: pqPairCell([["1", "9"], ["2", "8"], ["4", "6"]]) }));
    const pairTree = pairRender.container.querySelector(".heap-tree") as HTMLElement;
    const pairWidth = parseFloat(pairTree.style.width);
    const pairHeight = parseFloat(pairTree.style.height);

    expect(pairWidth).toBeGreaterThan(scalarWidth);
    expect(pairHeight).toBeGreaterThan(scalarHeight);

    expect(pairRender.container.querySelectorAll(".heap-node").length).toBe(3);
    expect(pairRender.container.querySelectorAll(".heap-edges line").length).toBe(2);
  });
});

describe("priority_queue header badge + tree toggle", () => {
  it("shows a min-heap badge for a greater<> comparator", () => {
    render(createElement(MemoryCell, { cell: pqCell(["1", "2"]) }));
    expect(screen.getByText("min-heap")).toBeTruthy();
  });

  it("shows a '⇄ tree' button that fires onHeapOpen with the cell id", () => {
    const onHeapOpen = vi.fn();
    render(createElement(MemoryCell, { cell: pqCell(["1", "2"]), onHeapOpen }));
    fireEvent.click(screen.getByRole("button", { name: /⇄ tree/ }));
    expect(onHeapOpen).toHaveBeenCalledWith("pq");
  });

  it("has no ⇄ array button and never inlines a tree body", () => {
    const { container } = render(createElement(MemoryCell, {
      cell: pqCell(["1", "2", "4"]), onHeapOpen: vi.fn(),
    }));
    expect(screen.queryByRole("button", { name: /⇄ array/ })).toBeNull();
    expect(container.querySelector("[data-heap-tree]")).toBeNull();
  });

  it("omits the tree button when no onHeapOpen is provided", () => {
    render(createElement(MemoryCell, { cell: pqCell(["1", "2"]) }));
    expect(screen.queryByRole("button", { name: /⇄ tree/ })).toBeNull();
  });
});
