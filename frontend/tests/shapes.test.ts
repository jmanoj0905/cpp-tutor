import { describe, expect, it } from "vitest";
import { applyShapes, candidateKind, selfPtrMembers } from "../src/viz/shapes";
import type { MemoryLink, NormalizedMemory } from "../src/viz/memoryModel";
import { listNode, structCell, treeNode } from "./shapeHelpers";

describe("candidacy", () => {
  it("one self-pointer (even when null) makes a list candidate", () => {
    expect(candidateKind(listNode("0x1", 7, null))).toBe("list");
    expect(candidateKind(listNode("0x1", 7, "0x2"))).toBe("list");
  });

  it("two self-pointers make a tree candidate", () => {
    expect(candidateKind(treeNode("0x1", 5, null, null))).toBe("tree");
  });

  it("struct prefix and spacing variants still match", () => {
    const c = structCell("0x1", "struct ListNode", [
      { name: "val", type: "int" },
      { name: "next", type: "struct ListNode*", displayValue: "0x0" },
    ]);
    expect(candidateKind(c)).toBe("list");
  });

  it("zero or 3+ self-pointers, non-structs, and other-typed pointers are not candidates", () => {
    expect(candidateKind(structCell("0x1", "Point", [{ name: "x" }, { name: "y" }]))).toBeNull();
    const graph = structCell("0x1", "Node", [
      { name: "a", type: "Node *", displayValue: "0x0" },
      { name: "b", type: "Node *", displayValue: "0x0" },
      { name: "c", type: "Node *", displayValue: "0x0" },
    ]);
    expect(candidateKind(graph)).toBeNull();
    const other = structCell("0x1", "Wrapper", [{ name: "p", type: "ListNode *", displayValue: "0x0" }]);
    expect(candidateKind(other)).toBeNull();
  });

  it("selfPtrMembers returns members in declaration order (slot order)", () => {
    const t = treeNode("0x1", 5, "0x2", "0x3");
    expect(selfPtrMembers(t).map((m) => m.name)).toEqual(["left", "right"]);
  });
});

function memoryWith(heap: NormalizedCell[], links: MemoryLink[] = []): NormalizedMemory {
  return { globals: [], frames: [], heap, links };
}
const fingerLink = (name: string, toAddr: string): MemoryLink => ({
  fromId: `stack-main-${name}`, fromName: name, toId: `heap-heap-${toAddr}`, targetAddress: toAddr,
});
const CONFIRMED_LIST = new Map<string, "list" | "tree">([["ListNode", "list"]]);
const NONE = new Set<string>();

describe("applyShapes — lists", () => {
  it("builds one chain in pointer order and consumes the heap cells", () => {
    // allocation order deliberately scrambled: chain is 0x3 -> 0x1 -> 0x2
    const heap = [listNode("0x1", 2, "0x2"), listNode("0x2", 3, null), listNode("0x3", 1, "0x1")];
    const { memory, shapes } = applyShapes(
      memoryWith(heap, [fingerLink("head", "0x3")]), CONFIRMED_LIST, NONE);
    expect(shapes).toHaveLength(1);
    const s = shapes[0];
    expect(s.kind).toBe("list");
    expect(s.typeName).toBe("ListNode");
    expect(s.groups).toEqual([["heap-heap-0x3", "heap-heap-0x1", "heap-heap-0x2"]]);
    expect(s.nodes.map((n) => n.label)).toContain("1");
    expect(s.edges).toHaveLength(2);
    expect(memory.heap).toHaveLength(0); // consumed
    expect(s.detached).toEqual([]);
  });

  it("keeps unconfirmed and disabled types generic", () => {
    const heap = [listNode("0x1", 1, null)];
    const none = applyShapes(memoryWith(heap), new Map(), NONE);
    expect(none.shapes).toHaveLength(0);
    expect(none.memory.heap).toHaveLength(1);
    const disabled = applyShapes(memoryWith(heap), CONFIRMED_LIST, new Set(["ListNode"]));
    expect(disabled.shapes).toHaveLength(0);
    expect(disabled.memory.heap).toHaveLength(1);
  });

  it("marks a cycle back-edge instead of looping forever", () => {
    const heap = [
      listNode("0x1", 1, "0x2"), listNode("0x2", 2, "0x3"),
      listNode("0x3", 3, "0x2"), // tail -> 0x2
    ];
    const { shapes } = applyShapes(
      memoryWith(heap, [fingerLink("head", "0x1")]), CONFIRMED_LIST, NONE);
    const s = shapes[0];
    expect(s.groups).toEqual([["heap-heap-0x1", "heap-heap-0x2", "heap-heap-0x3"]]);
    const back = s.edges.find((e) => e.fromId === "heap-heap-0x3");
    expect(back?.cycleBack).toBe(true);
  });

  it("renders two disjoint chains as two rows; unfingered chain is detached", () => {
    const heap = [
      listNode("0x1", 1, "0x2"), listNode("0x2", 2, null),
      listNode("0x8", 9, "0x9"), listNode("0x9", 10, null),
    ];
    const { shapes } = applyShapes(
      memoryWith(heap, [fingerLink("head", "0x1")]), CONFIRMED_LIST, NONE);
    const s = shapes[0];
    expect(s.groups).toHaveLength(2);
    expect(s.groups[0][0]).toBe("heap-heap-0x1"); // finger-entered chain first
    expect(s.detached).toEqual(["heap-heap-0x8", "heap-heap-0x9"]);
  });

  it("survives transient convergence mid-mutation without dropping nodes", () => {
    // two heads both pointing at 0x3 (mid list-merge state)
    const heap = [listNode("0x1", 1, "0x3"), listNode("0x2", 2, "0x3"), listNode("0x3", 3, null)];
    const { shapes, memory } = applyShapes(memoryWith(heap), CONFIRMED_LIST, NONE);
    const s = shapes[0];
    expect(s.nodes).toHaveLength(3);
    expect(s.groups.flat().sort()).toEqual(["heap-heap-0x1", "heap-heap-0x2", "heap-heap-0x3"]);
    expect(s.edges).toHaveLength(2); // both edges kept and drawn
    expect(memory.heap).toHaveLength(0);
  });

  it("node payloadIds cover payload leaves, not the self pointer", () => {
    const { shapes } = applyShapes(memoryWith([listNode("0x1", 7, null)]), CONFIRMED_LIST, NONE);
    const n = shapes[0].nodes[0];
    expect(n.payloadIds).toEqual(["heap-heap-0x1-val"]);
    expect(n.label).toBe("7");
  });
});

const CONFIRMED_TREE = new Map<string, "list" | "tree">([["TreeNode", "tree"]]);

describe("applyShapes — trees", () => {
  it("builds a pre-order group with slot-tagged edges", () => {
    const heap = [
      treeNode("0x5", 5, "0x3", "0x8"),
      treeNode("0x3", 3, null, null),
      treeNode("0x8", 8, null, null),
    ];
    const { shapes, memory } = applyShapes(
      memoryWith(heap, [fingerLink("root", "0x5")]), CONFIRMED_TREE, NONE);
    const s = shapes[0];
    expect(s.kind).toBe("tree");
    expect(s.groups).toEqual([["heap-heap-0x5", "heap-heap-0x3", "heap-heap-0x8"]]);
    const left = s.edges.find((e) => e.toId === "heap-heap-0x3");
    const right = s.edges.find((e) => e.toId === "heap-heap-0x8");
    expect(left?.slot).toBe(0);
    expect(right?.slot).toBe(1);
    expect(memory.heap).toHaveLength(0);
    expect(s.detached).toEqual([]);
  });

  it("renders a forest: detached second root goes to detached", () => {
    const heap = [
      treeNode("0x5", 5, null, null),
      treeNode("0x9", 9, null, null),
    ];
    const { shapes } = applyShapes(
      memoryWith(heap, [fingerLink("root", "0x5")]), CONFIRMED_TREE, NONE);
    const s = shapes[0];
    expect(s.groups).toHaveLength(2);
    expect(s.groups[0]).toEqual(["heap-heap-0x5"]);
    expect(s.detached).toEqual(["heap-heap-0x9"]);
  });

  it("tolerates a transient double-parent without duplicating the child", () => {
    // mid-rotation: both 0x5.left and 0x9.left point at 0x3
    const heap = [
      treeNode("0x5", 5, "0x3", null),
      treeNode("0x9", 9, "0x3", null),
      treeNode("0x3", 3, null, null),
    ];
    const { shapes } = applyShapes(memoryWith(heap), CONFIRMED_TREE, NONE);
    const s = shapes[0];
    expect(s.groups.flat().sort()).toEqual(["heap-heap-0x3", "heap-heap-0x5", "heap-heap-0x9"]);
    expect(s.groups.flat()).toHaveLength(3); // each node laid out once
    expect(s.edges).toHaveLength(2); // both edges still drawn
  });
});
