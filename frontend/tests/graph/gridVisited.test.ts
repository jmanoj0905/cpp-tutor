import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene, type GraphScene } from "../../src/viz/graph/graphModel";
import islands from "../fixtures/graph/islands.json";
import rotting from "../fixtures/graph/rotting.json";

const sceneAt = (t: any, s: number) =>
  buildGraphScene(
    normalizeMemory(t.trace[s]),
    s > 0 ? normalizeMemory(t.trace[s - 1]) : null,
    t.trace,
    s,
  );

// Index of the first / last step whose scene is a grid (the grid is built a
// few steps into main, and its locals disappear once the function returns).
const gridSteps = (t: any): number[] => {
  const out: number[] = [];
  for (let s = 0; s < t.trace.length; s++) {
    if (sceneAt(t, s)?.kind === "grid") out.push(s);
  }
  return out;
};

// A grid cell counts "visited already" once its value has diverged from the
// grid's initial state — the in-place-mutation trail (islands '1'->'0',
// rotting 1->2) that has no named `visited` array to read.
describe("grid visited = cumulative mutation from initial grid state", () => {
  it("islands: nothing visited when the grid first appears, a trail by the end", () => {
    const steps = gridSteps(islands);
    expect(steps.length).toBeGreaterThan(0);
    const first = sceneAt(islands, steps[0])!;
    expect(first.overlays.visited.size).toBe(0);
    const last = sceneAt(islands, steps[steps.length - 1])!;
    expect(last.overlays.visited.size).toBeGreaterThan(0);
  }, 20000);

  it("islands: every visited cell actually changed from the initial grid", () => {
    const steps = gridSteps(islands);
    const baseLabel = new Map(sceneAt(islands, steps[0])!.nodes.map((n) => [n.id, n.label]));
    const last = sceneAt(islands, steps[steps.length - 1])!;
    expect(last.overlays.visited.size).toBeGreaterThan(0);
    for (const id of last.overlays.visited) {
      const cur = last.nodes.find((n) => n.id === id)!;
      expect(cur.label).not.toBe(baseLabel.get(id));
    }
  }, 20000);

  it("rotting: fresh oranges that rot are marked visited", () => {
    const steps = gridSteps(rotting);
    expect(steps.length).toBeGreaterThan(0);
    const last = sceneAt(rotting, steps[steps.length - 1])!;
    expect(last.overlays.visited.size).toBeGreaterThan(0);
  }, 20000);

  it("islands: visited grows monotonically as the grid mutates in place", () => {
    let prevSize = 0;
    for (const s of gridSteps(islands)) {
      const sc = sceneAt(islands, s) as GraphScene;
      expect(sc.overlays.visited.size).toBeGreaterThanOrEqual(prevSize);
      prevSize = sc.overlays.visited.size;
    }
  }, 20000);
});
