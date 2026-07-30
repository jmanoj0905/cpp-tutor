import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import islands from "../fixtures/graph/islands.json";

describe("grid detection", () => {
  it("detects the char grid as kind grid with r,c node ids", () => {
    // islands grid is 4 rows x 5 cols of '0'/'1'.
    let scene = null;
    for (let s = 0; s < (islands as any).trace.length; s++) {
      const mem = normalizeMemory((islands as any).trace[s]);
      const sc = buildGraphScene(mem, null, (islands as any).trace, s);
      if (sc && sc.kind === "grid") { scene = sc; break; }
    }
    expect(scene).not.toBeNull();
    expect(scene!.rows).toBe(4);
    expect(scene!.cols).toBe(5);
    expect(scene!.nodes.length).toBe(20);
    const n00 = scene!.nodes.find((n) => n.id === "0,0")!;
    expect(n00.row).toBe(0); expect(n00.col).toBe(0);
    expect(scene!.edges.length).toBe(0); // grids draw no node-link edges
  });
});
