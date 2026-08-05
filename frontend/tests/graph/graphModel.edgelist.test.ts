import { describe, it, expect } from "vitest";
import { readEdgeList } from "../../src/viz/graph/graphModel";
import type { NormalizedCell } from "../../src/viz/memoryModel";

const scalar = (v: string): NormalizedCell =>
  ({ id: v, kind: "scalar", name: "", type: "int", displayValue: v } as any);

// a container row (vector<int> / array / pair / tuple) of scalar ints
const rowOf = (kind: string, ...vs: string[]): NormalizedCell =>
  ({ id: "r", kind: "container", containerKind: kind, name: "", type: kind,
     displayValue: "", children: vs.map(scalar) } as any);

// nested pair {w, {u, v}}
const nestedPair = (w: string, u: string, v: string): NormalizedCell =>
  ({ id: "np", kind: "container", containerKind: "pair", name: "", type: "pair",
     displayValue: "",
     children: [scalar(w), { id: "inner", kind: "container", containerKind: "pair",
       name: "", type: "pair", displayValue: "", children: [scalar(u), scalar(v)] }] } as any);

const outer = (name: string, ...rows: NormalizedCell[]): NormalizedCell =>
  ({ id: "o", kind: "container", containerKind: "vector", name, type: "vector",
     displayValue: "", children: rows } as any);

// an adaptor outer (queue/priority_queue/stack) — BFS frontier / min-heap,
// never an edge list even when its pair rows look like non-negative {u,v}.
const adaptorOuter = (containerKind: string, name: string, ...rows: NormalizedCell[]): NormalizedCell =>
  ({ id: "o", kind: "container", containerKind, name, type: containerKind,
     displayValue: "", children: rows } as any);

describe("readEdgeList", () => {
  it("reads vector<vector<int>> {u,v} rows when named 'edges'", () => {
    const cell = outer("edges", rowOf("vector", "0", "1"), rowOf("vector", "1", "2"));
    expect(readEdgeList(cell)).toEqual([{ u: 0, v: 1 }, { u: 1, v: 2 }]);
  });

  it("reads vector<vector<int>> {u,v,w} rows (times) as weighted", () => {
    const cell = outer("times", rowOf("vector", "0", "1", "5"), rowOf("vector", "1", "2", "3"));
    expect(readEdgeList(cell)).toEqual([{ u: 0, v: 1, weight: 5 }, { u: 1, v: 2, weight: 3 }]);
  });

  it("rejects an UNNAMED vector<vector<int>> of len-2 rows (stays adjlist)", () => {
    const cell = outer("adj", rowOf("vector", "1", "2"), rowOf("vector", "0", "2"));
    expect(readEdgeList(cell)).toBeNull();
  });

  it("reads a flat vector<pair<int,int>> as {u,v} edges", () => {
    const cell = outer("g", rowOf("pair", "0", "1"), rowOf("pair", "1", "2"));
    expect(readEdgeList(cell)).toEqual([{ u: 0, v: 1 }, { u: 1, v: 2 }]);
  });

  it("reads vector<array<int,3>> / tuple as weighted edges", () => {
    const arr = outer("g", rowOf("array", "0", "1", "5"));
    expect(readEdgeList(arr)).toEqual([{ u: 0, v: 1, weight: 5 }]);
    const tup = outer("g", rowOf("tuple", "2", "3", "7"));
    expect(readEdgeList(tup)).toEqual([{ u: 2, v: 3, weight: 7 }]);
  });

  it("reads nested pair {w,{u,v}} reordered to {u,v,w}", () => {
    const cell = outer("g", nestedPair("5", "0", "1"), nestedPair("3", "1", "2"));
    expect(readEdgeList(cell)).toEqual([{ u: 0, v: 1, weight: 5 }, { u: 1, v: 2, weight: 3 }]);
  });

  it("rejects direction-vectors: pairs with negative endpoints", () => {
    const cell = outer("dirs", rowOf("pair", "0", "1"), rowOf("pair", "-1", "0"));
    expect(readEdgeList(cell)).toBeNull();
  });

  it("rejects a 'dir'-named pair vector even when all non-negative", () => {
    const cell = outer("directions", rowOf("pair", "0", "1"), rowOf("pair", "1", "0"));
    expect(readEdgeList(cell)).toBeNull();
  });

  it("returns null for an empty container", () => {
    expect(readEdgeList(outer("edges"))).toBeNull();
  });

  it("rejects a queue<pair<int,int>> BFS frontier of non-negative pairs (not an edge list)", () => {
    const cell = adaptorOuter("queue", "q", rowOf("pair", "0", "1"), rowOf("pair", "1", "2"));
    expect(readEdgeList(cell)).toBeNull();
  });

  it("rejects a priority_queue<pair<int,int>> min-heap of non-negative pairs (not an edge list)", () => {
    const cell = adaptorOuter("priority_queue", "minHeap", rowOf("pair", "0", "1"), rowOf("pair", "1", "2"));
    expect(readEdgeList(cell)).toBeNull();
  });
});

import { edgeListScene } from "../../src/viz/graph/graphModel";
import type { NormalizedMemory } from "../../src/viz/memoryModel";

const emptyMem = { globals: [], frames: [] } as unknown as NormalizedMemory;
const memWithN = (n: string): NormalizedMemory =>
  ({ globals: [], frames: [{ cells: [
      { id: "N", kind: "scalar", name: "N", type: "int", displayValue: n } ] }] } as any);

describe("edgeListScene", () => {
  it("nodes span 0..maxId from endpoints", () => {
    const s = edgeListScene([{ u: 0, v: 1 }, { u: 1, v: 2 }], emptyMem);
    expect(s.nodes.map((n) => n.id)).toEqual(["0", "1", "2"]);
    expect(s.kind).toBe("adjlist");
  });

  it("marks every edge directed and carries weight", () => {
    const s = edgeListScene([{ u: 0, v: 1, weight: 5 }], emptyMem);
    expect(s.edges).toEqual([{ from: "0", to: "1", directed: true, weight: 5, dangling: false }]);
  });

  it("extends the node set when an n/N scalar exceeds maxId (isolated nodes)", () => {
    const s = edgeListScene([{ u: 0, v: 1 }, { u: 1, v: 2 }], memWithN("5"));
    expect(s.nodes.map((n) => n.id)).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("ignores an n scalar that is not larger than maxId", () => {
    const s = edgeListScene([{ u: 0, v: 3 }], memWithN("2"));
    expect(s.nodes.length).toBe(4); // 0..3, n=2 ignored
  });
});

import { hasGraphContent } from "../../src/viz/graph/graphModel";

describe("hasGraphContent agrees with readEdgeList for pair-shaped edge lists", () => {
  it("is true for a memory whose only graph content is a flat vector<pair> edge list", () => {
    const cell = outer("edges", rowOf("pair", "0", "1"), rowOf("pair", "1", "2"));
    const mem = { globals: [cell], frames: [] } as unknown as NormalizedMemory;
    expect(hasGraphContent(mem)).toBe(true);
  });

  it("(sanity) is still true for the int-matrix shape", () => {
    const matrixRow = (...vs: string[]): NormalizedCell =>
      ({ id: "r", kind: "container", containerKind: "vector", name: "", type: "vector",
         displayValue: "", children: vs.map(scalar) } as any);
    const cell = outer("adj", matrixRow("0", "1"), matrixRow("1", "0"));
    const mem = { globals: [cell], frames: [] } as unknown as NormalizedMemory;
    expect(hasGraphContent(mem)).toBe(true);
  });

  it("(sanity) is false for a memory with no graph content", () => {
    const mem = { globals: [], frames: [] } as unknown as NormalizedMemory;
    expect(hasGraphContent(mem)).toBe(false);
  });
});

import { buildGraphScene } from "../../src/viz/graph/graphModel";
import { normalizeMemory } from "../../src/viz/memoryModel";
import shortestPathDAG from "../fixtures/graph/shortestPathDAG.json";

describe("buildGraphScene edge-list integration", () => {
  it("renders vector<vector<int>> edges as a 7-edge directed weighted graph", () => {
    const trace = (shortestPathDAG as any).trace;
    let scene = null;
    for (let s = 0; s < trace.length; s++) {
      const sc = buildGraphScene(normalizeMemory(trace[s]), null, trace, s);
      if (sc && sc.edges.length === 7) { scene = sc; break; }
    }
    expect(scene).not.toBeNull();
    expect(scene!.nodes.length).toBe(6);              // N = 6
    expect(scene!.edges.every((e) => e.directed)).toBe(true);
    expect(scene!.edges.every((e) => e.weight != null)).toBe(true);
    // weights present in the literal, e.g. the {2,3,6} edge
    expect(scene!.edges.some((e) => e.from === "2" && e.to === "3" && e.weight === 6)).toBe(true);
  });
});
