import { describe, it, expect } from "vitest";
import { isAdjacencyMatrix, buildGraphScene, readWeightedAdjList } from "../../src/viz/graph/graphModel";
import { normalizeMemory } from "../../src/viz/memoryModel";
import type { NormalizedCell } from "../../src/viz/memoryModel";
import dijkstra from "../fixtures/graph/dijkstra.json";
import shortestPathDAG from "../fixtures/graph/shortestPathDAG.json";

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

const scalar = (v: string): NormalizedCell => ({ id: v, kind: "scalar", name: "", type: "int", displayValue: v } as any);
const pair = (a: string, b: string): NormalizedCell => ({ id: `p${a}${b}`, kind: "container", containerKind: "pair", name: "", type: "pair", displayValue: "", children: [scalar(a), scalar(b)] } as any);
const row = (...ps: NormalizedCell[]): NormalizedCell => ({ id: "row", kind: "container", name: "", type: "vector", displayValue: "", children: ps } as any);
const outer = (...rows: NormalizedCell[]): NormalizedCell => ({ id: "adj", kind: "container", name: "adj", type: "vector", displayValue: "", children: rows } as any);

describe("readWeightedAdjList", () => {
  it("reads pair rows as {to, weight}", () => {
    const cell = outer(row(pair("1", "5")), row(pair("2", "3"), pair("0", "7")));
    expect(readWeightedAdjList(cell)).toEqual([[{ to: 1, weight: 5 }], [{ to: 2, weight: 3 }, { to: 0, weight: 7 }]]);
  });
  it("returns null for a plain int matrix (scalar rows)", () => {
    const cell = outer(row(scalar("0"), scalar("1")), row(scalar("1"), scalar("0")));
    expect(readWeightedAdjList(cell)).toBeNull();
  });
  it("returns null for a single-level vector<pair> (not vector<vector<pair>>)", () => {
    const cell = row(pair("1", "5"), pair("2", "3")); // rows are pairs; their children are scalars
    expect(readWeightedAdjList(cell)).toBeNull();
  });
});

it("builds a weighted directed adjlist for shortestPathDAG", () => {
  const trace = (shortestPathDAG as any).trace;
  let scene = null;
  for (let s = 0; s < trace.length; s++) {
    const sc = buildGraphScene(normalizeMemory(trace[s]), null, trace, s);
    if (sc && sc.kind === "adjlist" && sc.edges.some((e) => e.weight != null)) { scene = sc; break; }
  }
  expect(scene).not.toBeNull();
  expect(scene!.edges.every((e) => e.directed === true)).toBe(true);
});
