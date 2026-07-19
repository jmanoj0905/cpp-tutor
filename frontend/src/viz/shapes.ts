// Pure shape detection for self-referential heap structs — no React, no DOM.
// A struct type with exactly 1 pointer-to-own-type member is a list candidate,
// exactly 2 is a binary-tree candidate. Detection is by member TYPE, not kind:
// a null `next` decodes as a scalar but keeps its `ListNode *` type.
import type { MemoryLink, NormalizedCell, NormalizedMemory } from "./memoryModel";
import { normalizeMemory } from "./memoryModel";
import type { ExecPoint } from "../types/trace";

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

/** Member names that are provably self-referential pointers on this struct type:
 *  either the member's own type string names this exact struct type (works when
 *  the trace preserves pointee types), or — real backend traces collapse every
 *  pointer member's type to the literal string "pointer", losing pointee info —
 *  the member resolves, in at least one instance within this same-type cell
 *  group, to another cell of this exact type via address. The address check is
 *  a strong signal: an unrelated pointer (e.g. `char*`, `int*`) essentially
 *  never resolves to a cell of the SAME struct type, so it can't false-positive.
 *
 *  A null "pointer"-typed member is NOT granted self-status here — that's
 *  undecidable from a single step's evidence alone (it could be a genuine
 *  self-pointer that's currently unset, or a genuinely unrelated field that's
 *  also null right now). Whole-trace evidence (see `confirmShapeTypes`) is
 *  what resolves members that are only ever proven self-referential at a
 *  LATER step; this per-cells-group function only ever sees one step. */
function selfPointerMemberNames(cells: NormalizedCell[]): Set<string> {
  const byAddr = new Map(cells.map((c) => [c.address as string, c]));
  const own = baseType(cells[0]?.type ?? null);
  const typedRe = own ? new RegExp(`^(struct\\s+|class\\s+)?${escapeRe(own)}\\s*\\*$`) : null;
  const names = new Set<string>();
  for (const cell of cells) {
    for (const m of cell.children ?? []) {
      if (!m.type) continue;
      if (typedRe && typedRe.test(m.type)) { names.add(m.name); continue; }
      if (m.type === "pointer" && m.targetAddress && byAddr.has(m.targetAddress)) names.add(m.name);
    }
  }
  return names;
}

function selfMembersOf(cell: NormalizedCell, selfNames: Set<string>): NormalizedCell[] {
  return (cell.children ?? []).filter((c) => selfNames.has(c.name));
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

interface TypeGroup {
  kind: "list" | "tree";
  typeName: string;
  cells: NormalizedCell[];
  selfNames: Set<string>;
}

/** Buckets heap structs (and struct elements of heap arrays) by type name. */
function bucketStructCells(memory: NormalizedMemory, byType: Map<string, NormalizedCell[]>): void {
  const bucket = (cell: NormalizedCell) => {
    if (cell.kind !== "struct" || !cell.address) return;
    const typeName = shapeTypeName(cell);
    if (!typeName) return;
    const arr = byType.get(typeName) ?? [];
    arr.push(cell);
    byType.set(typeName, arr);
  };
  for (const cell of memory.heap) {
    bucket(cell);
    if (cell.kind === "array" && cell.children) {
      // The real tracer wraps every `new`-allocated struct in a single-
      // element C_ARRAY at the same heap address. MemoryLink.toId (built by
      // resolveReferences) always points at the WRAPPER's id, never the
      // inner struct's array-indexed id. Alias the struct's id to the
      // wrapper's id here so ShapeNode.id (and therefore data-cell-id and
      // fingerTargets' nodeIds) matches what links actually resolve to.
      if (cell.children.length === 1 && cell.children[0].address === cell.address) {
        bucket({ ...cell.children[0], id: cell.id });
      } else {
        for (const child of cell.children) bucket(child);
      }
    }
  }
}

/** `namesOverride`, when provided, supplies whole-trace-proven self-pointer
 *  member names per type (see `confirmShapeTypes`) and wins over this single
 *  step's (possibly incomplete) per-step evidence. Without it, self-pointer
 *  names are derived fresh from this step's cells alone — the standalone/
 *  isolated-call fallback used by tests that build fictional well-typed data. */
export function collectGroups(
  memory: NormalizedMemory,
  namesOverride?: Map<string, Set<string>>,
): Map<string, TypeGroup> {
  const byType = new Map<string, NormalizedCell[]>();
  bucketStructCells(memory, byType);

  const groups = new Map<string, TypeGroup>();
  for (const [typeName, cells] of byType) {
    const selfNames = namesOverride?.get(typeName) ?? selfPointerMemberNames(cells);
    if (selfNames.size === 1 || selfNames.size === 2) {
      groups.set(typeName, { kind: selfNames.size === 1 ? "list" : "tree", typeName, cells, selfNames });
    }
  }
  return groups;
}

export function buildEdges(g: TypeGroup): ShapeEdge[] {
  const byAddr = new Map(g.cells.map((c) => [c.address as string, c]));
  const edges: ShapeEdge[] = [];
  for (const cell of g.cells) {
    selfMembersOf(cell, g.selfNames).forEach((m, slot) => {
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

function toShapeNode(cell: NormalizedCell, selfNames: Set<string>): ShapeNode {
  const self = new Set(selfMembersOf(cell, selfNames).map((m) => m.id));
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
    nodes: g.cells.map((c) => toShapeNode(c, g.selfNames)), edges, groups: chains, detached,
  };
}

export function applyShapes(
  memory: NormalizedMemory,
  confirmed: Map<string, "list" | "tree">,
  disabledTypes: Set<string>,
  selfNamesOverride?: Map<string, Set<string>>,
): ShapeResult {
  const shapes: ShapeModel[] = [];
  const consumedIds = new Set<string>();
  for (const g of collectGroups(memory, selfNamesOverride).values()) {
    const kind = confirmed.get(g.typeName);
    if (!kind || disabledTypes.has(g.typeName)) continue;
    const shape = kind === "list" ? buildListModel(g, memory.links) : buildTreeModel(g, memory.links);
    shapes.push(shape);
    for (const n of shape.nodes) consumedIds.add(n.id);
  }
  if (shapes.length === 0) return { memory, shapes };
  return { memory: { ...memory, heap: filterConsumedHeap(memory.heap, consumedIds) }, shapes };
}

/** Drops consumed struct cells from the top-level heap. A `new T()` struct
 *  is bucketed for shape detection from inside its wrapping single-element
 *  C_ARRAY (see `bucketStructCells`), so the struct's own id lands in
 *  `consumedIds` while the array wrapper's id does not — filter recurses
 *  into array cells so a fully-consumed wrapper (and not just its child)
 *  disappears from the generic heap render, while an array with any
 *  unconsumed sibling elements keeps those elements visible. */
function filterConsumedHeap(cells: NormalizedCell[], consumedIds: Set<string>): NormalizedCell[] {
  const out: NormalizedCell[] = [];
  for (const c of cells) {
    if (consumedIds.has(c.id)) continue;
    if (c.kind === "array" && c.children) {
      const kids = filterConsumedHeap(c.children, consumedIds);
      if (kids.length === 0) continue;
      out.push(kids.length === c.children.length ? c : { ...c, children: kids });
      continue;
    }
    out.push(c);
  }
  return out;
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
  return { kind: "tree", typeName: g.typeName, nodes: g.cells.map((c) => toShapeNode(c, g.selfNames)), edges, groups, detached };
}

export interface ShapeInfo {
  confirmed: Map<string, "list" | "tree">; // typeName -> kind, sticky for the whole trace
  firstSeen: Map<string, number>;          // heap address -> first step index (detail box "allocated at")
  selfNames: Map<string, Set<string>>;     // typeName -> proven self-pointer member names, whole-trace evidence
}

/** Strict clean-shape check used only for confirmation (never for rendering). */
function confirmGroup(g: TypeGroup): boolean {
  const edges = buildEdges(g);
  const indeg = inDegrees(g.cells, edges);

  if (g.kind === "tree") {
    if ([...indeg.values()].some((d) => d > 1)) return false;
    const children = new Map<string, string[]>();
    for (const e of edges) children.set(e.fromId, [...(children.get(e.fromId) ?? []), e.toId]);
    const visited = new Set<string>();
    const stack = g.cells.filter((c) => (indeg.get(c.id) ?? 0) === 0).map((c) => c.id);
    while (stack.length) {
      const id = stack.pop()!;
      if (visited.has(id)) return false; // in-degree check makes this a cycle
      visited.add(id);
      for (const kid of children.get(id) ?? []) stack.push(kid);
    }
    return visited.size === g.cells.length; // leftover nodes = cycle component
  }

  // list: chains from heads; a revisit is legal only as a back-edge into the
  // SAME chain (cycle). Convergence between chains = not a list.
  const next = new Map(edges.map((e) => [e.fromId, e.toId]));
  const chainOf = new Map<string, number>();
  let chain = 0;
  const walkStrict = (startId: string): boolean => {
    let id: string | undefined = startId;
    while (id !== undefined) {
      const seen = chainOf.get(id);
      if (seen !== undefined) return seen === chain; // own chain: cycle OK
      chainOf.set(id, chain);
      id = next.get(id);
    }
    return true;
  };
  for (const c of g.cells.filter((c) => (indeg.get(c.id) ?? 0) === 0)) {
    if (!walkStrict(c.id)) return false;
    chain++;
  }
  for (const c of g.cells) {
    if (chainOf.has(c.id)) continue; // pure cycle components
    if (!walkStrict(c.id)) return false;
    chain++;
  }
  return true;
}

/** One pass over the whole trace. A type is confirmed if ANY step shows it as
 *  a clean list/tree; confirmation is sticky. Also records each heap address's
 *  first step for the "allocated at step N" detail line. */
export function confirmShapeTypes(trace: ExecPoint[]): ShapeInfo {
  const firstSeen = new Map<string, number>();
  const cellsByType = new Map<string, NormalizedCell[]>();
  const perStepMemory: NormalizedMemory[] = [];

  trace.forEach((point, step) => {
    const heapKeys = Object.keys(point.heap ?? {});
    for (const addr of heapKeys) if (!firstSeen.has(addr)) firstSeen.set(addr, step);
    const memory = normalizeMemory(point);
    perStepMemory.push(memory);
    bucketStructCells(memory, cellsByType);
  });

  // Whole-trace evidence: a member proven self-referential at ANY step is
  // proven for the whole type, so e.g. a `right` child only ever populated
  // at a later step still counts even at earlier steps where it's null.
  const selfNames = new Map<string, Set<string>>();
  for (const [typeName, cells] of cellsByType) {
    const names = selfPointerMemberNames(cells);
    if (names.size === 1 || names.size === 2) selfNames.set(typeName, names);
  }

  const confirmed = new Map<string, "list" | "tree">();
  for (const memory of perStepMemory) {
    if (memory.heap.length === 0) continue;
    for (const g of collectGroups(memory, selfNames).values()) {
      if (confirmed.has(g.typeName)) continue;
      if (confirmGroup(g)) confirmed.set(g.typeName, g.kind);
    }
  }
  return { confirmed, firstSeen, selfNames };
}
