import type { NormalizedMemory, NormalizedCell } from "../memoryModel";
import type { ExecPoint } from "../../types/trace";

export type GraphKind = "adjlist" | "matrix" | "grid";
export type ViewAs = "auto" | "graph" | "grid";
export interface GraphNode { id: string; label: string; row?: number; col?: number; }
export interface GraphEdge { from: string; to: string; directed: boolean; dangling?: boolean; }
export interface GraphOverlays {
  visited: Set<string>; current: string[]; frontier: Set<string>;
  order: Map<string, number>; flashed: Set<string>;
}
export interface GraphScene {
  kind: GraphKind; nodes: GraphNode[]; edges: GraphEdge[];
  overlays: GraphOverlays; rows?: number; cols?: number;
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
    if (row.children.some((x) => x.kind !== "scalar")) return null;
    out.push(row.children.map((x) => x.displayValue));
  }
  return out;
}

function isIntLabel(s: string): boolean { return /^-?\d+$/.test(s); }

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

function gridScene(matrix: string[][]): GraphScene {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const nodes: GraphNode[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      nodes.push({ id: `${r},${c}`, label: matrix[r][c], row: r, col: c });
  return { kind: "grid", nodes, edges: [], overlays: emptyOverlays(), rows, cols };
}

function matrixScene(matrix: string[][]): GraphScene {
  const n = matrix.length;
  const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({ id: String(i), label: String(i) }));
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (matrix[i][j] !== "1") continue;
      const directed = matrix[j]?.[i] !== "1";      // asymmetric => directed
      const key = directed ? `${i}>${j}` : [i, j].sort((a, b) => a - b).join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: String(i), to: String(j), directed });
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

function bindVisited(mem: NormalizedMemory, scene: GraphScene): void {
  const nodeCount = scene.kind === "grid"
    ? (scene.rows ?? 0) * (scene.cols ?? 0)
    : scene.nodes.length;
  for (const c of findContainers(mem)) {
    if (!/visit|seen|vis|rott/i.test(c.name) && scene.kind !== "grid") {
      // name-agnostic fallback still allowed below; prefer named vectors first
    }
    // grid: a same-dims bool/int matrix
    if (scene.kind === "grid") {
      const m = readMatrix(c);
      if (m && m.length === scene.rows && m[0]?.length === scene.cols && m !== null) {
        if (/visit|seen|vis/i.test(c.name)) {
          m.forEach((row, r) => row.forEach((v, col) => {
            if (truthyScalar(v)) scene.overlays.visited.add(`${r},${col}`);
          }));
          return;
        }
      }
      continue;
    }
    // adjlist/matrix: a flat vector<bool|int> of length nodeCount
    const flat = c.children;
    if (!flat || flat.length !== nodeCount) continue;
    if (flat.some((x) => x.kind !== "scalar")) continue;
    if (!/visit|seen|vis/i.test(c.name)) continue;
    flat.forEach((x, i) => { if (truthyScalar(x.displayValue)) scene.overlays.visited.add(String(i)); });
    return;
  }
}

export function buildGraphScene(
  mem: NormalizedMemory, _prevMem: NormalizedMemory | null,
  _trace: ExecPoint[], _index: number, viewAs: ViewAs = "auto",
): GraphScene | null {
  const finish = (scene: GraphScene): GraphScene => {
    bindVisited(mem, scene);
    return scene;
  };

  for (const c of findContainers(mem)) {
    const m = readMatrix(c);
    if (!m || m.length === 0) continue;
    const rectangular = isRectangular(m);
    const allInt = m.every((r) => r.every(isIntLabel));
    const isChar = isCharMatrix(c);
    if (!isChar && !allInt) continue;               // not a graph/grid container

    if (viewAs === "grid") return finish(gridScene(m));
    if (viewAs === "graph" && allInt)
      return finish(isBinarySquare(m) ? matrixScene(m) : adjlistScene(m));

    // auto
    if (isChar && rectangular) return finish(gridScene(m));
    if (allInt) {
      if (looksLikeGrid(m, mem, c.name)) return finish(gridScene(m));
      if (isBinarySquare(m)) return finish(matrixScene(m));
      return finish(adjlistScene(m));
    }
  }
  return null;
}
