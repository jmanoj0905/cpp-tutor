// Pure shape geometry — no React, no DOM. Positions are box top-left corners
// in canvas coordinates; the panel renders boxes absolutely at these points.
import type { ShapeModel } from "./shapes";

export const SNODE_H = 30;
export const SNODE_MIN_W = 44;
export const S_H_GAP = 28; // room for the arrow between list nodes
export const S_V_GAP = 26;
export const CYCLE_ARC_H = 22;

const CHAR_W = 7.5; // 12px mono advance, same estimate as treeLayout.ts
const PAD_X = 8;

export interface SNodePos { x: number; y: number; w: number }
export interface ShapeLayoutResult { pos: Map<string, SNodePos>; width: number; height: number }

export function shapeNodeWidth(label: string): number {
  return Math.max(SNODE_MIN_W, Math.ceil(label.length * CHAR_W + 2 * PAD_X));
}

export function layoutShape(shape: ShapeModel, widthOf: (id: string) => number): ShapeLayoutResult {
  return shape.kind === "list" ? layoutList(shape, widthOf) : layoutTree(shape, widthOf);
}

function layoutList(shape: ShapeModel, widthOf: (id: string) => number): ShapeLayoutResult {
  const pos = new Map<string, SNodePos>();
  let y = 0;
  let maxRight = 0;
  for (const chain of shape.groups) {
    let x = 0;
    for (const id of chain) {
      const w = widthOf(id);
      pos.set(id, { x, y, w });
      x += w + S_H_GAP;
    }
    maxRight = Math.max(maxRight, x - S_H_GAP);
    const hasArc = shape.edges.some((e) => e.cycleBack && chain.includes(e.fromId));
    y += SNODE_H + (hasArc ? CYCLE_ARC_H : 0) + S_V_GAP;
  }
  return { pos, width: maxRight, height: y - S_V_GAP };
}

// Implemented in Task 7.
function layoutTree(shape: ShapeModel, widthOf: (id: string) => number): ShapeLayoutResult {
  void widthOf;
  return { pos: new Map(), width: 0, height: shape.groups.length * SNODE_H };
}
