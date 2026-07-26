import { describe, it, expect } from "vitest";
import { buildHeapLayout } from "../../src/viz/stl/heapTree";
import type { NormalizedCell } from "../../src/viz/memoryModel";

const node = (i: number): NormalizedCell => ({
  id: `n${i}`, name: `[${i}]`, source: "stack", kind: "scalar",
  address: null, type: "int", displayValue: String(i), rawValue: i,
});
const cells = (n: number) => Array.from({ length: n }, (_, i) => node(i));

describe("buildHeapLayout", () => {
  it("returns an empty layout for no children", () => {
    expect(buildHeapLayout([])).toEqual({ nodes: [], edges: [], rows: 0 });
  });

  it("places a single node at the root", () => {
    const { nodes, edges, rows } = buildHeapLayout(cells(1));
    expect(rows).toBe(1);
    expect(edges).toEqual([]);
    expect(nodes[0]).toMatchObject({ index: 0, row: 0, col: 0.5 });
  });

  it("assigns rows and centers a parent over its two children", () => {
    const { nodes, rows } = buildHeapLayout(cells(3));
    expect(rows).toBe(2);
    const by = (i: number) => nodes.find((n) => n.index === i)!;
    expect(by(0)).toMatchObject({ row: 0, col: 0.5 });
    expect(by(1)).toMatchObject({ row: 1, col: 0.25 });
    expect(by(2)).toMatchObject({ row: 1, col: 0.75 });
    // parent centered over children
    expect(by(0).col).toBeCloseTo((by(1).col + by(2).col) / 2);
  });

  it("emits heap parent edges", () => {
    const { edges } = buildHeapLayout(cells(5));
    expect(edges).toEqual([
      { parent: 0, child: 1 },
      { parent: 0, child: 2 },
      { parent: 1, child: 3 },
      { parent: 1, child: 4 },
    ]);
  });

  it("handles a partial last row", () => {
    const { rows, nodes } = buildHeapLayout(cells(4));
    expect(rows).toBe(3);
    expect(nodes.find((n) => n.index === 3)).toMatchObject({ row: 2, col: 0.125 });
  });
});
