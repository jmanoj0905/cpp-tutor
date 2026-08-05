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
});
