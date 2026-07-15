// Pure tree layout — no React, no DOM. Post-order subtree packing: each
// subtree occupies its own horizontal band (no overlap by construction),
// parents centered over their visible children, clamped inside their band.
// The FULL tree is always laid out (future nodes included) so positions are
// static across steps and the tree never reflows while stepping.
import type { CallTreeNode } from "./callTree";

export const NODE_W = 132; // minimum box width
export const NODE_H = 34;
export const H_GAP = 14;
export const V_GAP = 30;

// 12px mono glyph advance (~0.6em) plus a safety margin; exact-enough because
// labels are pure mono text.
const CHAR_W = 7.5;
const PAD_X = 10;

export interface NodePos {
  x: number; // box center
  y: number; // box top
  w: number; // box width
}

/** Content-sized box width with NODE_W as the floor. */
export function nodeWidth(label: string): number {
  return Math.max(NODE_W, Math.ceil(label.length * CHAR_W + 2 * PAD_X));
}

export function layoutTree(
  roots: CallTreeNode[],
  widthOf: (n: CallTreeNode) => number,
): Map<number, NodePos> {
  const pos = new Map<number, NodePos>();
  let cursor = 0;
  for (const root of roots) {
    cursor += place(root, 0, cursor, widthOf, pos) + H_GAP;
  }
  return pos;
}

/** Places node's subtree starting at xOffset; returns the band width. */
function place(
  node: CallTreeNode,
  depth: number,
  xOffset: number,
  widthOf: (n: CallTreeNode) => number,
  pos: Map<number, NodePos>,
): number {
  let kidsWidth = 0;
  for (const kid of node.children) {
    kidsWidth += place(kid, depth + 1, xOffset + kidsWidth, widthOf, pos) + H_GAP;
  }
  if (node.children.length > 0) kidsWidth -= H_GAP;

  const w = widthOf(node);
  const width = Math.max(w, kidsWidth);
  const mid =
    node.children.length > 0
      ? (pos.get(node.children[0].id)!.x +
          pos.get(node.children[node.children.length - 1].id)!.x) / 2
      : xOffset + w / 2;
  // A parent wider than its children's band would bleed into the neighboring
  // sibling band; clamp its box inside [xOffset, xOffset + width].
  const x = Math.min(Math.max(mid, xOffset + w / 2), xOffset + width - w / 2);
  pos.set(node.id, { x, y: depth * (NODE_H + V_GAP), w });
  return width;
}
