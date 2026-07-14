import { describe, expect, it } from "vitest";
import { layoutTree, NODE_W, NODE_H, V_GAP } from "../src/viz/treeLayout";
import type { CallTreeNode } from "../src/viz/callTree";

let nextId = 0;
function node(children: CallTreeNode[] = [], enterStep = 0): CallTreeNode {
  return {
    id: nextId++, funcName: "f", label: "f()", enterStep, exitStep: null,
    returnValue: null, depth: 0, children,
  };
}
const all = () => true;

describe("layoutTree", () => {
  it("places a chain vertically, one node per depth", () => {
    nextId = 0;
    const leaf = node();
    const mid = node([leaf]);
    const root = node([mid]);
    const pos = layoutTree([root], all);
    expect(pos.get(root.id)!.y).toBe(0);
    expect(pos.get(mid.id)!.y).toBe(NODE_H + V_GAP);
    expect(pos.get(leaf.id)!.y).toBe(2 * (NODE_H + V_GAP));
    // single-child chain: all centered on the same x
    expect(pos.get(root.id)!.x).toBe(pos.get(leaf.id)!.x);
  });

  it("centers a parent over its children, siblings in call order", () => {
    nextId = 0;
    const a = node();
    const b = node();
    const root = node([a, b]);
    const pos = layoutTree([root], all);
    expect(pos.get(a.id)!.x).toBeLessThan(pos.get(b.id)!.x);
    expect(pos.get(root.id)!.x).toBeCloseTo(
      (pos.get(a.id)!.x + pos.get(b.id)!.x) / 2,
    );
  });

  it("never overlaps nodes at the same depth", () => {
    nextId = 0;
    // fib(4)-shaped: uneven subtree sizes
    const t = node([
      node([node([node(), node()]), node()]),
      node([node(), node()]),
    ]);
    const pos = layoutTree([t], all);
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

  it("excludes invisible nodes and re-packs the survivors", () => {
    nextId = 0;
    const a = node([], 1);
    const b = node([], 5);
    const root = node([a, b], 0);
    const pos = layoutTree([root], (n) => n.enterStep <= 1);
    expect(pos.has(b.id)).toBe(false);
    // with b hidden, root centers over a alone
    expect(pos.get(root.id)!.x).toBe(pos.get(a.id)!.x);
  });

  it("is deterministic", () => {
    nextId = 0;
    const t = node([node([node()]), node()]);
    const p1 = layoutTree([t], all);
    const p2 = layoutTree([t], all);
    expect([...p1.entries()]).toEqual([...p2.entries()]);
  });
});
