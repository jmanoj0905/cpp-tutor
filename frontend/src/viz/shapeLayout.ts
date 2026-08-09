// Pure shape geometry — no React, no DOM. Positions are box top-left corners
// in canvas coordinates; the panel renders boxes absolutely at these points.
import type { ShapeModel } from "./shapes";
import { boxWidth } from "./textMetrics";

export const SNODE_H = 30;
export const SNODE_MIN_W = 44;
export const S_H_GAP = 28; // room for the arrow between list nodes
export const S_V_GAP = 26;
export const CYCLE_ARC_H = 22;

const PAD_X = 8;

export interface SNodePos { x: number; y: number; w: number }
export interface ShapeLayoutResult { pos: Map<string, SNodePos>; width: number; height: number }

export function shapeNodeWidth(label: string): number {
  return boxWidth(label, SNODE_MIN_W, PAD_X);
}

export function layoutShape(shape: ShapeModel, widthOf: (id: string) => number): ShapeLayoutResult {
  if (shape.kind === "list") return layoutList(shape, widthOf);
  if (shape.kind === "trie") return layoutTrie(shape, widthOf);
  return layoutTree(shape, widthOf);
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

/** Slot-aware band packing (same idea as treeLayout.ts, plus left/right slots).
 *  Each subtree owns a horizontal band; a lone child shifts the parent half a
 *  slot toward the empty side so left-ness/right-ness stays readable. */
function layoutTree(shape: ShapeModel, widthOf: (id: string) => number): ShapeLayoutResult {
  const kids = new Map<string, [string | null, string | null]>();
  for (const id of shape.groups.flat()) kids.set(id, [null, null]);
  for (const e of shape.edges) {
    const slots = kids.get(e.fromId);
    // first-seen parent wins; a transient second parent's edge is drawn but not laid out
    if (slots && slots[e.slot] === null && shape.groups.flat().includes(e.toId)) slots[e.slot] = e.toId;
  }
  // drop child slots not actually laid out under this parent (double-parent case):
  const laidOutUnder = new Map<string, string>();
  for (const grp of shape.groups) {
    // pre-order guarantees a child appears after its adopting parent
    for (const id of grp) {
      for (const slot of [0, 1] as const) {
        const c = kids.get(id)?.[slot];
        if (c && !laidOutUnder.has(c) && shape.groups.some((g2) => g2.includes(c))) {
          laidOutUnder.set(c, id);
        } else if (c && laidOutUnder.get(c) !== id) {
          kids.get(id)![slot] = null;
        }
      }
    }
  }

  const center = new Map<string, number>(); // box center x
  const pos = new Map<string, SNodePos>();
  let maxDepth = 0;

  // returns band width
  const place = (id: string, depth: number, x0: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const [l, r] = kids.get(id) ?? [null, null];
    const w = widthOf(id);
    const half = (w + S_H_GAP) / 2;
    let band: number;
    let cx: number;
    if (l && r) {
      const lw = place(l, depth + 1, x0);
      const rw = place(r, depth + 1, x0 + lw + S_H_GAP);
      band = lw + S_H_GAP + rw;
      cx = (center.get(l)! + center.get(r)!) / 2;
    } else if (l) {
      const lw = place(l, depth + 1, x0);
      band = lw + half;
      cx = center.get(l)! + half;
    } else if (r) {
      const rw = place(r, depth + 1, x0 + half);
      band = rw + half;
      cx = center.get(r)! - half;
    } else {
      band = w;
      cx = x0 + w / 2;
    }
    band = Math.max(band, w);
    cx = Math.min(Math.max(cx, x0 + w / 2), x0 + band - w / 2); // clamp inside band
    center.set(id, cx);
    pos.set(id, { x: cx - w / 2, y: depth * (SNODE_H + S_V_GAP), w });
    return band;
  };

  let cursor = 0;
  for (const grp of shape.groups) {
    if (grp.length === 0) continue;
    cursor += place(grp[0], 0, cursor) + S_H_GAP;
  }
  const width = Math.max(0, cursor - S_H_GAP);
  return { pos, width, height: (maxDepth + 1) * SNODE_H + maxDepth * S_V_GAP };
}

/** Generic N-ary band packing: each subtree owns a horizontal band, a parent
 *  is centered over the span of its visible children and clamped inside its
 *  band. First-seen parent wins for a doubly-referenced node. */
function layoutTrie(shape: ShapeModel, widthOf: (id: string) => number): ShapeLayoutResult {
  const laidOut = new Set(shape.groups.flat());
  const kids = new Map<string, string[]>();
  for (const id of laidOut) kids.set(id, []);
  const parented = new Set<string>();
  for (const e of [...shape.edges].sort((a, b) => a.slot - b.slot)) {
    if (!laidOut.has(e.fromId) || !laidOut.has(e.toId) || parented.has(e.toId)) continue;
    kids.get(e.fromId)!.push(e.toId);
    parented.add(e.toId);
  }

  const pos = new Map<string, SNodePos>();
  const center = (id: string) => { const p = pos.get(id)!; return p.x + p.w / 2; };
  let maxDepth = 0;

  const place = (id: string, depth: number, x0: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const w = widthOf(id);
    const cs = kids.get(id) ?? [];
    let kidsWidth = 0;
    for (const c of cs) kidsWidth += place(c, depth + 1, x0 + kidsWidth) + S_H_GAP;
    if (cs.length) kidsWidth -= S_H_GAP;
    const band = Math.max(w, kidsWidth);
    const mid = cs.length ? (center(cs[0]) + center(cs[cs.length - 1])) / 2 : x0 + w / 2;
    const cx = Math.min(Math.max(mid, x0 + w / 2), x0 + band - w / 2);
    pos.set(id, { x: cx - w / 2, y: depth * (SNODE_H + S_V_GAP), w });
    return band;
  };

  let cursor = 0;
  for (const grp of shape.groups) {
    if (grp.length === 0) continue;
    cursor += place(grp[0], 0, cursor) + S_H_GAP;
  }
  const width = Math.max(0, cursor - S_H_GAP);
  return { pos, width, height: (maxDepth + 1) * SNODE_H + maxDepth * S_V_GAP };
}
