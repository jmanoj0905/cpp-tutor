// Pointer-tree (Family B) source for the Graph tab. Converts the ShapeModel
// that `shapes.ts` already detects into a GraphScene and binds traversal
// overlays. Pure — no React, no DOM.
//
// IMPORTANT: this module imports only TYPES from graphModel.ts (erased at build
// time). Importing a value from there would create a runtime import cycle,
// because graphModel.ts imports this module's entry point.
import { normalizeMemory } from "../memoryModel";
import type { NormalizedMemory } from "../memoryModel";
import type { ShapeModel } from "../shapes";
import type { GraphEdge, GraphNode, GraphOverlays, GraphScene } from "./graphModel";
import type { ExecPoint } from "../../types/trace";
import { findContainers } from "./containers";

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

// Local memo: normalizeMemory is pure per ExecPoint, and the order scan visits
// every point in trace[0..index]. graphModel keeps an identical cache, but
// importing it here would create a runtime import cycle (see the file header),
// so this module keeps its own.
const normCache = new WeakMap<ExecPoint, NormalizedMemory>();
function norm(point: ExecPoint): NormalizedMemory {
  let m = normCache.get(point);
  if (!m) { m = normalizeMemory(point); normCache.set(point, m); }
  return m;
}

/** `visited` = every node a pointer local has ever stood on up to `index`;
 *  `order` = 1-based first-visit sequence, the traversal trail. Addresses that
 *  no longer resolve to a live node (freed nodes) are dropped. */
export function bindTreeOrder(
  trace: ExecPoint[], index: number, scene: GraphScene, addrById: Map<string, string>,
): void {
  const idByAddr = new Map([...addrById].map(([id, addr]) => [addr, id]));
  let counter = 0;
  const seen = new Set<string>();
  for (let s = 0; s <= index && s < trace.length; s++) {
    for (const addr of fingerAddresses(norm(trace[s]))) {
      if (seen.has(addr)) continue;
      seen.add(addr);
      const id = idByAddr.get(addr);
      if (!id) continue;                       // not a tree node (or already freed)
      scene.overlays.visited.add(id);
      scene.overlays.order.set(id, ++counter);
    }
  }
}

/** `frontier` = tree nodes sitting in a queue/stack of node pointers — the
 *  level-order BFS queue (`queue<TreeNode*>`) or the iterative-DFS stack
 *  (`stack<TreeNode*>`). Matching is by the element's targetAddress, so a
 *  priority_queue of pointers would also qualify; that is intended. */
export function bindTreeFrontier(
  mem: NormalizedMemory, scene: GraphScene, addrById: Map<string, string>,
): void {
  const idByAddr = new Map([...addrById].map(([id, addr]) => [addr, id]));
  for (const c of findContainers(mem)) {
    const k = (c.containerKind ?? "").toLowerCase();
    if (!(k.includes("queue") || k.includes("stack"))) continue;
    if (c.placeholders) continue;
    for (const el of c.children ?? []) {
      const id = el.targetAddress ? idByAddr.get(el.targetAddress) : undefined;
      if (id) scene.overlays.frontier.add(id);
    }
  }
}

/** Entry point used by buildGraphScene: build the tree scene for this step and
 *  bind every pointer-tree overlay. Null when no tree shape has nodes here. */
export function treeSceneFrom(
  shapes: ShapeModel[], mem: NormalizedMemory, trace: ExecPoint[], index: number,
): GraphScene | null {
  const scene = shapeToScene(shapes);
  if (!scene) return null;
  const addrById = addressIndex(shapes);
  bindTreeCurrent(mem, scene, addrById);
  bindTreeOrder(trace, index, scene, addrById);
  bindTreeFrontier(mem, scene, addrById);
  return scene;
}
