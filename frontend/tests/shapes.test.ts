import { describe, expect, it } from "vitest";
import { applyShapes, candidateKind, collectGroups, selfPtrMembers, confirmShapeTypes } from "../src/viz/shapes";
import type { MemoryLink, NormalizedCell, NormalizedMemory } from "../src/viz/memoryModel";
import type { ExecPoint } from "../src/types/trace";
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

  it("real-trace generic 'pointer' type: only address-resolving-within-own-type-group members count as self-pointers", () => {
    // Real backend traces collapse every pointer member's type to the literal
    // string "pointer" (pointee type is lost). A char*/unrelated pointer member
    // typed "pointer" must NOT make a struct a shape candidate just because it
    // happens to be the only/second pointer field — it must resolve to another
    // cell of the SAME struct type to count.
    const other = structCell("0xAA", "Other", [{ name: "tag", type: "int" }]);
    const wrapper = structCell("0x1", "Wrapper", [
      { name: "val", type: "int", displayValue: "1" },
      // "label" is typed "pointer" (generic) but resolves to a DIFFERENT struct type.
      { name: "label", type: "pointer", kind: "reference", displayValue: "-> 0xAA", targetAddress: "0xAA" },
    ]);
    const groupsFalsePositive = collectGroups(memoryWith([wrapper, other]));
    expect(groupsFalsePositive.has("Wrapper")).toBe(false);

    // A genuine self-referential struct whose member is ALSO generically typed
    // "pointer" (as real traces emit) but resolves within its own type's group
    // IS detected.
    const n1 = structCell("0x2", "PNode", [
      { name: "val", type: "int", displayValue: "1" },
      { name: "next", type: "pointer", kind: "reference", displayValue: "-> 0x3", targetAddress: "0x3" },
    ]);
    const n2 = structCell("0x3", "PNode", [
      { name: "val", type: "int", displayValue: "2" },
      { name: "next", type: "pointer", displayValue: "0x0" },
    ]);
    const groupsTruePositive = collectGroups(memoryWith([n1, n2]));
    expect(groupsTruePositive.get("PNode")?.kind).toBe("list");
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

describe("applyShapes — array-wrapped struct (real-tracer new-allocation shape)", () => {
  it("aliases the inner struct's ShapeNode id to the wrapper's id so links resolve and the finger is recognized", () => {
    // The real tracer wraps every `new`-allocated struct in a single-element
    // C_ARRAY at the same heap address. resolveReferences (memoryModel.ts)
    // always points MemoryLink.toId at the WRAPPER's id (`heap-heap-0x1`),
    // never the inner struct's array-indexed id — so bucketStructCells must
    // alias the struct it finds inside the wrapper to the wrapper's id.
    const inner = listNode("0x1", 7, null);
    expect(inner.id).toBe("heap-heap-0x1"); // sanity: shapeHelpers' listNode id, before we diverge it below
    const innerStructCell = { ...inner, id: "heap-heap-0x1--0-" }; // distinct from wrapper id, proving the alias does something
    const wrapper: NormalizedCell = {
      id: "heap-heap-0x1", name: "0x1", source: "heap", kind: "array",
      address: "0x1", type: "array", displayValue: "ListNode[1]", rawValue: null,
      children: [innerStructCell],
    };

    const link: MemoryLink = {
      fromId: "stack-main-head", fromName: "head",
      toId: "heap-heap-0x1", targetAddress: "0x1",
    };

    const { shapes } = applyShapes(memoryWith([wrapper], [link]), CONFIRMED_LIST, NONE);
    expect(shapes).toHaveLength(1);
    const s = shapes[0];
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0].id).toBe("heap-heap-0x1"); // aliased to the wrapper's id, matching link.toId
    expect(s.detached).toEqual([]); // finger correctly recognized — not detached
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

/** Minimal ExecPoint with just a raw heap; enough for normalizeMemory. */
function pointWithHeap(heap: Record<string, unknown>): ExecPoint {
  return {
    line: 1, event: "step_line", stack_to_render: [], heap,
    globals: {}, ordered_globals: [], stdout: "",
  } as unknown as ExecPoint;
}
const rawListNode = (addr: string, val: number, next: string | null) =>
  ["C_STRUCT", addr, "ListNode",
    ["val", ["C_DATA", `${addr}0`, "int", val]],
    ["next", ["C_DATA", `${addr}8`, "ListNode *", next ?? "0x0"]]];

describe("confirmShapeTypes", () => {
  it("confirms a clean list at any step and stays sticky", () => {
    const trace = [
      pointWithHeap({}),
      pointWithHeap({ "0x1": rawListNode("0x1", 1, "0x2"), "0x2": rawListNode("0x2", 2, null) }),
      // later step is a convergent mess; confirmation must not be revoked
      pointWithHeap({
        "0x1": rawListNode("0x1", 1, "0x3"),
        "0x2": rawListNode("0x2", 2, "0x3"),
        "0x3": rawListNode("0x3", 3, null),
      }),
    ];
    const info = confirmShapeTypes(trace);
    expect(info.confirmed.get("ListNode")).toBe("list");
  });

  it("never confirms a type that only ever appears convergent", () => {
    const trace = [
      pointWithHeap({
        "0x1": rawListNode("0x1", 1, "0x3"),
        "0x2": rawListNode("0x2", 2, "0x3"),
        "0x3": rawListNode("0x3", 3, null),
      }),
    ];
    expect(confirmShapeTypes(trace).confirmed.has("ListNode")).toBe(false);
  });

  it("a list cycle back-edge still confirms", () => {
    const trace = [pointWithHeap({
      "0x1": rawListNode("0x1", 1, "0x2"),
      "0x2": rawListNode("0x2", 2, "0x3"),
      "0x3": rawListNode("0x3", 3, "0x2"),
    })];
    expect(confirmShapeTypes(trace).confirmed.get("ListNode")).toBe("list");
  });

  it("records first-seen step per address", () => {
    const trace = [
      pointWithHeap({}),
      pointWithHeap({ "0x1": rawListNode("0x1", 1, null) }),
      pointWithHeap({ "0x1": rawListNode("0x1", 1, "0x2"), "0x2": rawListNode("0x2", 2, null) }),
    ];
    const info = confirmShapeTypes(trace);
    expect(info.firstSeen.get("0x1")).toBe(1);
    expect(info.firstSeen.get("0x2")).toBe(2);
  });
});

describe("null-piggyback regression (fix round 2)", () => {
  it("an always-null, unrelated 'pointer'-typed field does NOT ride along with a proven self-pointer", () => {
    // Genuine list struct: `next` resolves within the same-type group (proven
    // self-referential). `label` is an ordinary, always-null, UNRELATED
    // "pointer"-typed field (e.g. char* label) that must NOT be granted
    // self-status just because one other member on the struct is proven —
    // that was the null-piggyback bug. Per-step fallback path: no override.
    const n1 = structCell("0x1", "Node", [
      { name: "val", type: "int", displayValue: "1" },
      { name: "next", type: "pointer", kind: "reference", displayValue: "-> 0x2", targetAddress: "0x2" },
      { name: "label", type: "pointer", displayValue: "0x0" }, // always null, unrelated
    ]);
    const n2 = structCell("0x2", "Node", [
      { name: "val", type: "int", displayValue: "2" },
      { name: "next", type: "pointer", displayValue: "0x0" },
      { name: "label", type: "pointer", displayValue: "0x0" }, // always null, unrelated
    ]);
    const groups = collectGroups(memoryWith([n1, n2]));
    const g = groups.get("Node");
    expect(g?.kind).toBe("list");
    expect(g?.selfNames.size).toBe(1);
    expect(g?.selfNames.has("next")).toBe(true);
    expect(g?.selfNames.has("label")).toBe(false);
  });

  it("whole-trace override lets a name proven only at a LATER step win over incomplete single-step evidence", () => {
    // Simulates tree-insert: at this single step `right` is null on every
    // cell, so per-step evidence alone would only prove `left`. A whole-trace
    // override (as confirmShapeTypes now builds) supplies both proven names.
    const n1 = structCell("0x1", "TreeNode", [
      { name: "val", type: "int", displayValue: "1" },
      { name: "left", type: "pointer", kind: "reference", displayValue: "-> 0x2", targetAddress: "0x2" },
      { name: "right", type: "pointer", displayValue: "0x0" },
    ]);
    const n2 = structCell("0x2", "TreeNode", [
      { name: "val", type: "int", displayValue: "2" },
      { name: "left", type: "pointer", displayValue: "0x0" },
      { name: "right", type: "pointer", displayValue: "0x0" },
    ]);
    const override = new Map<string, Set<string>>([["TreeNode", new Set(["left", "right"])]]);
    const groups = collectGroups(memoryWith([n1, n2]), override);
    const g = groups.get("TreeNode");
    expect(g?.kind).toBe("tree");
    expect(g?.selfNames.size).toBe(2);
  });
});
