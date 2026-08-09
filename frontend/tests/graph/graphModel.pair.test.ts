import { describe, it, expect } from "vitest";
import { readMatrix } from "../../src/viz/graph/graphModel";
import type { NormalizedCell } from "../../src/viz/memoryModel";

const scalar = (id: string, v: string): NormalizedCell => ({
  id, name: "", source: "stack", kind: "scalar",
  address: null, type: "int", displayValue: v, rawValue: v,
});

const pair = (id: string, a: string, b: string): NormalizedCell => ({
  id, name: "", source: "stack", kind: "container",
  address: null, type: "pair<int, int>", containerKind: "pair",
  displayValue: "", rawValue: null,
  children: [scalar(`${id}.0`, a), scalar(`${id}.1`, b)],
});

const vecOf = (children: NormalizedCell[]): NormalizedCell => ({
  id: "items", name: "items", source: "stack", kind: "container",
  address: null, type: "vector<pair<int, int> >", containerKind: "vector",
  displayValue: "", rawValue: null, children,
});

describe("readMatrix rejects vector<pair>", () => {
  it("does not read a vector<pair<int,int>> as a 2-column int matrix", () => {
    // knapsack items = {{1,6},{2,10},{3,12}} — a list of (weight,value) pairs,
    // NOT an adjacency structure. Must not become a graph/grid.
    const cell = vecOf([pair("p0", "1", "6"), pair("p1", "2", "10"), pair("p2", "3", "12")]);
    expect(readMatrix(cell)).toBeNull();
  });
});
