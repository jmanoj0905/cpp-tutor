import type { GraphEdge, GraphScene } from "./graphModel";

export interface Placed { id: string; x: number; y: number; }
export interface Layout { placed: Placed[]; mode: "circle" | "compact" | "grid" | "tree" | "list"; }
export const CIRCLE_MAX = 30;

export function layoutScene(scene: GraphScene): Layout {
  if (scene.kind === "tree") return treeLayout(scene);
  if (scene.kind === "list") return listLayout(scene);
  if (scene.kind === "grid") {
    const rows = scene.rows ?? 1, cols = scene.cols ?? 1;
    const placed = scene.nodes.map((n) => ({
      id: n.id,
      x: cols === 1 ? 0.5 : (n.col ?? 0) / (cols - 1),
      y: rows === 1 ? 0.5 : (n.row ?? 0) / (rows - 1),
    }));
    return { placed, mode: "grid" };
  }
  const n = scene.nodes.length;
  if (n > CIRCLE_MAX) {
    const cols = Math.ceil(Math.sqrt(n));
    const placed = scene.nodes.map((node, i) => ({
      id: node.id,
      x: (i % cols) / Math.max(1, cols - 1),
      y: Math.floor(i / cols) / Math.max(1, Math.ceil(n / cols) - 1),
    }));
    return { placed, mode: "compact" };
  }
  const R = 0.4;
  const placed = scene.nodes.map((node, i) => {
    const t = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
    return { id: node.id, x: 0.5 + R * Math.cos(t), y: 0.5 + R * Math.sin(t) };
  });
  return { placed, mode: "circle" };
}

interface Band {
  pos: Map<string, { x: number; depth: number }>;  // x in [0,1] band-local
  depth: number;                                   // deepest level index
  count: number;
}

/** One root's reachable subtree. `seen` is shared across bands so a node is
 *  claimed by the first root that reaches it. Children of an edge carrying
 *  `slot` are placed by binary path (left = -, right = +) so a lone right child
 *  sits right of its parent; slotless levels (A3 heap trees) keep the original
 *  even spread across the level. */
function layoutBand(rootId: string, children: Map<string, GraphEdge[]>, seen: Set<string>): Band {
  const levels: string[][] = [];
  const slotX = new Map<string, number>([[rootId, 0.5]]);
  let frontier = [rootId];
  let half = 0.25;
  seen.add(rootId);
  while (frontier.length) {
    levels.push(frontier);
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of children.get(id) ?? []) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        next.push(e.to);
        if (e.slot != null) slotX.set(e.to, (slotX.get(id) ?? 0.5) + (e.slot === 0 ? -half : half));
      }
    }
    frontier = next;
    half /= 2;
  }
  const pos = new Map<string, { x: number; depth: number }>();
  levels.forEach((row, d) => {
    const m = row.length;
    row.forEach((id, k) => {
      const even = m === 1 ? 0.5 : k / (m - 1);
      pos.set(id, { x: slotX.get(id) ?? even, depth: d });
    });
  });
  return { pos, depth: levels.length - 1, count: pos.size };
}

/** Lay out a forest from its parent→child edges (roots = nodes that are never a
 *  `to`). Depth is one horizontal row, shared across all roots. Each root's
 *  subtree occupies its own horizontal band, sized by node count, so two live
 *  trees (sameTree) sit side by side. A single slotless root reproduces the A3
 *  heap-tree layout exactly. */
function treeLayout(scene: GraphScene): Layout {
  const children = new Map<string, GraphEdge[]>();
  const hasParent = new Set<string>();
  for (const e of scene.edges) {
    const list = children.get(e.from) ?? [];
    list.push(e);
    children.set(e.from, list);
    hasParent.add(e.to);
  }
  const roots = scene.nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id);
  if (roots.length === 0) {
    return { placed: scene.nodes.map((n) => ({ id: n.id, x: 0.5, y: 0.5 })), mode: "tree" };
  }

  const seen = new Set<string>();
  const bands = roots.map((r) => layoutBand(r, children, seen));
  const maxDepth = Math.max(...bands.map((b) => b.depth));
  const total = bands.reduce((s, b) => s + Math.max(1, b.count), 0);

  const pos = new Map<string, { x: number; y: number }>();
  let cursor = 0;
  for (const band of bands) {
    const w = Math.max(1, band.count) / total;
    for (const [id, p] of band.pos) {
      pos.set(id, { x: cursor + p.x * w, y: maxDepth === 0 ? 0.5 : p.depth / maxDepth });
    }
    cursor += w;
  }
  const placed = scene.nodes.map((n) => ({ id: n.id, ...(pos.get(n.id) ?? { x: 0.5, y: 0.5 }) }));
  return { placed, mode: "tree" };
}

/** Lay out chains left to right, one chain per row. Chains are derived the same
 *  way `treeLayout` derives roots — a head is a node that is never a `to` — with
 *  the extra pass a list needs: a pure cycle has no head at all, so any node
 *  still unclaimed after the head pass starts its own chain. The walk stops on
 *  an already-placed node, so a back-edge closes the loop instead of spinning.
 *
 *  Every chain starts at the left margin rather than being centered: the point
 *  of stacking chains is to compare them position by position (the two halves
 *  of a merge, the reversed prefix against the untouched suffix). */
function listLayout(scene: GraphScene): Layout {
  const next = new Map<string, string>();
  const hasParent = new Set<string>();
  for (const e of scene.edges) {
    if (!next.has(e.from)) next.set(e.from, e.to);   // first-seen successor wins
    hasParent.add(e.to);
  }

  const seen = new Set<string>();
  const chains: string[][] = [];
  const walk = (startId: string) => {
    if (seen.has(startId)) return;
    const chain: string[] = [];
    let id: string | undefined = startId;
    while (id !== undefined && !seen.has(id)) {
      seen.add(id);
      chain.push(id);
      id = next.get(id);
    }
    chains.push(chain);
  };
  for (const n of scene.nodes) if (!hasParent.has(n.id)) walk(n.id);
  for (const n of scene.nodes) walk(n.id);

  const rows = chains.length;
  const maxLen = Math.max(1, ...chains.map((c) => c.length));
  const pos = new Map<string, { x: number; y: number }>();
  chains.forEach((chain, r) => {
    chain.forEach((id, k) => {
      pos.set(id, {
        x: maxLen === 1 ? 0.5 : k / (maxLen - 1),
        y: rows === 1 ? 0.5 : r / (rows - 1),
      });
    });
  });
  const placed = scene.nodes.map((n) => ({ id: n.id, ...(pos.get(n.id) ?? { x: 0.5, y: 0.5 }) }));
  return { placed, mode: "list" };
}

/** Midpoint of an edge, optionally nudged `offset` px perpendicular to it so a
 *  directed pair (u→v and v→u) doesn't stamp two labels on the same point. */
export function labelPoint(ax: number, ay: number, bx: number, by: number, offset: number): { x: number; y: number } {
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  if (offset === 0) return { x: mx, y: my };
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  return { x: mx + (dy / len) * offset, y: my - (dx / len) * offset };
}

/** Point distance `r` back from (bx,by) toward (ax,ay). Lets a directed line
 *  stop at the target node's rim so its arrowhead sits at the edge, not hidden
 *  under the node. Zero-length edge returns (bx,by) unchanged (no NaN). */
export function trimEndpoint(ax: number, ay: number, bx: number, by: number, r: number): { x: number; y: number } {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  if (len === 0) return { x: bx, y: by };
  return { x: bx - (dx / len) * r, y: by - (dy / len) * r };
}
