import { describe, it, expect } from "vitest";
import { shapeToScene } from "../../src/viz/graph/treeScene";
import { applyShapes } from "../../src/viz/shapes";
import type { NormalizedMemory } from "../../src/viz/memoryModel";
import { treeNode } from "../shapeHelpers";

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
