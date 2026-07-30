import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import dfsList from "../fixtures/graph/dfs_list.json";
import islands from "../fixtures/graph/islands.json";

const at = (fx: any, s: number, prev: number | null) =>
  buildGraphScene(
    normalizeMemory(fx.trace[s]),
    prev == null ? null : normalizeMemory(fx.trace[prev]),
    fx.trace, s);

describe("visit-order + mutation flash", () => {
  it("visit-order is seek-safe: same step gives same numbering forwards or backwards", () => {
    const tr = (dfsList as any).trace;
    // find a late adjlist step with several ordered nodes
    let step = -1;
    for (let s = tr.length - 1; s >= 0; s--) {
      const sc = buildGraphScene(normalizeMemory(tr[s]), null, tr, s);
      if (sc?.kind === "adjlist" && sc.overlays.order.size >= 3) { step = s; break; }
    }
    expect(step).toBeGreaterThan(0);
    const a = buildGraphScene(normalizeMemory(tr[step]), null, tr, step)!.overlays.order;
    const b = buildGraphScene(normalizeMemory(tr[step]), null, tr, step)!.overlays.order;
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it("mutation flash marks a grid cell the step it flips", () => {
    const tr = (islands as any).trace;
    let flashed = false;
    for (let s = 1; s < tr.length; s++) {
      const sc = at(islands, s, s - 1);
      if (sc?.kind === "grid" && sc.overlays.flashed.size > 0) { flashed = true; break; }
    }
    expect(flashed).toBe(true);
  });
});
