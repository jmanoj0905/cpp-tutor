import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import rotting from "../fixtures/graph/rotting.json";
import dfsList from "../fixtures/graph/dfs_list.json";

const firstScene = (fx: any, viewAs?: any) => {
  for (let s = 0; s < fx.trace.length; s++) {
    const sc = buildGraphScene(normalizeMemory(fx.trace[s]), null, fx.trace, s, viewAs);
    if (sc) return sc;
  }
  return null;
};

describe("int grid vs adjacency list disambiguation", () => {
  it("treats rotting-oranges int matrix as a grid (has queue<pair>)", () => {
    // step through until the queue<pair> exists; grab a scene then.
    let kind = null;
    for (let s = 0; s < (rotting as any).trace.length; s++) {
      const sc = buildGraphScene(normalizeMemory((rotting as any).trace[s]), null, (rotting as any).trace, s);
      if (sc) { kind = sc.kind; if (kind === "grid") break; }
    }
    expect(kind).toBe("grid");
  });

  it("viewAs override forces adjacency list to render as grid and back", () => {
    expect(firstScene(dfsList, "grid")!.kind).toBe("grid");
    expect(firstScene(dfsList, "graph")!.kind).toBe("adjlist");
  });
});
