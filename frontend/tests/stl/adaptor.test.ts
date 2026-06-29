import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";
import fixture from "../fixtures/stl/adaptor.json";

/**
 * Find the last trace step where `name` is in locals AND the heap snapshot has
 * at least 3 non-empty chunks (n_items > 1).  The OPT tracer emits partial
 * heap snapshots: chunks only appear when they were recently accessed, so the
 * final step may have empty-chunk placeholders for containers that exist but
 * weren't touched last.  Requiring 3+ non-empty chunks ensures we land on a
 * step where all three adaptor containers have live data.
 */
const last = (name: string): ExecPoint => {
  const steps = (fixture as any).trace as ExecPoint[];
  return [...steps].reverse().find((s) => {
    const locs = (s.stack_to_render as any)?.[0]?.encoded_locals;
    if (!locs?.[name]) return false;
    const heap = (s as any).heap as Record<string, unknown>;
    const nonEmpty = Object.values(heap ?? {}).filter(
      (v) => Array.isArray(v) && v.length > 3,
    ).length;
    return nonEmpty >= 3;
  })!;
};

/**
 * Like `last` but requires >= 5 non-empty heap chunks.  Used for pq: after
 * the pop() calls its heap buffer becomes empty in the snapshot, so we need a
 * step where all 5 chunks (stack buf, queue buf, pq buf, + two pointer arrays)
 * are live — that is step 5 in the fixture, which has pq = [9, 5, 1].
 */
const lastFull = (name: string): ExecPoint => {
  const steps = (fixture as any).trace as ExecPoint[];
  return [...steps].reverse().find((s) => {
    const locs = (s.stack_to_render as any)?.[0]?.encoded_locals;
    if (!locs?.[name]) return false;
    const heap = (s as any).heap as Record<string, unknown>;
    const nonEmpty = Object.values(heap ?? {}).filter(
      (v) => Array.isArray(v) && v.length > 3,
    ).length;
    return nonEmpty >= 5;
  })!;
};

describe("adaptor decoders", () => {
  it("decodes std::stack with elements and a top marker", () => {
    const st = normalizeMemory(last("st")).frames[0].cells.find((c) => c.name === "st")!;
    expect(st.containerKind).toBe("stack");
    expect(st.children?.map((c) => c.displayValue)).toEqual(["1", "2", "3"]);
    expect(st.note).toMatch(/top/);
  });
  it("decodes std::queue elements", () => {
    const q = normalizeMemory(last("q")).frames[0].cells.find((c) => c.name === "q")!;
    expect(q.containerKind).toBe("queue");
    expect(q.children?.map((c) => c.displayValue)).toEqual(["10", "20"]);
  });
  it("decodes std::priority_queue", () => {
    // Use a step where pq's heap buffer is populated (before pop() empties the
    // snapshot).  Fixture step 5 has heap order [9, 5, 1] — max-heap of {5,9,1}.
    const pq = normalizeMemory(lastFull("pq")).frames[0].cells.find(
      (c) => c.name === "pq",
    )!;
    expect(pq.containerKind).toBe("priority_queue");
    // Heap array order (not sorted): max element first then rest in heap layout.
    expect(pq.children?.map((c) => c.displayValue)).toEqual(["9", "5", "1"]);
  });
});
