import { describe, it, expect } from "vitest";
import { heapNodeExtent } from "../../src/viz/stl/heapNodeExtent";
import type { NormalizedCell } from "../../src/viz/memoryModel";

const scalar = (name: string, type: string, value: string): NormalizedCell => ({
  id: `s-${name}`, name, source: "stack", kind: "scalar",
  address: null, type, displayValue: value, rawValue: null,
});

function pairCell(id: string, a: NormalizedCell, b: NormalizedCell): NormalizedCell {
  return {
    id, name: id, source: "stack", kind: "container", address: null,
    type: "pair<int, int>", displayValue: "pair", rawValue: null,
    containerKind: "pair", children: [a, b],
  };
}

describe("heapNodeExtent", () => {
  it("a scalar cell is one row, cols equal to its own text length", () => {
    const cell = scalar("[0]", "int", "12");
    const extent = heapNodeExtent(cell);
    expect(extent.rows).toBe(1);
    expect(extent.cols).toBe("[0]".length + "int".length + "12".length);
  });

  it("a pair cell (header + two scalar members) has rows > 1 and cols >= widest member", () => {
    const a = scalar("first", "int", "1");
    const b = scalar("second", "int", "2");
    const pair = pairCell("p", a, b);
    const extent = heapNodeExtent(pair);
    expect(extent.rows).toBeGreaterThan(1);
    const memberCols = Math.max(heapNodeExtent(a).cols, heapNodeExtent(b).cols);
    expect(extent.cols).toBeGreaterThanOrEqual(memberCols);
  });

  it("rows grow with nesting depth", () => {
    const a = scalar("first", "int", "1");
    const b = scalar("second", "int", "2");
    const pair = pairCell("p", a, b);
    const nested = pairCell("outer", pair, scalar("third", "int", "3"));
    const shallow = heapNodeExtent(pair);
    const deep = heapNodeExtent(nested);
    expect(deep.rows).toBeGreaterThan(shallow.rows);
  });
});
