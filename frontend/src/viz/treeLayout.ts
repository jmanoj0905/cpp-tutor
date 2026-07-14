// Pure tree layout — no React, no DOM. Post-order subtree packing: each
// subtree occupies its own horizontal band (no overlap by construction),
// parents centered over their visible children.
import type { CallTreeNode } from "./callTree";

export const NODE_W = 132;
export const NODE_H = 34;
export const H_GAP = 14;
export const V_GAP = 30;

export interface NodePos {
  x: number; // box center
  y: number; // box top
}

export function layoutTree(
  roots: CallTreeNode[],
  isVisible: (n: CallTreeNode) => boolean,
): Map<number, NodePos> {
  const pos = new Map<number, NodePos>();
  let cursor = 0;
  for (const root of roots) {
    if (!isVisible(root)) continue;
    cursor += place(root, 0, cursor, isVisible, pos) + H_GAP;
  }
  return pos;
}

/** Places node's visible subtree starting at xOffset; returns its width. */
function place(
  node: CallTreeNode,
  depth: number,
  xOffset: number,
  isVisible: (n: CallTreeNode) => boolean,
  pos: Map<number, NodePos>,
): number {
  const kids = node.children.filter(isVisible);
  let kidsWidth = 0;
  for (const kid of kids) {
    kidsWidth += place(kid, depth + 1, xOffset + kidsWidth, isVisible, pos) + H_GAP;
  }
  if (kids.length > 0) kidsWidth -= H_GAP;

  const width = Math.max(NODE_W, kidsWidth);
  const x =
    kids.length > 0
      ? (pos.get(kids[0].id)!.x + pos.get(kids[kids.length - 1].id)!.x) / 2
      : xOffset + NODE_W / 2;
  pos.set(node.id, { x, y: depth * (NODE_H + V_GAP) });
  return width;
}
