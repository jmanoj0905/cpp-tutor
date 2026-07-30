import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import dfsList from "../fixtures/graph/dfs_list.json";

// Pick a step where `graph` is fully populated (after main builds it).
// dfs_list builds a 7-node directed graph: 0->1,0->2,1->3,1->4,2->5,4->5,5->6.
function sceneAt(step: number) {
  const mem = normalizeMemory((dfsList as any).trace[step]);
  return buildGraphScene(mem, null, (dfsList as any).trace, step);
}

describe("adjacency-list detection", () => {
  it("detects an adjlist scene with 7 nodes and the expected edges", () => {
    // Find the first step that yields an adjlist scene with 7 nodes and all expected edges.
    // (dfs_list pre-sizes the graph to 7 empty rows before pushing edges, so we must scan
    // until all edges are present, not just the first step with 7 nodes.)
    let scene = null;
    for (let s = 0; s < (dfsList as any).trace.length; s++) {
      const sc = sceneAt(s);
      if (sc && sc.kind === "adjlist" && sc.nodes.length === 7) {
        const edgeSet = new Set(sc.edges.map((e) => `${e.from}->${e.to}`));
        // Only accept this scene if all expected edges are present
        if (edgeSet.has("0->1") && edgeSet.has("1->4") && edgeSet.has("5->6")) {
          scene = sc;
          break;
        }
      }
    }
    expect(scene).not.toBeNull();
    expect(scene!.nodes.map((n) => n.id).sort()).toEqual(["0","1","2","3","4","5","6"]);
    const edgeSet = new Set(scene!.edges.map((e) => `${e.from}->${e.to}`));
    expect(edgeSet.has("0->1")).toBe(true);
    expect(edgeSet.has("1->4")).toBe(true);
    expect(edgeSet.has("5->6")).toBe(true);
  });
});
