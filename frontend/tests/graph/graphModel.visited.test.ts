import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import dfsList from "../fixtures/graph/dfs_list.json";

describe("visited overlay", () => {
  it("marks node 0 visited during dfs once visited[0] is true", () => {
    // find a step where an adjlist scene has node 0 visited
    let found = false;
    for (let s = 0; s < (dfsList as any).trace.length; s++) {
      const sc = buildGraphScene(normalizeMemory((dfsList as any).trace[s]), null, (dfsList as any).trace, s);
      if (sc?.kind === "adjlist" && sc.overlays.visited.has("0")) { found = true; break; }
    }
    expect(found).toBe(true);
  });
});
