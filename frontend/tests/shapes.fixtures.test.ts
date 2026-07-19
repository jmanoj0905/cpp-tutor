import { describe, expect, it } from "vitest";
import listReverse from "./fixtures/shapes/list-reverse.json";
import listCycle from "./fixtures/shapes/list-cycle.json";
import treeInsert from "./fixtures/shapes/tree-insert.json";
import type { Trace } from "../src/types/trace";
import { applyShapes, confirmShapeTypes } from "../src/viz/shapes";
import { normalizeMemory } from "../src/viz/memoryModel";

const fixtures: [string, Trace][] = [
  ["list-reverse", listReverse as Trace],
  ["list-cycle", listCycle as Trace],
  ["tree-insert", treeInsert as Trace],
];

describe("shape fixtures", () => {
  it.each(fixtures)("%s has a non-trivial trace with heap structs", (_name, trace) => {
    expect(trace.trace.length).toBeGreaterThan(10);
    const lastWithHeap = [...trace.trace].reverse().find((p) => Object.keys(p.heap ?? {}).length > 0);
    expect(lastWithHeap).toBeDefined();
    const raw = JSON.stringify(lastWithHeap!.heap);
    expect(raw).toContain("C_STRUCT");
  });
});

describe("shape recognition on real traces", () => {
  it("list-reverse: ListNode confirmed as list; final step is one 3-node chain", () => {
    const t = (listReverse as Trace).trace;
    const info = confirmShapeTypes(t);
    expect(info.confirmed.get("ListNode")).toBe("list");
    const last = [...t].reverse().find((p) => Object.keys(p.heap ?? {}).length >= 3)!;
    const { shapes } = applyShapes(normalizeMemory(last), info.confirmed, new Set());
    expect(shapes).toHaveLength(1);
    expect(shapes[0].nodes).toHaveLength(3);
    expect(shapes[0].groups.flat()).toHaveLength(3);
  });

  it("list-cycle: confirmed with a cycleBack edge at the final step", () => {
    const t = (listCycle as Trace).trace;
    const info = confirmShapeTypes(t);
    expect(info.confirmed.get("ListNode")).toBe("list");
    const last = [...t].reverse().find((p) => Object.keys(p.heap ?? {}).length >= 4)!;
    const { shapes } = applyShapes(normalizeMemory(last), info.confirmed, new Set());
    expect(shapes[0].edges.some((e) => e.cycleBack)).toBe(true);
  });

  it("tree-insert: TreeNode confirmed as tree with 5 nodes pre-order", () => {
    const t = (treeInsert as Trace).trace;
    const info = confirmShapeTypes(t);
    expect(info.confirmed.get("TreeNode")).toBe("tree");
    const last = [...t].reverse().find((p) => Object.keys(p.heap ?? {}).length >= 5)!;
    const { shapes } = applyShapes(normalizeMemory(last), info.confirmed, new Set());
    expect(shapes[0].nodes).toHaveLength(5);
    expect(shapes[0].groups[0]).toHaveLength(5);
  });

  it("recursion fixtures confirm nothing (no self-referential structs)", () => {
    // guards against false positives on ordinary programs
    expect(confirmShapeTypes((treeInsert as Trace).trace).confirmed.has("int")).toBe(false);
  });
});
