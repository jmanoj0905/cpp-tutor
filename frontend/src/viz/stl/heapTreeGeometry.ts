import type { HeapNode, HeapEdge } from "./heapTree";

export interface NodeSize { w: number; h: number }
export interface HeapPosition { index: number; cx: number; top: number }
export interface HeapEdgeLine { parent: number; child: number; x1: number; y1: number; x2: number; y2: number }
export interface HeapGeometry {
  positions: HeapPosition[];
  edges: HeapEdgeLine[];
  width: number;
  height: number;
}

export interface HeapGeomOpts { hGap?: number; vGap?: number; pad?: number }

/**
 * Tidy-tree layout for a heap's complete binary tree, driven by MEASURED node
 * boxes rather than a fixed grid. Leaves are packed left→right by their real
 * width (+hGap); every parent is centered over the midpoint of its children;
 * rows stack by their tallest measured box (+vGap). Edges run from a parent's
 * box-bottom center to each child's box-top center, so a line never floats in
 * the empty band above/below a node (the old fixed-pitch bug) and composite /
 * nested-container payloads of any size lay out without overlapping.
 *
 * Pure: no DOM, no React. HeapTreePanel measures the rendered cells and feeds
 * the sizes in; connectorGeometry-style separation keeps this unit-testable.
 */
export function layoutHeapTree(
  nodes: HeapNode[],
  edges: HeapEdge[],
  size: (index: number) => NodeSize,
  opts: HeapGeomOpts = {},
): HeapGeometry {
  const hGap = opts.hGap ?? 24;
  const vGap = opts.vGap ?? 48;
  const pad = opts.pad ?? 8;
  if (nodes.length === 0) return { positions: [], edges: [], width: 0, height: 0 };

  const byIndex = new Map(nodes.map((n) => [n.index, n]));
  const childrenOf = (i: number) =>
    edges.filter((e) => e.parent === i).map((e) => e.child).sort((a, b) => a - b);

  // Row tops from measured row heights.
  const maxRow = nodes.reduce((m, n) => Math.max(m, n.row), 0);
  const rowHeight: number[] = [];
  for (let r = 0; r <= maxRow; r++) {
    rowHeight[r] = nodes
      .filter((n) => n.row === r)
      .reduce((m, n) => Math.max(m, size(n.index).h), 0);
  }
  const rowTop: number[] = [];
  let acc = pad;
  for (let r = 0; r <= maxRow; r++) {
    rowTop[r] = acc;
    acc += rowHeight[r] + vGap;
  }

  // In-order x assignment: leaves advance a cursor by their width, internal
  // nodes center over their children.
  const cx = new Map<number, number>();
  let cursor = pad;
  const assign = (i: number) => {
    if (!byIndex.has(i)) return;
    const kids = childrenOf(i);
    if (kids.length === 0) {
      cx.set(i, cursor + size(i).w / 2);
      cursor += size(i).w + hGap;
      return;
    }
    kids.forEach(assign);
    const first = cx.get(kids[0])!;
    const last = cx.get(kids[kids.length - 1])!;
    cx.set(i, (first + last) / 2);
  };
  const root = nodes.reduce((m, n) => Math.min(m, n.index), Infinity);
  assign(root);
  // Defensive: place any node the walk missed (disconnected / partial trace).
  for (const n of nodes) if (!cx.has(n.index)) assign(n.index);

  const positions: HeapPosition[] = nodes.map((n) => ({
    index: n.index,
    cx: cx.get(n.index)!,
    top: rowTop[n.row],
  }));

  const edgeLines: HeapEdgeLine[] = edges
    .filter((e) => byIndex.has(e.parent) && byIndex.has(e.child))
    .map((e) => {
      const pRow = byIndex.get(e.parent)!.row;
      const cRow = byIndex.get(e.child)!.row;
      return {
        parent: e.parent,
        child: e.child,
        x1: cx.get(e.parent)!,
        y1: rowTop[pRow] + size(e.parent).h,
        x2: cx.get(e.child)!,
        y2: rowTop[cRow],
      };
    });

  const width =
    nodes.reduce((m, n) => Math.max(m, cx.get(n.index)! + size(n.index).w / 2), 0) + pad;
  const height = rowTop[maxRow] + rowHeight[maxRow] + pad;

  return { positions, edges: edgeLines, width, height };
}
