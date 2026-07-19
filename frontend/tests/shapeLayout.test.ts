import { describe, expect, it } from "vitest";
import type { ShapeModel } from "../src/viz/shapes";
import {
  CYCLE_ARC_H, layoutShape, S_H_GAP, S_V_GAP, shapeNodeWidth, SNODE_H, SNODE_MIN_W,
} from "../src/viz/shapeLayout";

const W = 40;
const fixedW = () => W;

function listShape(groups: string[][], edges: ShapeModel["edges"] = []): ShapeModel {
  return { kind: "list", typeName: "ListNode", nodes: [], edges, groups, detached: [] };
}

describe("shapeNodeWidth", () => {
  it("floors at SNODE_MIN_W and grows with the label", () => {
    expect(shapeNodeWidth("7")).toBe(SNODE_MIN_W);
    expect(shapeNodeWidth("1234567890")).toBeGreaterThan(SNODE_MIN_W);
  });
});

describe("layoutShape — list", () => {
  it("lays a chain left-to-right with H gaps", () => {
    const r = layoutShape(listShape([["a", "b", "c"]]), fixedW);
    expect(r.pos.get("a")).toEqual({ x: 0, y: 0, w: W });
    expect(r.pos.get("b")).toEqual({ x: W + S_H_GAP, y: 0, w: W });
    expect(r.pos.get("c")!.x).toBe(2 * (W + S_H_GAP));
    expect(r.width).toBe(3 * W + 2 * S_H_GAP);
    expect(r.height).toBe(SNODE_H);
  });

  it("stacks chains as rows", () => {
    const r = layoutShape(listShape([["a", "b"], ["x"]]), fixedW);
    expect(r.pos.get("x")!.y).toBe(SNODE_H + S_V_GAP);
    expect(r.height).toBe(2 * SNODE_H + S_V_GAP);
  });

  it("reserves arc room under a row with a cycle back-edge", () => {
    const edges = [{ fromId: "c", toId: "b", member: "next", memberCellId: "c-next", slot: 0, cycleBack: true }];
    const r = layoutShape(listShape([["a", "b", "c"], ["x"]], edges), fixedW);
    expect(r.pos.get("x")!.y).toBe(SNODE_H + CYCLE_ARC_H + S_V_GAP);
  });
});

import type { ShapeEdge } from "../src/viz/shapes";

function treeShape(groups: string[][], edges: ShapeEdge[]): ShapeModel {
  return { kind: "tree", typeName: "TreeNode", nodes: [], edges, groups, detached: [] };
}
const edge = (from: string, to: string, slot: number): ShapeEdge =>
  ({ fromId: from, toId: to, member: slot === 0 ? "left" : "right", memberCellId: `${from}-m`, slot });

describe("layoutShape — tree", () => {
  it("centers a parent over two children, children on their slot sides", () => {
    const r = layoutShape(
      treeShape([["p", "l", "r"]], [edge("p", "l", 0), edge("p", "r", 1)]), fixedW);
    const p = r.pos.get("p")!; const l = r.pos.get("l")!; const rr = r.pos.get("r")!;
    expect(l.y).toBe(SNODE_H + S_V_GAP);
    expect(rr.y).toBe(l.y);
    expect(l.x).toBeLessThan(p.x);
    expect(rr.x).toBeGreaterThan(p.x);
    // parent centered over the two child centers
    expect(p.x + W / 2).toBeCloseTo((l.x + W / 2 + rr.x + W / 2) / 2, 5);
  });

  it("an only-left child sits left of the parent; only-right sits right", () => {
    const left = layoutShape(treeShape([["p", "l"]], [edge("p", "l", 0)]), fixedW);
    expect(left.pos.get("l")!.x).toBeLessThan(left.pos.get("p")!.x);
    const right = layoutShape(treeShape([["p", "r"]], [edge("p", "r", 1)]), fixedW);
    expect(right.pos.get("r")!.x).toBeGreaterThan(right.pos.get("p")!.x);
  });

  it("sibling subtrees never overlap", () => {
    // p -> (a with two kids), (b with two kids)
    const edges = [
      edge("p", "a", 0), edge("p", "b", 1),
      edge("a", "a1", 0), edge("a", "a2", 1),
      edge("b", "b1", 0), edge("b", "b2", 1),
    ];
    const r = layoutShape(treeShape([["p", "a", "a1", "a2", "b", "b1", "b2"]], edges), fixedW);
    const row = ["a1", "a2", "b1", "b2"].map((id) => r.pos.get(id)!).sort((m, n) => m.x - n.x);
    for (let i = 1; i < row.length; i++) {
      expect(row[i].x).toBeGreaterThanOrEqual(row[i - 1].x + W + S_H_GAP);
    }
    expect(r.height).toBe(3 * SNODE_H + 2 * S_V_GAP);
  });

  it("multiple roots get separate non-overlapping bands", () => {
    const r = layoutShape(treeShape([["p"], ["q"]], []), fixedW);
    expect(r.pos.get("q")!.x).toBeGreaterThanOrEqual(r.pos.get("p")!.x + W + S_H_GAP);
    expect(r.pos.get("q")!.y).toBe(0);
  });
});
