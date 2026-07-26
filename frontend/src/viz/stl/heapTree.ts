import type { NormalizedCell } from "../memoryModel";

export interface HeapNode { cell: NormalizedCell; index: number; row: number; col: number; }
export interface HeapEdge { parent: number; child: number; }
export interface HeapLayout { nodes: HeapNode[]; edges: HeapEdge[]; rows: number; }

/** Lay out a heap's backing array as a complete binary tree by index.
 *  col is the node's horizontal center in (0,1); for a complete tree this
 *  places each parent exactly over the midpoint of its two children. */
export function buildHeapLayout(children: NormalizedCell[]): HeapLayout {
  const n = children.length;
  if (n === 0) return { nodes: [], edges: [], rows: 0 };
  const nodes: HeapNode[] = children.map((cell, index) => {
    const row = Math.floor(Math.log2(index + 1));
    const slotsInRow = 2 ** row;
    const slot = index - (slotsInRow - 1);
    return { cell, index, row, col: (slot + 0.5) / slotsInRow };
  });
  const edges: HeapEdge[] = [];
  for (let index = 1; index < n; index++) {
    edges.push({ parent: Math.floor((index - 1) / 2), child: index });
  }
  const rows = Math.floor(Math.log2(n)) + 1;
  return { nodes, edges, rows };
}
