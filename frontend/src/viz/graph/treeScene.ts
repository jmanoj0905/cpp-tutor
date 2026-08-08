// Pointer-tree (Family B) source for the Graph tab. Converts the ShapeModel
// that `shapes.ts` already detects into a GraphScene and binds traversal
// overlays. Pure — no React, no DOM.
//
// IMPORTANT: this module imports only TYPES from graphModel.ts (erased at build
// time). Importing a value from there would create a runtime import cycle,
// because graphModel.ts imports this module's entry point.
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
