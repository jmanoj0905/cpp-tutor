import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { createElement } from "react";
import { HeapTreeOverlay } from "../../src/viz/stl/HeapTreeOverlay";
import type { NormalizedCell } from "../../src/viz/memoryModel";

const child = (i: number, v: string): NormalizedCell => ({
  id: `pq-${i}`, name: `[${i}]`, source: "stack", kind: "scalar",
  address: null, type: "int", displayValue: v, rawValue: null,
});
function pqCell(vals: string[]): NormalizedCell {
  return {
    id: "pq", name: "minHeap", source: "stack", kind: "container", address: null,
    type: "priority_queue<int, vector<int>, greater<int> >",
    displayValue: `priority_queue<int> · ${vals.length}`, rawValue: null,
    containerKind: "priority_queue", elementType: "int", heapKind: "min",
    length: vals.length, children: vals.map((v, i) => child(i, v)),
  };
}

describe("HeapTreeOverlay", () => {
  it("renders the heap tree for the cell", () => {
    const { container } = render(createElement(HeapTreeOverlay, {
      cell: pqCell(["1", "2", "4"]), step: 7, onClose: vi.fn(),
    }));
    expect(container.querySelector("[data-heap-tree]")).toBeTruthy();
    expect(container.querySelectorAll(".heap-node").length).toBe(3);
  });

  it("shows the cell name, min-heap badge, and step label", () => {
    render(createElement(HeapTreeOverlay, { cell: pqCell(["1"]), step: 7, onClose: vi.fn() }));
    expect(screen.getByText("minHeap")).toBeTruthy();
    expect(screen.getByText("min-heap")).toBeTruthy();
    expect(screen.getByText("step 7")).toBeTruthy();
  });

  it("is a docked panel with no dimming backdrop, and a click on it does not close", () => {
    const onClose = vi.fn();
    const { container } = render(createElement(HeapTreeOverlay, {
      cell: pqCell(["1", "2"]), step: 1, onClose,
    }));
    // consistent with the call-tree .ct-detail inspector: a bottom-right panel,
    // no full-screen backdrop that dims the page or eats clicks
    expect(container.querySelector(".heap-overlay-backdrop")).toBeNull();
    expect(container.querySelector(".heap-overlay-panel")).toBeTruthy();
    fireEvent.click(container.querySelector(".heap-overlay-panel")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("fires onClose on the × button", () => {
    const onClose = vi.fn();
    render(createElement(HeapTreeOverlay, { cell: pqCell(["1"]), step: 1, onClose }));
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
