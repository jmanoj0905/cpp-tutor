// Pure shape detection for self-referential heap structs — no React, no DOM.
// A struct type with exactly 1 pointer-to-own-type member is a list candidate,
// exactly 2 is a binary-tree candidate. Detection is by member TYPE, not kind:
// a null `next` decodes as a scalar but keeps its `ListNode *` type.
import type { MemoryLink, NormalizedCell, NormalizedMemory } from "./memoryModel";

export interface ShapeEdge {
  fromId: string;
  toId: string;
  member: string;       // e.g. "next", "left"
  memberCellId: string; // leaf cell id of the pointer member (diff tinting)
  slot: number;         // index among self-ptr members: 0 = next/left, 1 = right
  cycleBack?: boolean;  // list back-edge into its own chain
}

const baseType = (t: string | null): string =>
  (t ?? "").replace(/^(struct|class)\s+/, "").trim();

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function selfPtrMembers(cell: NormalizedCell): NormalizedCell[] {
  const own = baseType(cell.type);
  if (!own) return [];
  const re = new RegExp(`^(struct\\s+|class\\s+)?${escapeRe(own)}\\s*\\*$`);
  return (cell.children ?? []).filter((c) => c.type !== null && re.test(c.type));
}

export function candidateKind(cell: NormalizedCell): "list" | "tree" | null {
  if (cell.kind !== "struct") return null;
  const n = selfPtrMembers(cell).length;
  if (n === 1) return "list";
  if (n === 2) return "tree";
  return null;
}

export function shapeTypeName(cell: NormalizedCell): string {
  return baseType(cell.type);
}

export interface ShapeNode {
  id: string;
  address: string;
  label: string;        // payload displayValues, e.g. "7"
  payloadIds: string[]; // leaf ids of non-self-ptr members (diff tinting)
  cell: NormalizedCell; // full struct for the detail box
}

export interface ShapeModel {
  kind: "list" | "tree";
  typeName: string;
  nodes: ShapeNode[];
  edges: ShapeEdge[];
  groups: string[][];
  detached: string[];
}

export interface ShapeResult { memory: NormalizedMemory; shapes: ShapeModel[] }

interface TypeGroup { kind: "list" | "tree"; typeName: string; cells: NormalizedCell[] }

export function collectGroups(memory: NormalizedMemory): Map<string, TypeGroup> {
  const groups = new Map<string, TypeGroup>();
  for (const cell of memory.heap) {
    const kind = candidateKind(cell);
    if (!kind || !cell.address) continue;
    const typeName = shapeTypeName(cell);
    let g = groups.get(typeName);
    if (!g) { g = { kind, typeName, cells: [] }; groups.set(typeName, g); }
    g.cells.push(cell);
  }
  return groups;
}

export function buildEdges(g: TypeGroup): ShapeEdge[] {
  const byAddr = new Map(g.cells.map((c) => [c.address as string, c]));
  const edges: ShapeEdge[] = [];
  for (const cell of g.cells) {
    selfPtrMembers(cell).forEach((m, slot) => {
      const target = m.targetAddress ? byAddr.get(m.targetAddress) : undefined;
      if (target) edges.push({ fromId: cell.id, toId: target.id, member: m.name, memberCellId: m.id, slot });
    });
  }
  return edges;
}

function inDegrees(cells: NormalizedCell[], edges: ShapeEdge[]): Map<string, number> {
  const indeg = new Map(cells.map((c) => [c.id, 0]));
  for (const e of edges) indeg.set(e.toId, (indeg.get(e.toId) ?? 0) + 1);
  return indeg;
}

/** Node ids pointed at by stack/global cells (the algorithm's "fingers"). */
function fingerTargets(links: MemoryLink[], nodeIds: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const l of links) {
    if (nodeIds.has(l.toId) && !l.fromId.startsWith("heap-")) out.add(l.toId);
  }
  return out;
}

function toShapeNode(cell: NormalizedCell): ShapeNode {
  const self = new Set(selfPtrMembers(cell).map((m) => m.id));
  const payload = (cell.children ?? []).filter((c) => !self.has(c.id));
  const leaves = (cs: NormalizedCell[]): NormalizedCell[] =>
    cs.flatMap((c) => (c.children?.length ? leaves(c.children) : [c]));
  return {
    id: cell.id,
    address: cell.address as string,
    label: payload.map((p) => p.displayValue).join(", ") || cell.displayValue,
    payloadIds: leaves(payload).map((c) => c.id),
    cell,
  };
}

/** Tolerant per-step list walk: never fails; convergence and cycles both render. */
function buildListModel(g: TypeGroup, links: MemoryLink[]): ShapeModel {
  const edges = buildEdges(g);
  const indeg = inDegrees(g.cells, edges);
  const next = new Map(edges.map((e) => [e.fromId, e]));
  const nodeIds = new Set(g.cells.map((c) => c.id));
  const fingers = fingerTargets(links, nodeIds);

  const visited = new Set<string>();
  const chains: string[][] = [];
  const walk = (startId: string) => {
    if (visited.has(startId)) return;
    const chain: string[] = [];
    let id: string | undefined = startId;
    while (id !== undefined && !visited.has(id)) {
      visited.add(id);
      chain.push(id);
      const e = next.get(id);
      if (e && chain.includes(e.toId)) e.cycleBack = true;
      id = e?.toId;
    }
    chains.push(chain);
  };

  const headIds = g.cells.filter((c) => (indeg.get(c.id) ?? 0) === 0).map((c) => c.id);
  // Finger-entered chains first so the "real" list is the top row.
  for (const id of headIds.filter((h) => fingers.has(h))) walk(id);
  for (const id of headIds) walk(id);
  for (const c of g.cells) walk(c.id); // pure cycles have no head

  const detached = chains.filter((ch) => !ch.some((id) => fingers.has(id))).flat();
  return {
    kind: "list", typeName: g.typeName,
    nodes: g.cells.map(toShapeNode), edges, groups: chains, detached,
  };
}

export function applyShapes(
  memory: NormalizedMemory,
  confirmed: Map<string, "list" | "tree">,
  disabledTypes: Set<string>,
): ShapeResult {
  const shapes: ShapeModel[] = [];
  const consumedIds = new Set<string>();
  for (const g of collectGroups(memory).values()) {
    const kind = confirmed.get(g.typeName);
    if (!kind || disabledTypes.has(g.typeName)) continue;
    const shape = kind === "list" ? buildListModel(g, memory.links) : buildTreeModel(g, memory.links);
    shapes.push(shape);
    for (const n of shape.nodes) consumedIds.add(n.id);
  }
  if (shapes.length === 0) return { memory, shapes };
  return {
    memory: { ...memory, heap: memory.heap.filter((c) => !consumedIds.has(c.id)) },
    shapes,
  };
}

/** Tolerant per-step tree walk: pre-order from in-degree-0 roots; a node is
 *  laid out under its first-seen parent; extra edges (transient double parent,
 *  cycles) stay in `edges` but do not re-enter the traversal. */
function buildTreeModel(g: TypeGroup, links: MemoryLink[]): ShapeModel {
  const edges = buildEdges(g);
  const indeg = inDegrees(g.cells, edges);
  const nodeIds = new Set(g.cells.map((c) => c.id));
  const fingers = fingerTargets(links, nodeIds);
  const children = new Map<string, ShapeEdge[]>();
  for (const e of edges) {
    const list = children.get(e.fromId) ?? [];
    list.push(e);
    children.set(e.fromId, list);
  }

  const visited = new Set<string>();
  const groups: string[][] = [];
  const preorder = (rootId: string) => {
    if (visited.has(rootId)) return;
    const order: string[] = [];
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      order.push(id);
      const kids = (children.get(id) ?? []).slice().sort((a, b) => b.slot - a.slot);
      for (const e of kids) stack.push(e.toId);
    }
    groups.push(order);
  };

  const rootIds = g.cells.filter((c) => (indeg.get(c.id) ?? 0) === 0).map((c) => c.id);
  for (const id of rootIds.filter((r) => fingers.has(r))) preorder(id);
  for (const id of rootIds) preorder(id);
  for (const c of g.cells) preorder(c.id); // leftover = cycle component; still shown

  const detached = groups.filter((grp) => !grp.some((id) => fingers.has(id))).flat();
  return { kind: "tree", typeName: g.typeName, nodes: g.cells.map(toShapeNode), edges, groups, detached };
}
