import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { MemoryCell } from "../src/viz/MemoryCell";
import type { NormalizedCell } from "../src/viz/memoryModel";

const leaf = (id: string, name: string, val: string): NormalizedCell => ({
  id, name, source: "stack", kind: "scalar", address: null, type: "int",
  displayValue: val, rawValue: null,
});

// pair<int, pair<int,int>>  { 60, { 60, 10 } }
function nestedPair(): NormalizedCell {
  const inner: NormalizedCell = {
    id: "p.second", name: "second", source: "stack", kind: "container",
    address: null, type: "pair<int, int>", displayValue: "(60, 10)", rawValue: null,
    containerKind: "pair",
    children: [leaf("p.second.first", "first", "60"), leaf("p.second.second", "second", "10")],
  };
  return {
    id: "p", name: "p", source: "stack", kind: "container",
    address: null, type: "pair<int, pair<int, int>>", displayValue: "(60, (60, 10))",
    rawValue: null, containerKind: "pair",
    children: [leaf("p.first", "first", "60"), inner],
  };
}

function vectorCell(): NormalizedCell {
  return {
    id: "v", name: "v", source: "stack", kind: "container", address: null,
    type: "vector<int>", displayValue: "[10, 20]", rawValue: null,
    containerKind: "vector",
    children: [leaf("v.0", "[0]", "10"), leaf("v.1", "[1]", "20")],
  };
}

describe("bento render branch", () => {
  it("renders a .bento container for a struct-like cell", () => {
    const { container } = render(createElement(MemoryCell, { cell: nestedPair() }));
    expect(container.querySelector(".cell-children.bento")).toBeTruthy();
  });

  it("nests a .bento compartment for a nested pair child", () => {
    const { container } = render(createElement(MemoryCell, { cell: nestedPair() }));
    // outer + inner pair each produce a .bento children container
    expect(container.querySelectorAll(".cell-children.bento").length).toBe(2);
  });

  it("does NOT render .bento for a vector", () => {
    const { container } = render(createElement(MemoryCell, { cell: vectorCell() }));
    expect(container.querySelector(".cell-children.bento")).toBeNull();
  });

  it("keeps data-cell-id on bento tiles so connectors resolve", () => {
    const { container } = render(createElement(MemoryCell, { cell: nestedPair() }));
    expect(container.querySelector('[data-cell-id="p.first"]')).toBeTruthy();
    expect(container.querySelector('[data-cell-id="p.second.second"]')).toBeTruthy();
  });

  it("marks a changed leaf tile with cell-changed", () => {
    const changed = new Set(["p.second.second"]);
    const { container } = render(
      createElement(MemoryCell, { cell: nestedPair(), changedIds: changed }),
    );
    const tile = container.querySelector('[data-cell-id="p.second.second"]');
    expect(tile?.className).toContain("cell-changed");
  });
});
