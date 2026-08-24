// B2 against real backend traces. list-cycle.cpp is Floyd's slow/fast over a
// 1->2->3->4->2 loop; list-reverse.cpp reverses 1->2->3 in place. Both are the
// programs the named-finger overlay exists for.
import { describe, it, expect } from "vitest";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import type { GraphScene } from "../../src/viz/graph/graphModel";
import { memoryAt } from "../../src/viz/memoryModel";
import { applyShapes, shapeInfoFor } from "../../src/viz/shapes";
import type { ExecPoint, Trace } from "../../src/types/trace";
import listCycle from "../fixtures/shapes/list-cycle.json";
import listReverse from "../fixtures/shapes/list-reverse.json";

const NO_DISABLED: Set<string> = new Set();

/** Exactly what GraphPanel does for one step. */
const sceneAt = (trace: ExecPoint[], step: number): GraphScene | null => {
  const mem = memoryAt(trace[step]);
  const info = shapeInfoFor(trace);
  const { shapes } = applyShapes(mem, info.confirmed, NO_DISABLED, info.selfNames);
  return buildGraphScene(mem, null, trace, step, "auto", shapes);
};

const scenes = (trace: ExecPoint[]): GraphScene[] => {
  const out: GraphScene[] = [];
  for (let s = 0; s < trace.length; s++) {
    const scene = sceneAt(trace, s);
    if (scene) out.push(scene);
  }
  return out;
};

const namesIn = (scene: GraphScene): Set<string> =>
  new Set([...scene.overlays.fingers.values()].flat());

describe("list-cycle fixture (Floyd's)", () => {
  const trace = (listCycle as unknown as Trace).trace;
  const all = scenes(trace);

  it("confirms ListNode as a list and builds list scenes", () => {
    expect(shapeInfoFor(trace).confirmed.get("ListNode")).toBe("list");
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((s) => s.kind === "list")).toBe(true);
  });

  it("never lets an array-family detector shadow the list", () => {
    expect(all.some((s) => s.kind !== "list")).toBe(false);
  });

  it("names slow and fast as fingers", () => {
    const named = all.flatMap((s) => [...namesIn(s)]);
    expect(named).toContain("slow");
    expect(named).toContain("fast");
    expect(named).toContain("head");
  });

  it("shows slow and fast standing on one node when they meet", () => {
    // The do/while exits exactly when slow == fast, so some step must have a
    // single node carrying both names — the answer the algorithm computes.
    const met = all.some((s) =>
      [...s.overlays.fingers.values()].some((ns) => ns.includes("slow") && ns.includes("fast")));
    expect(met).toBe(true);
  });

  it("marks the tail's back-edge as cycleBack once the loop is wired", () => {
    expect(all.some((s) => s.edges.some((e) => e.cycleBack))).toBe(true);
  });

  it("keeps every finger node in the scene", () => {
    for (const s of all) {
      for (const id of s.overlays.fingers.keys()) {
        expect(s.nodes.some((n) => n.id === id)).toBe(true);
      }
    }
  });
});

describe("list-reverse fixture", () => {
  const trace = (listReverse as unknown as Trace).trace;
  const all = scenes(trace);

  it("builds list scenes and names the reversal's pointers", () => {
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((s) => s.kind === "list")).toBe(true);
    const named = all.flatMap((s) => [...namesIn(s)]);
    expect(named).toContain("prev");
    expect(named).toContain("curr");
  });

  it("lights the edge between prev and curr while the reversal runs", () => {
    // Mid-reversal `curr->next` already points back at `prev`, so the two are
    // adjacent — the edge the next iteration rewrites.
    expect(all.some((s) => s.edges.some((e) => e.onPath))).toBe(true);
  });

  it("ghosts nothing while every node is still reachable from a pointer", () => {
    // head/prev/curr between them cover the whole chain at every step here, so
    // a non-empty `detached` would mean the reachability rule is wrong.
    const firstStepWithNodes = all.find((s) => s.nodes.length === 3);
    expect(firstStepWithNodes?.overlays.detached.size).toBe(0);
  });
});
