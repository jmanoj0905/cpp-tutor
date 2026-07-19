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
