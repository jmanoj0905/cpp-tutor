import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene, hasGraphContent } from "../../src/viz/graph/graphModel";
import graphs from "../fixtures/graph/graphs.json";
import islands from "../fixtures/graph/islands.json";
import vector from "../fixtures/vector-trace.json";

const anyStep = (t: any, pred: (m: any) => boolean) =>
  (t.trace as any[]).some((p) => pred(normalizeMemory(p)));

describe("hasGraphContent", () => {
  it("is true for an int-matrix (adjacency) program", () => {
    expect(anyStep(graphs, hasGraphContent)).toBe(true);
  });

  it("is true for a char-grid (islands) program", () => {
    expect(anyStep(islands, hasGraphContent)).toBe(true);
  });

  it("is false for a flat vector<int> program (no 2D container)", () => {
    expect(anyStep(vector, hasGraphContent)).toBe(false);
  });

  it("agrees with buildGraphScene(auto) per step across a graph trace", () => {
    for (let s = 0; s < (graphs as any).trace.length; s++) {
      const mem = normalizeMemory((graphs as any).trace[s]);
      const scene = buildGraphScene(mem, null, (graphs as any).trace, s, "auto");
      expect(hasGraphContent(mem)).toBe(scene !== null);
    }
  });
});
