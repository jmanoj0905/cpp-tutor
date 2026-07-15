import { describe, expect, it } from "vitest";
import { layoutTree, nodeWidth, NODE_W, NODE_H, V_GAP } from "../src/viz/treeLayout";
import type { CallTreeNode } from "../src/viz/callTree";

let nextId = 0;
function node(children: CallTreeNode[] = [], enterStep = 0): CallTreeNode {
  return {
    id: nextId++, funcName: "f", label: "f()", args: [], address: "0x0",
    enterStep, exitStep: null, returnValue: null, depth: 0, children,
  };
}
const fixed = () => NODE_W;

describe("nodeWidth", () => {
  it("has NODE_W as the floor and grows with label length", () => {
    expect(nodeWidth("f()")).toBe(NODE_W);
    expect(nodeWidth("x".repeat(40))).toBeGreaterThan(NODE_W);
  });
});

describe("layoutTree", () => {
  it("places a chain vertically, one node per depth", () => {
    nextId = 0;
    const leaf = node();
    const mid = node([leaf]);
    const root = node([mid]);
    const pos = layoutTree([root], fixed);
    expect(pos.get(root.id)!.y).toBe(0);
    expect(pos.get(mid.id)!.y).toBe(NODE_H + V_GAP);
    expect(pos.get(leaf.id)!.y).toBe(2 * (NODE_H + V_GAP));
    expect(pos.get(root.id)!.x).toBe(pos.get(leaf.id)!.x);
  });

  it("centers a parent over its children, siblings in call order", () => {
    nextId = 0;
    const a = node();
    const b = node();
    const root = node([a, b]);
    const pos = layoutTree([root], fixed);
    expect(pos.get(a.id)!.x).toBeLessThan(pos.get(b.id)!.x);
    expect(pos.get(root.id)!.x).toBeCloseTo(
      (pos.get(a.id)!.x + pos.get(b.id)!.x) / 2,
    );
  });

  it("never overlaps nodes at the same depth", () => {
    nextId = 0;
    const t = node([
      node([node([node(), node()]), node()]),
      node([node(), node()]),
    ]);
    const pos = layoutTree([t], fixed);
    const byDepth = new Map<number, number[]>();
    const walk = (n: CallTreeNode, d: number) => {
      const xs = byDepth.get(d) ?? [];
      xs.push(pos.get(n.id)!.x);
      byDepth.set(d, xs);
      n.children.forEach((c) => walk(c, d + 1));
    };
    walk(t, 0);
    for (const xs of byDepth.values()) {
      xs.sort((p, q) => p - q);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(NODE_W);
      }
    }
  });

  it("lays out every node regardless of enterStep (static full tree)", () => {
    nextId = 0;
    const late = node([], 500);
    const root = node([late], 0);
    const pos = layoutTree([root], fixed);
    expect(pos.has(late.id)).toBe(true);
  });

  it("carries per-node width and keeps variable-width siblings apart", () => {
    nextId = 0;
    const a = node();
    const b = node();
    const root = node([a, b]);
    const widths = new Map([[a.id, 300], [b.id, 100], [root.id, NODE_W]]);
    const pos = layoutTree([root], (n) => widths.get(n.id)!);
    expect(pos.get(a.id)!.w).toBe(300);
    expect(pos.get(b.id)!.x - pos.get(b.id)!.w / 2).toBeGreaterThanOrEqual(
      pos.get(a.id)!.x + pos.get(a.id)!.w / 2,
    );
  });

  it("clamps a wide parent inside its own band (no bleed into siblings)", () => {
    nextId = 0;
    const kid = node();
    const wide = node([kid]);
    const sib = node();
    const root = node([wide, sib]);
    const widthOf = (n: CallTreeNode) => (n.id === wide.id ? 400 : 100);
    const pos = layoutTree([root], widthOf);
    expect(pos.get(sib.id)!.x - pos.get(sib.id)!.w / 2).toBeGreaterThanOrEqual(
      pos.get(wide.id)!.x + pos.get(wide.id)!.w / 2,
    );
  });

  it("is deterministic", () => {
    nextId = 0;
    const t = node([node([node()]), node()]);
    const p1 = layoutTree([t], fixed);
    const p2 = layoutTree([t], fixed);
    expect([...p1.entries()]).toEqual([...p2.entries()]);
  });
});
