import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ShapePanel } from "../src/viz/ShapePanel";
import type { ShapeModel } from "../src/viz/shapes";
import { listNode } from "./shapeHelpers";

Element.prototype.scrollIntoView = vi.fn();
// jsdom has no CSS.escape either; minimal polyfill so the scroll-into-view
// effect's querySelector doesn't throw.
if (typeof (globalThis as any).CSS === "undefined") {
  (globalThis as any).CSS = { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
}

function toModel(cells: ReturnType<typeof listNode>[], groups: string[][], edges: ShapeModel["edges"]): ShapeModel {
  return {
    kind: "list", typeName: "ListNode",
    nodes: cells.map((c) => ({
      id: c.id, address: c.address!, label: c.children![0].displayValue,
      payloadIds: [c.children![0].id], cell: c,
    })),
    edges, groups, detached: [],
  };
}

const cells = [listNode("0x1", 1, "0x2"), listNode("0x2", 2, null)];
const model = toModel(cells, [["heap-heap-0x1", "heap-heap-0x2"]], [
  { fromId: "heap-heap-0x1", toId: "heap-heap-0x2", member: "next", memberCellId: "heap-heap-0x1-next", slot: 0 },
]);

describe("ShapePanel", () => {
  it("renders header with type, count, and node boxes tagged data-cell-id", () => {
    render(<ShapePanel shape={model} onToggleGeneric={() => {}} stepKey={0} />);
    expect(screen.getByText("ListNode ×2")).toBeInTheDocument();
    expect(document.querySelector('[data-cell-id="heap-heap-0x1"]')).toBeTruthy();
    expect(document.querySelector('[data-cell-id="heap-heap-0x2"]')).toBeTruthy();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("escape toggle fires onToggleGeneric", () => {
    const onToggle = vi.fn();
    render(<ShapePanel shape={model} onToggleGeneric={onToggle} stepKey={0} />);
    fireEvent.click(screen.getByRole("button", { name: /raw/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("payload change tints the node box; pointer change tints the edge only", () => {
    const changed = new Set(["heap-heap-0x1-val"]);
    const { container, rerender } = render(
      <ShapePanel shape={model} changedIds={changed} onToggleGeneric={() => {}} stepKey={0} />);
    expect(container.querySelector('[data-cell-id="heap-heap-0x1"]')!.className).toContain("shape-node-changed");
    expect(container.querySelector(".shape-edge-changed")).toBeNull();

    rerender(
      <ShapePanel shape={model} changedIds={new Set(["heap-heap-0x1-next"])} onToggleGeneric={() => {}} stepKey={1} />);
    expect(container.querySelector('[data-cell-id="heap-heap-0x1"]')!.className).not.toContain("shape-node-changed");
    expect(container.querySelector(".shape-edge-changed")).toBeTruthy();
  });

  it("clicking a node opens the detail box with address and first-seen step", () => {
    render(
      <ShapePanel shape={model} firstSeen={new Map([["0x1", 4]])} onToggleGeneric={() => {}} stepKey={0} />);
    fireEvent.click(document.querySelector('[data-cell-id="heap-heap-0x1"]')!);
    const detail = screen.getByTestId("shape-detail");
    expect(detail.textContent).toContain("0x1");
    expect(detail.textContent).toContain("allocated at step 4");
    // Esc closes
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("shape-detail")).toBeNull();
  });

  it("draws a cycle back-edge as an arc path", () => {
    const cyc = toModel(cells, [["heap-heap-0x1", "heap-heap-0x2"]], [
      { fromId: "heap-heap-0x1", toId: "heap-heap-0x2", member: "next", memberCellId: "heap-heap-0x1-next", slot: 0 },
      { fromId: "heap-heap-0x2", toId: "heap-heap-0x1", member: "next", memberCellId: "heap-heap-0x2-next", slot: 0, cycleBack: true },
    ]);
    const { container } = render(<ShapePanel shape={cyc} onToggleGeneric={() => {}} stepKey={0} />);
    expect(container.querySelector("path.shape-edge-cycle")).toBeTruthy();
  });
});
