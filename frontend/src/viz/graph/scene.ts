// Scene shapes for the Graph tab. A leaf module: it imports nothing from the
// rest of viz/, so both graphModel.ts (array-family scenes) and treeScene.ts
// (pointer-tree scenes) can depend on it without an import cycle. Previously
// treeScene could only take *types* from graphModel and had to keep its own
// copy of emptyOverlays and of the memory cache.

export type GraphKind = "adjlist" | "matrix" | "grid" | "tree";
export type ViewAs = "auto" | "graph" | "grid";

export interface GraphNode { id: string; label: string; row?: number; col?: number; }

export interface GraphEdge {
  from: string; to: string; directed: boolean; dangling?: boolean; weight?: number;
  /** Pointer trees only: index of the self-pointer member — 0 = left, 1 = right.
   *  Drives slot-aware placement in treeLayout. Absent on heap trees (A3) and
   *  on every array-family scene, which keep the even level spread. */
  slot?: number;
  /** Pointer trees only: this edge lies on the live recursion path. */
  onPath?: boolean;
}

export interface GraphOverlays {
  visited: Set<string>; current: string[]; frontier: Set<string>;
  order: Map<string, number>; flashed: Set<string>;
}

export interface GraphScene {
  kind: GraphKind; nodes: GraphNode[]; edges: GraphEdge[];
  overlays: GraphOverlays; rows?: number; cols?: number;
  dist?: Map<string, string>;
}

/** A scene with nothing bound yet. */
export const emptyOverlays = (): GraphOverlays => ({
  visited: new Set(), current: [], frontier: new Set(),
  order: new Map(), flashed: new Set(),
});
