// frontend/tests/graph/graphModel.matrix.test.ts
import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import graphs from "../fixtures/graph/graphs.json";

describe("adjacency-matrix detection", () => {
  it("detects a 5-node undirected matrix graph with edge 0-1", () => {
    let scene = null;
    for (let s = 0; s < (graphs as any).trace.length; s++) {
      const mem = normalizeMemory((graphs as any).trace[s]);
      const sc = buildGraphScene(mem, null, (graphs as any).trace, s);
      if (sc && sc.kind === "matrix" && sc.nodes.length === 5) {
        // Scan until we find a matrix with all expected edges
        const edgeSet = new Set(sc.edges.map((e) => `${e.from}-${e.to}`));
        const has = (a: string, b: string) => edgeSet.has(`${a}-${b}`) || edgeSet.has(`${b}-${a}`);
        if (has("0", "1") && has("3", "4")) { scene = sc; break; }
      }
    }
    expect(scene).not.toBeNull();
    const edgeSet = new Set(scene!.edges.map((e) => `${e.from}-${e.to}`));
    // undirected: stored once, unordered pair
    const has = (a: string, b: string) => edgeSet.has(`${a}-${b}`) || edgeSet.has(`${b}-${a}`);
    expect(has("0", "1")).toBe(true);
    expect(has("3", "4")).toBe(true);
    expect(scene!.edges.every((e) => e.directed === false)).toBe(true);
  });
});
