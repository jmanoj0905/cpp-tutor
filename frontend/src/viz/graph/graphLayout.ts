import type { GraphScene } from "./graphModel";

export interface Placed { id: string; x: number; y: number; }
export interface Layout { placed: Placed[]; mode: "circle" | "compact" | "grid"; }
export const CIRCLE_MAX = 30;

export function layoutScene(scene: GraphScene): Layout {
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
