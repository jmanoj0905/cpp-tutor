import { describe, it, expect } from "vitest";
import { isAdjacencyMatrix, buildGraphScene } from "../../src/viz/graph/graphModel";
import { normalizeMemory } from "../../src/viz/memoryModel";
import dijkstra from "../fixtures/graph/dijkstra.json";

describe("isAdjacencyMatrix", () => {
  const dijkstraMatrix = [["0","1","6"],["1","0","3"],["6","3","0"]];
  it("accepts a zero-diagonal weighted square (dijkstra)", () => {
    expect(isAdjacencyMatrix(dijkstraMatrix)).toBe(true);
  });
  it("accepts a binary square (unweighted)", () => {
    expect(isAdjacencyMatrix([["0","1"],["1","0"]])).toBe(true);
  });
  it("accepts a square with a value >= N (must be a weight)", () => {
    expect(isAdjacencyMatrix([["0","9"],["1","0"]])).toBe(true);
  });
  it("rejects a ragged adjacency list", () => {
    expect(isAdjacencyMatrix([["1"],["0","2"],["1"]])).toBe(false);
  });
  it("rejects a non-int matrix", () => {
    expect(isAdjacencyMatrix([["a","b"],["c","d"]])).toBe(false);
  });

  it("builds a weighted undirected matrix scene for dijkstra", () => {
    const trace = (dijkstra as any).trace;
    let scene = null;
    for (let s = 0; s < trace.length; s++) {
      const sc = buildGraphScene(normalizeMemory(trace[s]), null, trace, s);
      if (sc && sc.kind === "matrix" && sc.nodes.length === 3 && sc.edges.some((e) => e.weight != null)) { scene = sc; break; }
    }
    expect(scene).not.toBeNull();
    // symmetric 3x3 {1,6,3} ⇒ 3 undirected edges, deduped
    expect(scene!.edges.length).toBe(3);
    expect(scene!.edges.every((e) => e.directed === false)).toBe(true);
    expect(new Set(scene!.edges.map((e) => e.weight)).size).toBe(3); // weights 1,6,3 distinct
  });
});
