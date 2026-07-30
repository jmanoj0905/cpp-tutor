import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import dfsList from "../fixtures/graph/dfs_list.json";

describe("current + recursion path", () => {
  it("during nested dfs, current holds >1 node id (recursion path)", () => {
    let maxPath = 0;
    for (let s = 0; s < (dfsList as any).trace.length; s++) {
      const sc = buildGraphScene(normalizeMemory((dfsList as any).trace[s]), null, (dfsList as any).trace, s);
      if (sc?.kind === "adjlist") maxPath = Math.max(maxPath, sc.overlays.current.length);
    }
    expect(maxPath).toBeGreaterThan(1); // dfs recurses several levels deep
  });
});
