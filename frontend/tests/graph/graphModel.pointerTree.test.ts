import { describe, it, expect } from "vitest";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import { applyShapes } from "../../src/viz/shapes";
import type { NormalizedCell, NormalizedMemory } from "../../src/viz/memoryModel";
import { treeNode } from "../shapeHelpers";

const CONFIRMED = new Map([["TreeNode", "tree" as const]]);

/** vector<vector<int>> res — the accumulator a tree program typically carries. */
const resMatrix = (): NormalizedCell => ({
  id: "frame-0-res", name: "res", source: "stack", kind: "container", address: null,
  type: "std::vector<std::vector<int> >", displayValue: "vector", rawValue: null,
  containerKind: "vector",
  children: [0, 1].map((r) => ({
    id: `frame-0-res-${r}`, name: `[${r}]`, source: "stack", kind: "container" as const,
    address: null, type: "std::vector<int>", displayValue: "vector", rawValue: null,
    containerKind: "vector",
    children: [0, 1].map((c) => ({
      id: `frame-0-res-${r}-${c}`, name: `[${c}]`, source: "stack", kind: "scalar" as const,
      address: null, type: "int", displayValue: String(r + c), rawValue: null,
    })),
  })),
});

const memWithBoth = (): NormalizedMemory => ({
  globals: [],
  frames: [{ id: "frame-0", name: "levelOrder", cells: [resMatrix()] }],
  heap: [treeNode("0x10", 5, "0x20", null), treeNode("0x20", 3, null, null)],
  links: [],
});

const shapesOf = (m: NormalizedMemory) => applyShapes(m, CONFIRMED, new Set()).shapes;

describe("buildGraphScene with pointer-tree shapes", () => {
  it("prefers the pointer tree over a vector<vector<int>> in the same memory", () => {
    const m = memWithBoth();
    const scene = buildGraphScene(m, null, [], 0, "auto", shapesOf(m))!;
    expect(scene.kind).toBe("tree");
    expect(scene.nodes.map((n) => n.label).sort()).toEqual(["3", "5"]);
  });

  it("falls back to the matrix detectors when no shapes are supplied", () => {
    const m = memWithBoth();
    const scene = buildGraphScene(m, null, [], 0)!;
    expect(scene.kind).not.toBe("tree");
  });

  it("skips the tree source in grid view", () => {
    const m = memWithBoth();
    const scene = buildGraphScene(m, null, [], 0, "grid", shapesOf(m))!;
    expect(scene.kind).toBe("grid");
  });

  it("returns a tree scene for a pure tree program (no containers at all)", () => {
    const m: NormalizedMemory = {
      globals: [], frames: [], links: [],
      heap: [treeNode("0x10", 1, null, null)],
    };
    expect(buildGraphScene(m, null, [], 0, "auto", shapesOf(m))!.kind).toBe("tree");
  });
});
