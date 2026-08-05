import { normalizeMemory, type NormalizedMemory, type NormalizedCell } from "../memoryModel";
import type { ExecPoint } from "../../types/trace";

export type GraphKind = "adjlist" | "matrix" | "grid";
export type ViewAs = "auto" | "graph" | "grid";
export interface GraphNode { id: string; label: string; row?: number; col?: number; }
export interface GraphEdge { from: string; to: string; directed: boolean; dangling?: boolean; weight?: number; }
export interface GraphOverlays {
  visited: Set<string>; current: string[]; frontier: Set<string>;
  order: Map<string, number>; flashed: Set<string>;
}
export interface GraphScene {
  kind: GraphKind; nodes: GraphNode[]; edges: GraphEdge[];
  overlays: GraphOverlays; rows?: number; cols?: number;
  dist?: Map<string, string>;
}

const emptyOverlays = (): GraphOverlays => ({
  visited: new Set(), current: [], frontier: new Set(),
  order: new Map(), flashed: new Set(),
});

/** Depth-first collect every container/array cell in globals + all frames. */
export function findContainers(mem: NormalizedMemory): NormalizedCell[] {
  const out: NormalizedCell[] = [];
  const walk = (c: NormalizedCell) => {
    if (c.kind === "container" || c.kind === "array") out.push(c);
    c.children?.forEach(walk);
  };
  mem.globals.forEach(walk);
  mem.frames.forEach((f) => f.cells.forEach(walk));
  return out;
}

/** A vector<vector<scalar>> reads as rows of scalar displayValues. Null otherwise. */
export function readMatrix(cell: NormalizedCell): string[][] | null {
  if (!(cell.kind === "container" || cell.kind === "array")) return null;
  const rows = cell.children ?? [];
  if (rows.length === 0) return null;
  const out: string[][] = [];
  for (const row of rows) {
    if (!(row.kind === "container" || row.kind === "array") || !row.children) return null;
    // A pair/tuple is a fixed heterogeneous record, not a matrix row: a
    // vector<pair<int,int>> (e.g. knapsack {weight,value} items) must not read
    // as a 2-column int matrix and get mistaken for an adjacency structure.
    const rk = (row.containerKind ?? "").toLowerCase();
    if (rk === "pair" || rk === "tuple") return null;
    if (row.children.some((x) => x.kind !== "scalar")) return null;
    out.push(row.children.map((x) => x.displayValue));
  }
  return out;
}

/** vector<vector<pair<int,int>>> → per-row [{to, weight}]. Null if any row
 *  isn't entirely 2-int pairs (so plain int matrices fall through). */
export function readWeightedAdjList(cell: NormalizedCell): { to: number; weight: number }[][] | null {
  if (!(cell.kind === "container" || cell.kind === "array")) return null;
  const rows = cell.children ?? [];
  if (rows.length === 0) return null;
  const out: { to: number; weight: number }[][] = [];
  for (const r of rows) {
    if (!(r.kind === "container" || r.kind === "array") || !r.children) return null;
    const pairs: { to: number; weight: number }[] = [];
    for (const el of r.children) {
      const kids = el.children;
      if (!kids || kids.length !== 2) return null;
      if (!kids.every((k) => k.kind === "scalar" && isIntLabel(k.displayValue))) return null;
      pairs.push({ to: Number(kids[0].displayValue), weight: Number(kids[1].displayValue) });
    }
    out.push(pairs);
  }
  return out;
}

export interface Edge { u: number; v: number; weight?: number }

interface ParsedRow { u: number; v: number; weight?: number; plain: boolean }

function intVal(c: NormalizedCell): number | null {
  return c.kind === "scalar" && isIntLabel(c.displayValue) ? Number(c.displayValue) : null;
}

/** Parse one edge-list row into {u,v,weight?}. `plain` = the ambiguous
 *  vector<int> row shape (needs a name gate); pair/tuple/array are unambiguous. */
function parseEdgeRow(r: NormalizedCell): ParsedRow | null {
  const kind = (r.containerKind ?? "").toLowerCase();
  const kids = r.children ?? [];

  // nested pair {w, {u, v}}  (kruskal-style {weight,{u,v}})
  if (kind === "pair" && kids.length === 2) {
    const w = intVal(kids[0]);
    const inner = kids[1];
    if (w != null && (inner.containerKind ?? "").toLowerCase() === "pair") {
      const ik = inner.children ?? [];
      const u = ik[0] && intVal(ik[0]);
      const v = ik[1] && intVal(ik[1]);
      if (ik.length === 2 && u != null && v != null) return { u, v, weight: w, plain: false };
    }
  }

  // flat 2- or 3-scalar row: pair / tuple / array / vector of ints
  if (kids.length === 2 || kids.length === 3) {
    const nums = kids.map(intVal);
    if (nums.every((x) => x != null)) {
      const [u, v, w] = nums as number[];
      const plain = kind !== "pair" && kind !== "tuple" && kind !== "array";
      return kids.length === 3 ? { u, v, weight: w, plain } : { u, v, plain };
    }
  }
  return null;
}

const EDGE_NAME = /edges?|edgelist|times|prerequisites|adj_?edges|^e$/i;
const MOVE_NAME = /dir|delta|move|offset|step/i;

/** Detect an edge list: each row/element is one edge {u,v} or {u,v,w}. The
 *  ambiguous vector<vector<int>> shape is gated on an edge-ish container name
 *  (else it stays an adjacency list); the dedicated pair/array/tuple shapes
 *  need only the movement-vector guard. Negative endpoints ⇒ not an edge list. */
export function readEdgeList(cell: NormalizedCell): Edge[] | null {
  if (!(cell.kind === "container" || cell.kind === "array")) return null;
  const rows = cell.children ?? [];
  if (rows.length === 0) return null;

  const parsed: ParsedRow[] = [];
  for (const r of rows) {
    const p = parseEdgeRow(r);
    if (!p) return null;
    parsed.push(p);
  }
  if (parsed.some((p) => p.u < 0 || p.v < 0)) return null;

  const name = cell.name ?? "";
  if (parsed.some((p) => p.plain)) {
    if (!EDGE_NAME.test(name)) return null;
  } else if (MOVE_NAME.test(name)) {
    return null;
  }
  return parsed.map(({ u, v, weight }) => (weight != null ? { u, v, weight } : { u, v }));
}

function weightedAdjListScene(rows: { to: number; weight: number }[][]): GraphScene {
  const n = rows.length;
  const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({ id: String(i), label: String(i) }));
  const edges: GraphEdge[] = [];
  rows.forEach((row, u) => row.forEach(({ to, weight }) => {
    edges.push({ from: String(u), to: String(to), directed: true, weight, dangling: to < 0 || to >= n });
  }));
  return { kind: "adjlist", nodes, edges, overlays: emptyOverlays() };
}

/** Largest int value of a scalar whose name matches `re`, scanning globals +
 *  all frames (recurses into children). Null if none. Used to read a node
 *  COUNT (`n`/`N`/`V`) that an edge list does not itself carry. */
function findNamedIntScalar(mem: NormalizedMemory, re: RegExp): number | null {
  let best: number | null = null;
  const walk = (c: NormalizedCell) => {
    if (c.kind === "scalar" && re.test(c.name) && isIntLabel(c.displayValue)) {
      const v = Number(c.displayValue);
      if (best == null || v > best) best = v;
    }
    c.children?.forEach(walk);
  };
  mem.globals.forEach(walk);
  mem.frames.forEach((f) => f.cells.forEach(walk));
  return best;
}

const NODE_COUNT_NAME = /^(n|v|numnodes|nodes|vertices)$/i;

export function edgeListScene(edges: Edge[], mem: NormalizedMemory): GraphScene {
  let maxId = 0;
  for (const e of edges) maxId = Math.max(maxId, e.u, e.v);
  let count = maxId + 1;
  const declared = findNamedIntScalar(mem, NODE_COUNT_NAME);
  if (declared != null && declared > maxId) count = declared;

  const nodes: GraphNode[] = Array.from({ length: count }, (_, i) => ({ id: String(i), label: String(i) }));
  const gedges: GraphEdge[] = edges.map((e) => ({
    from: String(e.u), to: String(e.v), directed: true,
    ...(e.weight != null ? { weight: e.weight } : {}),
    dangling: e.u >= count || e.v >= count,
  }));
  return { kind: "adjlist", nodes, edges: gedges, overlays: emptyOverlays() };
}

function isIntLabel(s: string): boolean { return /^-?\d+$/.test(s); }

// normalizeMemory is pure per ExecPoint; bindOrder re-derives the visited set
// for trace[0..index] on every scene build, so without memoization a full-trace
// scan re-normalizes each point O(n) times (O(n^2) overall). Cache by point
// identity — a behavioural no-op that keeps the seek-safe order affordable.
const normCache = new WeakMap<ExecPoint, NormalizedMemory>();
function norm(point: ExecPoint): NormalizedMemory {
  let m = normCache.get(point);
  if (!m) { m = normalizeMemory(point); normCache.set(point, m); }
  return m;
}

function frameNodeId(frame: { cells: NormalizedCell[] }, kind: GraphKind): string | null {
  const ints = frame.cells.filter((c) => c.kind === "scalar" && isIntLabel(c.displayValue));
  if (kind === "grid") {
    const rc = frame.cells.filter((c) => /^(i|j|r|c|row|col|x|y)$/i.test(c.name) && isIntLabel(c.displayValue));
    if (rc.length >= 2) return `${rc[0].displayValue},${rc[1].displayValue}`;
    return null;
  }
  const named = frame.cells.find((c) => /^(node|curr|cur|n|u|v|src|start)$/i.test(c.name) && isIntLabel(c.displayValue));
  return (named ?? ints[0])?.displayValue ?? null;
}

function bindCurrent(mem: NormalizedMemory, scene: GraphScene): void {
  // frames are outermost-first in NormalizedMemory; reverse for top-first path.
  const frames = [...mem.frames].reverse();
  for (const f of frames) {
    const id = frameNodeId(f, scene.kind);
    if (id && scene.nodes.some((n) => n.id === id)) scene.overlays.current.push(id);
  }
}

export function isCharMatrix(cell: NormalizedCell): boolean {
  const t = `${cell.elementType ?? ""} ${cell.type ?? ""}`.toLowerCase();
  return t.includes("char");
}

function isRectangular(matrix: string[][]): boolean {
  const w = matrix[0]?.length ?? 0;
  return w > 0 && matrix.every((r) => r.length === w);
}

export function isBinarySquare(matrix: string[][]): boolean {
  const n = matrix.length;
  if (n === 0) return false;
  return matrix.every((r) => r.length === n && r.every((v) => v === "0" || v === "1"));
}

export function isAdjacencyMatrix(m: string[][]): boolean {
  const n = m.length;
  if (n === 0) return false;
  if (!m.every((r) => r.length === n && r.every(isIntLabel))) return false; // square int
  const binary = m.every((r) => r.every((v) => v === "0" || v === "1"));
  if (binary) return true;                          // preserves isBinarySquare behavior
  const zeroDiag = m.every((r, i) => r[i] === "0");
  const anyOverN = m.some((r) => r.some((v) => Number(v) >= n)); // can't be a node id ⇒ weight
  return anyOverN || zeroDiag;
}

function isBinaryMatrix(m: string[][]): boolean {
  return m.every((r) => r.every((v) => v === "0" || v === "1"));
}

function gridScene(matrix: string[][]): GraphScene {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const nodes: GraphNode[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      nodes.push({ id: `${r},${c}`, label: matrix[r][c], row: r, col: c });
  return { kind: "grid", nodes, edges: [], overlays: emptyOverlays(), rows, cols };
}

function matrixScene(matrix: string[][], weighted: boolean): GraphScene {
  const n = matrix.length;
  const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({ id: String(i), label: String(i) }));
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (matrix[i][j] === "0") continue;
      const back = matrix[j]?.[i];
      const directed = back !== matrix[i][j];       // asymmetric weight (incl back 0) ⇒ directed
      const key = directed ? `${i}>${j}` : [i, j].sort((a, b) => a - b).join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: String(i), to: String(j), directed,
        ...(weighted ? { weight: Number(matrix[i][j]) } : {}) });
    }
  }
  return { kind: "matrix", nodes, edges, overlays: emptyOverlays() };
}

/** Build an adjacency-list scene from a vector<vector<int>> matrix. */
function adjlistScene(matrix: string[][]): GraphScene {
  const n = matrix.length;
  const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({
    id: String(i), label: String(i),
  }));
  const edges: GraphEdge[] = [];
  matrix.forEach((row, i) => {
    row.forEach((v) => {
      if (!isIntLabel(v)) return;
      const to = Number(v);
      edges.push({ from: String(i), to: String(to), directed: true,
        dangling: to < 0 || to >= n });
    });
  });
  return { kind: "adjlist", nodes, edges, overlays: emptyOverlays() };
}

function hasPairQueue(mem: NormalizedMemory): boolean {
  return findContainers(mem).some((c) => {
    const k = (c.containerKind ?? "").toLowerCase();
    // priority_queue<pair<int,int>> is dijkstra's {dist,node}/{weight,node}
    // minHeap over graph nodes, not a grid BFS/DFS frontier of {r,c} cells —
    // only a plain FIFO queue or stack of pairs implies a grid.
    if (k.includes("priority_queue")) return false;
    if (!(k.includes("queue") || k.includes("stack"))) return false;
    return (c.children ?? []).some((child) =>
      (child.children?.length ?? 0) === 2 ||
      (child.type ?? "").toLowerCase().includes("pair"));
  });
}

function looksLikeGrid(matrix: string[][], mem: NormalizedMemory, name: string): boolean {
  if (hasPairQueue(mem)) return true;                 // BFS over cells: strongest signal
  // A square binary matrix is an adjacency matrix, not a grid, even if its name
  // happens to contain "matrix" (e.g. `adjMatrix`) — the name heuristic below
  // must not override that unless a queue<pair> already proved otherwise above.
  if (isBinarySquare(matrix)) return false;
  if (/grid|board|maze|image|matrix/i.test(name)) return true;
  // small value alphabet not usable as node indices (e.g. only 0/1/2) over a
  // rectangular non-square shape is grid-ish; square binary already handled as matrix.
  if (isRectangular(matrix) && matrix.length !== (matrix[0]?.length ?? 0)) {
    const vals = new Set(matrix.flat());
    if ([...vals].every((v) => Number(v) >= 0 && Number(v) <= 2)) return true;
  }
  return false;
}

function truthyScalar(v: string): boolean {
  return v === "true" || v === "1" || (isIntLabel(v) && Number(v) !== 0);
}

function visitedIdsAt(point: ExecPoint, kindHint: GraphScene, trace: ExecPoint[]): Set<string> {
  // reuse detection on a point's memory to read its visited set
  const mem = norm(point);
  const scene = { ...kindHint, overlays: {
    visited: new Set<string>(), current: [], frontier: new Set<string>(),
    order: new Map<string, number>(), flashed: new Set<string>() } };
  bindVisited(mem, scene, trace);
  return scene.overlays.visited;
}

function bindOrder(trace: ExecPoint[], index: number, scene: GraphScene): void {
  let counter = 0;
  const prev = new Set<string>();
  for (let s = 0; s <= index; s++) {
    const now = visitedIdsAt(trace[s], scene, trace);
    for (const id of now) if (!prev.has(id)) { prev.add(id); scene.overlays.order.set(id, ++counter); }
  }
}

function bindFlash(prevMem: NormalizedMemory | null, mem: NormalizedMemory, scene: GraphScene): void {
  if (scene.kind !== "grid" || !prevMem) return;
  const cur = readGridMatrix(mem, scene);
  const old = readGridMatrix(prevMem, scene);
  if (!cur || !old) return;
  for (let r = 0; r < scene.rows!; r++)
    for (let c = 0; c < scene.cols!; c++)
      if (cur[r]?.[c] !== old[r]?.[c]) scene.overlays.flashed.add(`${r},${c}`);
}

/** The grid's initial state: its value matrix at the first step it exists.
 *  (The grid is usually constructed a few steps into main, so this breaks
 *  early; it is not necessarily present at trace[0].) */
function gridBaseline(trace: ExecPoint[], scene: GraphScene): string[][] | null {
  for (let s = 0; s < trace.length; s++) {
    const m = readGridMatrix(norm(trace[s]), scene);
    if (m) return m;
  }
  return null;
}

/** Re-read the grid's value matrix from a memory snapshot (same detector shape). */
function readGridMatrix(mem: NormalizedMemory, scene: GraphScene): string[][] | null {
  for (const c of findContainers(mem)) {
    const m = readMatrix(c);
    if (m && m.length === scene.rows && (m[0]?.length ?? 0) === scene.cols) return m;
  }
  return null;
}

function bindVisited(mem: NormalizedMemory, scene: GraphScene, trace: ExecPoint[]): void {
  if (scene.kind === "grid") {
    bindGridVisited(mem, scene, trace);
    return;
  }
  // adjlist/matrix: a flat vector<bool|int> of length nodeCount named visit/seen/vis
  const nodeCount = scene.nodes.length;
  for (const c of findContainers(mem)) {
    const flat = c.children;
    if (!flat || flat.length !== nodeCount) continue;
    if (flat.some((x) => x.kind !== "scalar")) continue;
    if (!/visit|seen|vis/i.test(c.name)) continue;
    flat.forEach((x, i) => { if (truthyScalar(x.displayValue)) scene.overlays.visited.add(String(i)); });
    return;
  }
}

/**
 * Grid "visited already" comes from two sources, unioned:
 *  1. Cumulative in-place mutation — a cell whose value now differs from its
 *     value at trace start. This is the general trail for grids that overwrite
 *     themselves (islands 1->0, rotting 1->2, floodFill) and carry no visited
 *     array. Reads the scene's own grid via the same selector as bindFlash.
 *  2. An explicit same-dims `visit`/`seen` matrix (immutable-grid problems like
 *     pacific-atlantic that track visited separately), truthy cells.
 */
function bindGridVisited(mem: NormalizedMemory, scene: GraphScene, trace: ExecPoint[]): void {
  const cur = readGridMatrix(mem, scene);
  const start = gridBaseline(trace, scene);
  if (cur && start) {
    for (let r = 0; r < scene.rows!; r++)
      for (let c = 0; c < scene.cols!; c++)
        if (cur[r]?.[c] !== start[r]?.[c]) scene.overlays.visited.add(`${r},${c}`);
  }
  for (const cont of findContainers(mem)) {
    if (!/visit|seen|vis/i.test(cont.name)) continue;
    const m = readMatrix(cont);
    if (!m || m.length !== scene.rows || (m[0]?.length ?? 0) !== scene.cols) continue;
    m.forEach((row, r) => row.forEach((v, col) => {
      if (truthyScalar(v)) scene.overlays.visited.add(`${r},${col}`);
    }));
  }
}

function pairId(cell: NormalizedCell): string | null {
  const kids = cell.children;
  if (kids && kids.length === 2 && kids.every((k) => k.kind === "scalar" && isIntLabel(k.displayValue)))
    return `${kids[0].displayValue},${kids[1].displayValue}`;
  return null;
}

function bindFrontier(mem: NormalizedMemory, scene: GraphScene): void {
  for (const c of findContainers(mem)) {
    const k = (c.containerKind ?? "").toLowerCase();
    if (!(k.includes("queue") || k.includes("stack"))) continue;
    if (c.placeholders) continue;
    for (const el of c.children ?? []) {
      if (scene.kind === "grid") {
        const id = pairId(el);
        if (id) scene.overlays.frontier.add(id);
      } else if (el.kind === "scalar" && isIntLabel(el.displayValue)) {
        scene.overlays.frontier.add(el.displayValue);
      } else {
        // {dist,node} / {weight,node} pair ⇒ node is the second element
        const kids = el.children;
        if (kids && kids.length === 2 && kids.every((k) => k.kind === "scalar" && isIntLabel(k.displayValue)))
          scene.overlays.frontier.add(kids[1].displayValue);
      }
    }
    if (scene.overlays.frontier.size > 0) return;
  }
}

/**
 * Cheap structural check: would `buildGraphScene(mem, …, "auto")` produce a
 * scene for this memory? Mirrors the auto-mode qualification (allInt always
 * qualifies; a char matrix only when rectangular) without the O(prefix)
 * overlay/order recompute, so it is safe to scan across a whole trace.
 */
export function hasGraphContent(mem: NormalizedMemory): boolean {
  for (const c of findContainers(mem)) {
    const m = readMatrix(c);
    if (!m || m.length === 0) continue;
    if (m.every((r) => r.every(isIntLabel))) return true;
    if (isCharMatrix(c) && isRectangular(m)) return true;
  }
  return false;
}

const INT_MAX_LABEL = "2147483647";

function isFlatDistCandidate(c: NormalizedCell, n: number): boolean {
  const flat = c.children;
  return !!flat && flat.length === n && flat.every((x) => x.kind === "scalar");
}

function distToMap(flat: NormalizedCell[]): Map<string, string> {
  const map = new Map<string, string>();
  flat.forEach((x, i) => map.set(String(i), x.displayValue === INT_MAX_LABEL ? "∞" : x.displayValue));
  return map;
}

/** Identify the dist/effort container in a memory snapshot, if any is
 *  currently distinguishable. Named containers (`dist`/`effort`) win. Falls
 *  back to a length-n scalar vector that still contains the INT_MAX sentinel
 *  (the unmistakable fingerprint of an unrelaxed shortest-distance slot) —
 *  needed because `vector<int> dist(...)` returned by value from a
 *  dijkstra-style function is routinely NRVO'd by the compiler: the local is
 *  constructed directly in the caller's return slot, so the trace never
 *  carries a container literally named "dist", only the caller's `res`. */
function identifyDistContainer(mem: NormalizedMemory, n: number): NormalizedCell | null {
  for (const c of findContainers(mem)) {
    if (!/dist|effort/i.test(c.name)) continue;
    if (!isFlatDistCandidate(c, n)) continue;
    return c;
  }
  for (const c of findContainers(mem)) {
    if (!isFlatDistCandidate(c, n)) continue;
    if (!c.children!.some((x) => x.displayValue === INT_MAX_LABEL)) continue;
    return c;
  }
  return null;
}

function findContainerByAddress(mem: NormalizedMemory, address: string | null): NormalizedCell | null {
  if (!address) return null;
  for (const c of findContainers(mem)) if (c.address === address) return c;
  return null;
}

/** Flat vector<int>/vector<double> of shortest distances/effort, keyed by node
 *  index; INT_MAX (2147483647) reads as unreachable ⇒ "∞". Skips grid scenes.
 *
 *  Once every node is relaxed, no INT_MAX sentinel remains in the vector, so
 *  the current step alone can no longer distinguish the dist vector from any
 *  other same-length int vector (e.g. the adjacency row it was just compared
 *  against) — the identification signal that worked pre-convergence vanishes
 *  exactly when a user wants to read the converged answer. Recover it by
 *  container address: scan backward for the most recent earlier step where
 *  it WAS identifiable (name match, or INT_MAX still present), capture that
 *  container's stable stack address, then re-read the SAME address's (now
 *  fully-relaxed) values in the current step's memory. A stack local's
 *  address is stable for the lifetime of its frame, so this persists the
 *  dist badges through convergence instead of losing them. */
function bindDist(mem: NormalizedMemory, scene: GraphScene, trace: ExecPoint[], index: number): void {
  if (scene.kind === "grid") return;
  const n = scene.nodes.length;
  const direct = identifyDistContainer(mem, n);
  if (direct) { scene.dist = distToMap(direct.children!); return; }
  for (let s = index - 1; s >= 0; s--) {
    const past = identifyDistContainer(norm(trace[s]), n);
    if (!past || !past.address) continue;
    const here = findContainerByAddress(mem, past.address);
    if (here && isFlatDistCandidate(here, n)) { scene.dist = distToMap(here.children!); return; }
  }
}

export function buildGraphScene(
  mem: NormalizedMemory, prevMem: NormalizedMemory | null,
  trace: ExecPoint[], index: number, viewAs: ViewAs = "auto",
): GraphScene | null {
  const finish = (scene: GraphScene): GraphScene => {
    bindVisited(mem, scene, trace);
    bindFrontier(mem, scene);
    bindCurrent(mem, scene);
    bindOrder(trace, index, scene);
    bindFlash(prevMem, mem, scene);
    bindDist(mem, scene, trace, index);
    return scene;
  };

  // Weighted adjacency list wins over an edge-list param that would otherwise
  // shadow it (both are vector<vector<int|pair>>; the pair form is unambiguous).
  if (viewAs !== "grid") {
    for (const c of findContainers(mem)) {
      const wadj = readWeightedAdjList(c);
      if (wadj && wadj.some((r) => r.length > 0)) return finish(weightedAdjListScene(wadj));
    }
  }

  for (const c of findContainers(mem)) {
    const m = readMatrix(c);
    if (!m || m.length === 0) continue;
    const rectangular = isRectangular(m);
    const allInt = m.every((r) => r.every(isIntLabel));
    const isChar = isCharMatrix(c);
    if (!isChar && !allInt) continue;               // not a graph/grid container

    if (viewAs === "grid") return finish(gridScene(m));
    if (viewAs === "graph" && allInt)
      return finish(isAdjacencyMatrix(m) ? matrixScene(m, !isBinaryMatrix(m)) : adjlistScene(m));

    // auto
    if (isChar && rectangular) return finish(gridScene(m));
    if (allInt) {
      if (looksLikeGrid(m, mem, c.name)) return finish(gridScene(m));
      if (isAdjacencyMatrix(m)) return finish(matrixScene(m, !isBinaryMatrix(m)));
      return finish(adjlistScene(m));
    }
  }
  return null;
}
