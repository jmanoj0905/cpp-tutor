// Pointer-tree (Family B) source for the Graph tab. Converts the ShapeModel
// that `shapes.ts` already detects into a GraphScene and binds traversal
// overlays. Pure — no React, no DOM.
//
// IMPORTANT: this module imports only TYPES from graphModel.ts (erased at build
// time). Importing a value from there would create a runtime import cycle,
// because graphModel.ts imports this module's entry point.
import type { NormalizedMemory } from "../memoryModel";
import type { ShapeModel } from "../shapes";
import type { GraphEdge, GraphNode, GraphOverlays, GraphScene } from "./graphModel";

const emptyOverlays = (): GraphOverlays => ({
  visited: new Set(), current: [], frontier: new Set(),
  order: new Map(), flashed: new Set(),
});

/** Every `kind: "tree"` shape with nodes, merged into one scene. Node ids are
 *  heap cell ids; `slot` (0 = left, 1 = right) rides along on each edge. */
export function shapeToScene(shapes: ShapeModel[]): GraphScene | null {
  const trees = shapes.filter((s) => s.kind === "tree" && s.nodes.length > 0);
  if (trees.length === 0) return null;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const t of trees) {
    for (const n of t.nodes) nodes.push({ id: n.id, label: n.label });
    for (const e of t.edges) edges.push({ from: e.fromId, to: e.toId, directed: true, slot: e.slot });
  }
  return { kind: "tree", nodes, edges, overlays: emptyOverlays() };
}

/** node id -> heap address for every node in the scene. Addresses are the
 *  stable key across steps (cell ids are per-step artifacts). */
export function addressIndex(shapes: ShapeModel[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of shapes) {
    if (s.kind !== "tree") continue;
    for (const n of s.nodes) map.set(n.id, n.address);
  }
  return map;
}

/** Addresses a stack/global pointer currently targets — the algorithm's
 *  "fingers". Heap-sourced links (a node's own left/right member) are excluded:
 *  they are tree structure, not algorithm position. */
function fingerAddresses(mem: NormalizedMemory): Set<string> {
  const out = new Set<string>();
  for (const l of mem.links) {
    if (l.fromId.startsWith("heap-")) continue;
    out.add(l.targetAddress);
  }
  return out;
}

/** `current` = nodes a live pointer local targets. An edge with both endpoints
 *  current lies on the recursion path (tree path nodes are parent-child
 *  adjacent), so it gets `onPath` for emphasis. */
export function bindTreeCurrent(
  mem: NormalizedMemory, scene: GraphScene, addrById: Map<string, string>,
): void {
  const fingers = fingerAddresses(mem);
  const current = new Set<string>();
  for (const n of scene.nodes) {
    const addr = addrById.get(n.id);
    if (addr && fingers.has(addr)) current.add(n.id);
  }
  scene.overlays.current = [...current];
  for (const e of scene.edges) {
    if (current.has(e.from) && current.has(e.to)) e.onPath = true;
  }
}
