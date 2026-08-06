import { describe, it, expect } from "vitest";
import { readHeap, heapScene } from "../../src/viz/graph/graphModel";
import type { NormalizedCell } from "../../src/viz/memoryModel";

const scalar = (v: string): NormalizedCell =>
  ({ id: v, kind: "scalar", name: "", type: "int", displayValue: v } as any);

const pairCell = (a: string, b: string): NormalizedCell =>
  ({ id: `p${a}${b}`, kind: "container", containerKind: "pair", name: "", type: "pair",
     displayValue: "", children: [scalar(a), scalar(b)] } as any);

// a priority_queue container holding the given element cells (heap-array order)
const pq = (...els: NormalizedCell[]): NormalizedCell =>
  ({ id: "pq", kind: "container", containerKind: "priority_queue", name: "pq",
     type: "std::priority_queue<int>", displayValue: "", children: els } as any);

describe("readHeap", () => {
  it("reads a priority_queue<int> as int labels in array order", () => {
    expect(readHeap(pq(scalar("9"), scalar("5"), scalar("8"), scalar("1"))))
      .toEqual([{ label: "9" }, { label: "5" }, { label: "8" }, { label: "1" }]);
  });

  it("reads a priority_queue<pair<int,int>> as {a,b} labels", () => {
    expect(readHeap(pq(pairCell("9", "0"), pairCell("5", "2"))))
      .toEqual([{ label: "{9,0}" }, { label: "{5,2}" }]);
  });

  it("returns null for a non-priority_queue container", () => {
    const vec = { ...pq(scalar("1")), containerKind: "vector" } as any;
    expect(readHeap(vec)).toBeNull();
  });

  it("returns null for an empty heap", () => {
    expect(readHeap(pq())).toBeNull();
  });

  it("returns null when a placeholder heap (partial trace)", () => {
    const ph = { ...pq(scalar("1")), placeholders: true } as any;
    expect(readHeap(ph)).toBeNull();
  });

  it("returns null when a child is neither scalar int nor 2-int pair", () => {
    expect(readHeap(pq(scalar("1"), pairCell("2", "x")))).toBeNull(); // "x" not int
    expect(readHeap(pq(scalar("1"), scalar("nan")))).toBeNull();
  });
});

describe("heapScene", () => {
  it("builds a tree scene with node ids 0..n-1", () => {
    const s = heapScene([{ label: "9" }, { label: "5" }, { label: "8" }]);
    expect(s.kind).toBe("tree");
    expect(s.nodes.map((n) => n.id)).toEqual(["0", "1", "2"]);
    expect(s.nodes.map((n) => n.label)).toEqual(["9", "5", "8"]);
  });

  it("wires parent floor((i-1)/2) -> i edges, all undirected", () => {
    const s = heapScene([{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }, { label: "e" }]);
    // i=1,2 -> parent 0 ; i=3,4 -> parent 1
    expect(s.edges).toEqual([
      { from: "0", to: "1", directed: false },
      { from: "0", to: "2", directed: false },
      { from: "1", to: "3", directed: false },
      { from: "1", to: "4", directed: false },
    ]);
  });

  it("has no edges for a single-node heap", () => {
    const s = heapScene([{ label: "42" }]);
    expect(s.edges).toEqual([]);
    expect(s.nodes.length).toBe(1);
  });
});
