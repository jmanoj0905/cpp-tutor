// Pointer-tree (Family B) source for the Graph tab. Converts the ShapeModel
// that `shapes.ts` already detects into a GraphScene and binds traversal
// overlays. Pure — no React, no DOM.
import { memoryAt } from "../memoryModel";
import type { MemoryLink, NormalizedCell, NormalizedMemory } from "../memoryModel";
import type { ShapeKind, ShapeModel } from "../shapes";
import { emptyOverlays } from "./scene";
import type { GraphEdge, GraphKind, GraphNode, GraphScene } from "./scene";
import type { ExecPoint } from "../../types/trace";
import { findContainers } from "./containers";

/** ShapeKinds this module can turn into a scene, and the GraphKind each becomes.
 *  `trie` is B3 and is deliberately absent for now. */
const SCENE_KIND: Partial<Record<ShapeKind, GraphKind>> = { tree: "tree", list: "list" };

/** Every shape of `kind` that has nodes, merged into one scene. Node ids are
 *  heap cell ids.
 *
 *  Trees carry `slot` (0 = left, 1 = right) on each edge, which drives
 *  slot-aware placement in treeLayout. Lists deliberately do NOT: a list node
 *  has exactly one self-pointer member, so every edge would carry slot 0 and a
 *  slot-aware layout would read that as "always go left". */
export function shapeToScene(shapes: ShapeModel[], kind: ShapeKind = "tree"): GraphScene | null {
  const graphKind = SCENE_KIND[kind];
  if (!graphKind) return null;
  const matching = shapes.filter((s) => s.kind === kind && s.nodes.length > 0);
  if (matching.length === 0) return null;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const overlays = emptyOverlays();
  for (const t of matching) {
    for (const n of t.nodes) nodes.push({ id: n.id, label: n.label });
    for (const e of t.edges) {
      edges.push({
        from: e.fromId, to: e.toId, directed: true,
        ...(kind === "list" ? {} : { slot: e.slot }),
        ...(e.cycleBack ? { cycleBack: true } : {}),
      });
    }
    for (const id of t.detached) overlays.detached.add(id);
  }
  return { kind: graphKind, nodes, edges, overlays };
}

/** node id -> heap address for every node in the scene. Addresses are the
 *  stable key across steps (cell ids are per-step artifacts). */
export function addressIndex(shapes: ShapeModel[], kind: ShapeKind = "tree"): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of shapes) {
    if (s.kind !== kind) continue;
    for (const n of s.nodes) map.set(n.id, n.address);
  }
  return map;
}

/** Ids of every cell nested (at any depth) inside a container/array cell —
 *  e.g. a `queue<TreeNode*>` element. A pointer sitting in a container is
 *  queued for later visitation, not "at" the node; it must never count as an
 *  algorithm finger (that was Finding 1: it made `current` swallow the whole
 *  `frontier`, corrupted `order` into push order, and made `onPath` mark
 *  disconnected subtrees). Derived via `findContainers`, which already knows
 *  how to walk every container/array cell in globals + frames + heap. */
function containerDescendantIds(mem: NormalizedMemory): Set<string> {
  const out = new Set<string>();
  const walk = (c: NormalizedCell) => {
    for (const child of c.children ?? []) { out.add(child.id); walk(child); }
  };
  for (const c of findContainers(mem)) walk(c);
  return out;
}

/** Links a live stack/global pointer local holds on a tree node — the
 *  algorithm's "fingers". Excludes:
 *   - heap-sourced links (a node's own left/right member): tree structure,
 *     not algorithm position.
 *   - links whose source cell is a descendant of a container/array cell (a
 *     `queue`/`stack` frontier element): queued for later, not current.
 */
function fingerLinks(mem: NormalizedMemory): MemoryLink[] {
  const inContainer = containerDescendantIds(mem);
  return mem.links.filter((l) => !l.fromId.startsWith("heap-") && !inContainer.has(l.fromId));
}

function fingerAddresses(mem: NormalizedMemory): Set<string> {
  return new Set(fingerLinks(mem).map((l) => l.targetAddress));
}

/** `current` = nodes a live pointer local targets, ordered outermost frame ->
 *  innermost (matching `bindCurrent`'s convention in graphModel.ts): a link is
 *  grouped into the stack frame whose id its `fromId` is scoped under, frames
 *  are walked innermost-first (mem.frames is outermost-first), and any link
 *  that doesn't scope to a known frame (e.g. a global) is appended last.
 *  `onPath` is derived from real parent-child adjacency between CONSECUTIVE
 *  entries of that ordered chain — not "both endpoints somewhere in current" —
 *  because a recursive call chain visits one ancestor path at a time; two
 *  unrelated current nodes must never both light up an edge between them. */
export function bindTreeCurrent(
  mem: NormalizedMemory, scene: GraphScene, addrById: Map<string, string>,
): void {
  const idByAddr = new Map([...addrById].map(([id, addr]) => [addr, id]));
  const links = fingerLinks(mem);
  const current: string[] = [];
  const fingers = new Map<string, string[]>();
  const seen = new Set<string>();
  const consumed = new Set<MemoryLink>();
  const pushFrom = (ls: MemoryLink[]) => {
    for (const l of ls) {
      const id = idByAddr.get(l.targetAddress);
      if (!id || !scene.nodes.some((n) => n.id === id)) continue;
      // `fingers` is filled in the same walk as `current` so name order and
      // node order can never disagree. Several pointers can name one node —
      // `slow` and `fast` meeting IS the answer in Floyd's — so names
      // accumulate even once the node itself is already in `current`.
      const names = fingers.get(id) ?? [];
      if (!names.includes(l.fromName)) names.push(l.fromName);
      fingers.set(id, names);
      if (seen.has(id)) continue;
      seen.add(id);
      current.push(id);
    }
  };
  for (const f of [...mem.frames].reverse()) {                 // innermost first
    const frameLinks = links.filter((l) => l.fromId.startsWith(`stack-${f.id}-`));
    frameLinks.forEach((l) => consumed.add(l));
    pushFrom(frameLinks);
  }
  pushFrom(links.filter((l) => !consumed.has(l)));              // globals / unscoped
  scene.overlays.current = current;
  scene.overlays.fingers = fingers;
  for (let i = 0; i < current.length - 1; i++) {
    const a = current[i], b = current[i + 1];
    const edge = scene.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
    if (edge) edge.onPath = true;
  }
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
    for (const addr of fingerAddresses(memoryAt(trace[s]))) {
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
  return pointerSceneFrom(shapes, mem, trace, index, "tree");
}

/** Same entry point for `kind: "list"` shapes (B2). Every binder above is keyed
 *  on heap addresses and knows nothing about arity, so a list reuses all four
 *  unchanged: `current`/`fingers` are the walking pointers, `order` is the
 *  traversal trail, `frontier` is a queue/stack of node pointers, and `onPath`
 *  — an edge between consecutive current nodes — lands on exactly the
 *  `prev -> curr` edge a reversal is about to rewrite. */
export function listSceneFrom(
  shapes: ShapeModel[], mem: NormalizedMemory, trace: ExecPoint[], index: number,
): GraphScene | null {
  return pointerSceneFrom(shapes, mem, trace, index, "list");
}

function pointerSceneFrom(
  shapes: ShapeModel[], mem: NormalizedMemory, trace: ExecPoint[], index: number,
  kind: ShapeKind,
): GraphScene | null {
  const scene = shapeToScene(shapes, kind);
  if (!scene) return null;
  const addrById = addressIndex(shapes, kind);
  bindTreeCurrent(mem, scene, addrById);
  bindTreeOrder(trace, index, scene, addrById);
  bindTreeFrontier(mem, scene, addrById);
  return scene;
}
