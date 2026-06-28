// frontend/tests/stl/nodeChain.test.ts
//
// Real-trace findings for this old libstdc++:
//   • Each list node is a C_ARRAY in the heap: [0]=_List_node_base (next/prev ptrs), [1]=value
//     area showing UNINITIALIZED/UNALLOCATED (int bytes misread as ptr by old tracer).
//   • The stored int values (1,2,3 / 4,5) are NOT accessible in this trace format.
//   • We assert containerKind + chain length (structure is walkable), not displayValues.
//   • last("f") picks step 6 where f._M_next=0x0 (forward_list already empty at that point),
//     so we use a helper that picks the last step where the heap contains forward_list nodes.

import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";
import fixture from "../fixtures/stl/list.json";

/** Last step where `name` appears in frame locals. */
const last = (name: string): ExecPoint => {
  const steps = (fixture as any).trace as ExecPoint[];
  return [...steps].reverse().find(
    (s) => (s.stack_to_render as any)?.[0]?.encoded_locals?.[name],
  )!;
};

/**
 * Last step where `name` appears in locals AND the heap has more than 3 nodes
 * (i.e. the forward_list nodes are still present alongside the list nodes).
 */
const lastWithForwardListNodes = (): ExecPoint => {
  const steps = (fixture as any).trace as ExecPoint[];
  return [...steps].reverse().find(
    (s) =>
      (s.stack_to_render as any)?.[0]?.encoded_locals?.["f"] &&
      Object.keys((s as any).heap ?? {}).length > 3,
  )!;
};

describe("node-chain decoders", () => {
  it("decodes std::list: containerKind and chain length", () => {
    const step = last("l");
    const l = normalizeMemory(step).frames[0].cells.find((c) => c.name === "l")!;
    expect(l.containerKind).toBe("list");
    // Chain walk produces 3 children (one per node); int payload not exposed by old tracer.
    expect(l.children?.length).toBe(3);
  });

  it("decodes std::forward_list: containerKind and chain length", () => {
    // step 6 shows empty f; use the last step that still has forward_list heap nodes.
    const step = lastWithForwardListNodes();
    const f = normalizeMemory(step).frames[0].cells.find((c) => c.name === "f")!;
    expect(f.containerKind).toBe("forward_list");
    // Chain walk produces 2 children; int payload not exposed by old tracer.
    expect(f.children?.length).toBe(2);
  });
});
