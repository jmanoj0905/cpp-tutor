import { describe, it, expect } from "vitest";
import { layoutHeapTree } from "../../src/viz/stl/heapTreeGeometry";
import type { HeapNode, HeapEdge } from "../../src/viz/stl/heapTree";

const node = (index: number, row: number): HeapNode =>
  ({ index, row, col: 0, cell: { id: `n${index}` } as never });

describe("layoutHeapTree", () => {
  const sizes = new Map([[0, { w: 100, h: 40 }], [1, { w: 100, h: 40 }], [2, { w: 100, h: 40 }]]);
  const size = (i: number) => sizes.get(i)!;
  const nodes = [node(0, 0), node(1, 1), node(2, 1)];
  const edges: HeapEdge[] = [{ parent: 0, child: 1 }, { parent: 0, child: 2 }];

  it("centers a parent over the midpoint of its two children", () => {
    const g = layoutHeapTree(nodes, edges, size, { hGap: 20, vGap: 40, pad: 0 });
    const p = (i: number) => g.positions.find((n) => n.index === i)!;
    expect(p(1).cx).toBe(50);
    expect(p(2).cx).toBe(170);
    expect(p(0).cx).toBe(110); // midpoint of 50 and 170
  });

  it("stacks rows by their measured heights, not a fixed pitch", () => {
    const tall = new Map(sizes);
    tall.set(0, { w: 100, h: 90 });
    const g = layoutHeapTree(nodes, edges, (i) => tall.get(i)!, { hGap: 20, vGap: 40, pad: 0 });
    const p = (i: number) => g.positions.find((n) => n.index === i)!;
    expect(p(0).top).toBe(0);
    expect(p(1).top).toBe(130); // row0 height 90 + vGap 40
  });

  it("draws each edge from the parent's box-bottom to the child's box-top", () => {
    const g = layoutHeapTree(nodes, edges, size, { hGap: 20, vGap: 40, pad: 0 });
    const e = g.edges.find((x) => x.parent === 0 && x.child === 1)!;
    expect(e).toMatchObject({ x1: 110, y1: 40, x2: 50, y2: 80 });
  });

  it("keeps siblings from overlapping horizontally", () => {
    const g = layoutHeapTree(nodes, edges, size, { hGap: 20, vGap: 40, pad: 0 });
    const p = (i: number) => g.positions.find((n) => n.index === i)!;
    const rightEdgeOf1 = p(1).cx + size(1).w / 2;
    const leftEdgeOf2 = p(2).cx - size(2).w / 2;
    expect(leftEdgeOf2).toBeGreaterThanOrEqual(rightEdgeOf1);
  });

  it("sizes the canvas to contain every node plus padding", () => {
    const g = layoutHeapTree(nodes, edges, size, { hGap: 20, vGap: 40, pad: 10 });
    expect(g.width).toBe(240); // 10 pad + 100 + 20 gap + 100 + 10 pad
    expect(g.height).toBe(140); // pad 10 + row0 40 + vGap 40 + row1 40 + pad 10
  });

  it("returns an empty canvas for no nodes", () => {
    const g = layoutHeapTree([], [], size);
    expect(g.positions).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});
