import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import rotting from "../fixtures/graph/rotting.json";

describe("frontier overlay", () => {
  it("marks queued cells as frontier in the rotting-oranges grid", () => {
    let found = false;
    for (let s = 0; s < (rotting as any).trace.length; s++) {
      const sc = buildGraphScene(normalizeMemory((rotting as any).trace[s]), null, (rotting as any).trace, s);
      if (sc?.kind === "grid" && sc.overlays.frontier.size > 0) { found = true; break; }
    }
    expect(found).toBe(true);
  });
});
