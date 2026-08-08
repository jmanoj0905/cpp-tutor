import { describe, it, expect } from "vitest";
import { addressIndex, bindTreeCurrent, bindTreeOrder, shapeToScene } from "../../src/viz/graph/treeScene";
import { applyShapes } from "../../src/viz/shapes";
import type { NormalizedMemory } from "../../src/viz/memoryModel";
import { treeNode } from "../shapeHelpers";
import type { ExecPoint } from "../../src/types/trace";
import treeInsert from "../fixtures/shapes/tree-insert.json";
import { normalizeMemory } from "../../src/viz/memoryModel";

const CONFIRMED = new Map([["TreeNode", "tree" as const]]);

/** heap-only memory holding the given struct cells. */
const mem = (heap: NormalizedMemory["heap"], links: NormalizedMemory["links"] = []): NormalizedMemory =>
  ({ globals: [], frames: [], heap, links });

/**  5
 *  / \
 * 3   8   */
const bst = () => mem([
  treeNode("0x10", 5, "0x20", "0x30"),
  treeNode("0x20", 3, null, null),
  treeNode("0x30", 8, null, null),
]);

const shapesOf = (m: NormalizedMemory) => applyShapes(m, CONFIRMED, new Set()).shapes;

describe("shapeToScene", () => {
  it("maps tree shape nodes and edges into a tree GraphScene", () => {
    const scene = shapeToScene(shapesOf(bst()))!;
    expect(scene.kind).toBe("tree");
    expect(scene.nodes.map((n) => n.label).sort()).toEqual(["3", "5", "8"]);
    expect(scene.edges).toHaveLength(2);
    expect(scene.edges.every((e) => e.directed)).toBe(true);
  });

  it("carries the left/right slot on each edge", () => {
    const scene = shapeToScene(shapesOf(bst()))!;
    const root = scene.nodes.find((n) => n.label === "5")!;
    const left = scene.nodes.find((n) => n.label === "3")!;
    const right = scene.nodes.find((n) => n.label === "8")!;
    expect(scene.edges.find((e) => e.to === left.id)).toMatchObject({ from: root.id, slot: 0 });
    expect(scene.edges.find((e) => e.to === right.id)).toMatchObject({ from: root.id, slot: 1 });
  });

  it("returns null when there is no tree shape", () => {
    expect(shapeToScene([])).toBeNull();
    expect(shapeToScene(shapesOf(mem([])))).toBeNull();
  });

  it("merges several live trees into one scene", () => {
    const two = mem([
      treeNode("0x10", 1, "0x20", null),
      treeNode("0x20", 2, null, null),
      treeNode("0xA0", 1, "0xB0", null),
      treeNode("0xB0", 2, null, null),
    ]);
    const scene = shapeToScene(shapesOf(two))!;
    expect(scene.nodes).toHaveLength(4);
    expect(scene.edges).toHaveLength(2);
  });
});

/** node id -> heap address, the shape every binder takes as `addrById`. */
const addrById = (m: NormalizedMemory) => addressIndex(shapesOf(m));

describe("bindTreeCurrent", () => {
  const idOf = (scene: { nodes: { id: string; label: string }[] }, label: string) =>
    scene.nodes.find((n) => n.label === label)!.id;

  it("marks nodes targeted by stack pointer locals as current", () => {
    const m = bst();
    m.links = [
      { fromId: "frame-0-root", fromName: "root", toId: "heap-heap-0x10", targetAddress: "0x10" },
      { fromId: "frame-1-curr", fromName: "curr", toId: "heap-heap-0x20", targetAddress: "0x20" },
    ];
    const scene = shapeToScene(shapesOf(m))!;
    bindTreeCurrent(m, scene, addrById(m));
    expect(new Set(scene.overlays.current)).toEqual(new Set([idOf(scene, "5"), idOf(scene, "3")]));
  });

  it("ignores heap-to-heap links (a node's own child pointer is not a finger)", () => {
    const m = bst();
    m.links = [
      { fromId: "heap-heap-0x10-left", fromName: "left", toId: "heap-heap-0x20", targetAddress: "0x20" },
    ];
    const scene = shapeToScene(shapesOf(m))!;
    bindTreeCurrent(m, scene, addrById(m));
    expect(scene.overlays.current).toEqual([]);
  });

  it("marks the edge between two current nodes as onPath", () => {
    const m = bst();
    m.links = [
      { fromId: "frame-0-root", fromName: "root", toId: "heap-heap-0x10", targetAddress: "0x10" },
      { fromId: "frame-1-curr", fromName: "curr", toId: "heap-heap-0x20", targetAddress: "0x20" },
    ];
    const scene = shapeToScene(shapesOf(m))!;
    bindTreeCurrent(m, scene, addrById(m));
    const onPath = scene.edges.filter((e) => e.onPath);
    expect(onPath).toHaveLength(1);
    expect(onPath[0].to).toBe(idOf(scene, "3"));
  });
});

describe("bindTreeOrder", () => {
  const trace = (treeInsert as { trace: ExecPoint[] }).trace;

  /** last step where the BST has all 5 nodes */
  const fullStep = () => {
    for (let s = trace.length - 1; s >= 0; s--) {
      const scene = shapeToScene(shapesOf(normalizeMemory(trace[s])));
      if (scene && scene.nodes.length === 5) return s;
    }
    throw new Error("no 5-node step in tree-insert fixture");
  };

  it("numbers visited nodes in first-visit order and marks them visited", () => {
    const s = fullStep();
    const m = normalizeMemory(trace[s]);
    const shapes = shapesOf(m);
    const scene = shapeToScene(shapes)!;
    bindTreeOrder(trace, s, scene, addressIndex(shapes));

    expect(scene.overlays.visited.size).toBeGreaterThan(0);
    const orders = [...scene.overlays.order.values()].sort((a, b) => a - b);
    expect(orders[0]).toBe(1);                               // numbering starts at 1
    expect(new Set(orders).size).toBe(orders.length);        // no duplicates
    expect(scene.overlays.order.size).toBe(scene.overlays.visited.size);
    for (const id of scene.overlays.order.keys()) {
      expect(scene.nodes.some((n) => n.id === id)).toBe(true); // only live nodes
    }
  });

  it("never shrinks as the step index advances", () => {
    const s = fullStep();
    const m = normalizeMemory(trace[s]);
    const scene = (i: number) => {
      const shapes = shapesOf(m);
      const sc = shapeToScene(shapes)!;
      bindTreeOrder(trace, i, sc, addressIndex(shapes));
      return sc.overlays.visited.size;
    };
    expect(scene(s)).toBeGreaterThanOrEqual(scene(Math.floor(s / 2)));
  });
});
