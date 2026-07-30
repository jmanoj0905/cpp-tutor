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

export function isBinarySquare(matrix: string[][]): boolean {
  const n = matrix.length;
  if (n === 0) return false;
  return matrix.every((r) => r.length === n && r.every((v) => v === "0" || v === "1"));
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

export function buildGraphScene(
  mem: NormalizedMemory, _prevMem: NormalizedMemory | null,
  _trace: ExecPoint[], _index: number, _viewAs: ViewAs = "auto",
): GraphScene | null {
  const containers = findContainers(mem);
  for (const c of containers) {
    const m = readMatrix(c);
    if (m && m.length > 0 && m.every((r) => r.every(isIntLabel))) {
      if (isBinarySquare(m)) return matrixScene(m);
      return adjlistScene(m);
    }
  }
  return null;
}
