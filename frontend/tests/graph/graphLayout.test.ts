import { describe, it, expect } from "vitest";
import { layoutScene, labelPoint, trimEndpoint } from "../../src/viz/graph/graphLayout";
import { heapScene } from "../../src/viz/graph/graphModel";
import type { GraphScene } from "../../src/viz/graph/graphModel";

const bare = (over: Partial<GraphScene>): GraphScene => ({
  kind: "adjlist", nodes: [], edges: [],
  overlays: { visited: new Set(), current: [], frontier: new Set(), order: new Map(), flashed: new Set() },
  ...over,
});

describe("layoutScene", () => {
  it("places adjacency nodes on a unit circle", () => {
    const scene = bare({ nodes: [
      { id: "0", label: "0" }, { id: "1", label: "1" }, { id: "2", label: "2" }, { id: "3", label: "3" }] });
    const { placed, mode } = layoutScene(scene);
    expect(mode).toBe("circle");
    expect(placed.length).toBe(4);
    placed.forEach((p) => {
      const dx = p.x - 0.5, dy = p.y - 0.5;
      expect(Math.hypot(dx, dy)).toBeCloseTo(0.4, 5); // radius 0.4 around center
    });
  });

  it("uses grid mode with row/col coords for grids", () => {
    const scene = bare({ kind: "grid", rows: 2, cols: 3,
      nodes: [
        { id: "0,0", label: "a", row: 0, col: 0 }, { id: "0,1", label: "b", row: 0, col: 1 },
        { id: "0,2", label: "c", row: 0, col: 2 }, { id: "1,0", label: "d", row: 1, col: 0 },
        { id: "1,1", label: "e", row: 1, col: 1 }, { id: "1,2", label: "f", row: 1, col: 2 }] });
    const { placed, mode } = layoutScene(scene);
    expect(mode).toBe("grid");
    const p = placed.find((q) => q.id === "1,2")!;
    expect(p.x).toBeGreaterThan(placed.find((q) => q.id === "1,0")!.x);
    expect(p.y).toBeGreaterThan(placed.find((q) => q.id === "0,2")!.y);
  });

  it("falls back to compact mode past CIRCLE_MAX nodes", () => {
    const nodes = Array.from({ length: 40 }, (_, i) => ({ id: String(i), label: String(i) }));
    expect(layoutScene(bare({ nodes })).mode).toBe("compact");
  });
});

describe("labelPoint", () => {
  it("returns the midpoint when offset is 0", () => {
    expect(labelPoint(0, 0, 10, 0, 0)).toEqual({ x: 5, y: 0 });
  });
  it("offsets perpendicular to the edge, opposite signs for reversed direction", () => {
    const up = labelPoint(0, 0, 10, 0, 8);
    const down = labelPoint(0, 0, 10, 0, -8);
    expect(up.x).toBeCloseTo(5);
    expect(down.x).toBeCloseTo(5);
    expect(up.y).toBeCloseTo(-8);   // perpendicular to a horizontal edge
    expect(down.y).toBeCloseTo(8);
    expect(up.y).not.toBe(down.y);  // asymmetric pair labels don't coincide
  });
});

describe("trimEndpoint", () => {
  it("pulls the endpoint back by r along a horizontal edge", () => {
    expect(trimEndpoint(0, 0, 100, 0, 10)).toEqual({ x: 90, y: 0 });
  });
  it("pulls back along a vertical edge", () => {
    expect(trimEndpoint(0, 0, 0, 100, 10)).toEqual({ x: 0, y: 90 });
  });
  it("returns b unchanged for a zero-length edge (no NaN)", () => {
    expect(trimEndpoint(5, 5, 5, 5, 10)).toEqual({ x: 5, y: 5 });
  });
});

describe("treeLayout", () => {
  const xy = (l: { placed: { id: string; x: number; y: number }[] }, id: string) =>
    l.placed.find((p) => p.id === id)!;

  it("places the root at top-center and leaves at the bottom", () => {
    const l = layoutScene(heapScene(Array.from({ length: 7 }, (_, i) => ({ label: String(i) }))));
    expect(l.mode).toBe("tree");
    expect(xy(l, "0").y).toBeCloseTo(0);     // root: depth 0
    expect(xy(l, "0").x).toBeCloseTo(0.5);   // single node in its level -> centered
    expect(xy(l, "3").y).toBeCloseTo(1);     // depth 2 leaf
    expect(xy(l, "1").y).toBeCloseTo(0.5);   // depth 1
  });

  it("centers a single-node heap", () => {
    const l = layoutScene(heapScene([{ label: "42" }]));
    expect(xy(l, "0")).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it("spreads a partial last level by actual occupancy (no NaN)", () => {
    // 5 nodes: levels [0] / [1,2] / [3,4] ; last level has 2, not 4
    const l = layoutScene(heapScene(Array.from({ length: 5 }, (_, i) => ({ label: String(i) }))));
    expect(xy(l, "3").x).toBeCloseTo(0);   // first of 2 at depth 2
    expect(xy(l, "4").x).toBeCloseTo(1);   // second of 2 at depth 2
    expect(l.placed.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});
