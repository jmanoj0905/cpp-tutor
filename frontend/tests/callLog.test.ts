import { describe, expect, it } from "vitest";
import { isCollapsed, countDescendants } from "../src/viz/callLog";
import type { CallTreeNode } from "../src/viz/callTree";

function node(over: Partial<CallTreeNode>): CallTreeNode {
  return {
    id: 0, funcName: "f", label: "f()", args: [], address: "0x1",
    enterStep: 0, exitStep: null, returnValue: null, depth: 0, children: [],
    ...over,
  };
}

describe("isCollapsed", () => {
  const leaf = node({ id: 1 });
  const parent = node({ id: 2, exitStep: 5, children: [leaf] });

  it("explicit override wins both ways", () => {
    expect(isCollapsed(parent, 99, new Map([[2, true]]))).toBe(true);
    expect(isCollapsed(parent, 99, new Map([[2, false]]))).toBe(false);
  });

  it("auto-collapses a subtree that fully returned before now", () => {
    // exitStep 5 < step 8 -> collapsed
    expect(isCollapsed(parent, 8, new Map())).toBe(true);
  });

  it("auto-expands while live or still to come", () => {
    expect(isCollapsed(parent, 5, new Map())).toBe(false); // exitStep === step
    expect(isCollapsed(node({ exitStep: null, children: [leaf] }), 3, new Map())).toBe(false);
  });

  it("a leaf (no children) is never collapsed", () => {
    expect(isCollapsed(leaf, 999, new Map([[1, true]]))).toBe(false);
  });
});

describe("countDescendants", () => {
  it("counts all nodes below, excluding self", () => {
    const g = node({ id: 3 });
    const c = node({ id: 4, children: [g] });
    const root = node({ id: 5, children: [c, node({ id: 6 })] });
    expect(countDescendants(root)).toBe(3); // c, g, sibling
  });
});
