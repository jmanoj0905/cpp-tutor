import type { NormalizedCell } from "../memoryModel";

export interface NodeExtent { rows: number; cols: number; }

function ownTextLen(cell: NormalizedCell): number {
  const name = cell.name ?? "";
  const type = cell.type ?? "";
  const value = cell.displayValue ?? "";
  return name.length + type.length + value.length;
}

/** Estimate a heap node's rendered box in grid units, from cell structure.
 *  A scalar cell is 1 row. A cell with children renders a header row plus
 *  one row per child (recursively, matching how MemoryCell stacks children
 *  vertically), so rows = 1 + sum of child rows. cols estimates the widest
 *  text line: this cell's own name+type+value, or the widest child's cols,
 *  whichever is larger. Pure — mirrors MemoryCell's visible shape so the
 *  panel can size pitch without measuring the DOM. */
export function heapNodeExtent(cell: NormalizedCell): NodeExtent {
  const cols = ownTextLen(cell);
  const children = cell.children ?? [];
  if (children.length === 0) {
    return { rows: 1, cols };
  }
  let rows = 1;
  let maxCols = cols;
  for (const child of children) {
    const extent = heapNodeExtent(child);
    rows += extent.rows;
    maxCols = Math.max(maxCols, extent.cols);
  }
  return { rows, cols: maxCols };
}
