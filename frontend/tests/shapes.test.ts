import { describe, expect, it } from "vitest";
import { candidateKind, selfPtrMembers } from "../src/viz/shapes";
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
