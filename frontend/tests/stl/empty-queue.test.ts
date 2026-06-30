import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";
import fixture from "../fixtures/stl/empty-queue.json";

/**
 * Real trace of:  queue<int> q; q.push(1); q.pop();
 *
 * A constructed-but-empty std::queue (after the pop, or before any push) has a
 * valid underlying deque whose _M_start and _M_finish iterators coincide. It
 * must collapse to an empty `queue · 0` container, NOT dump the raw deque guts
 * (_M_impl / _M_map / _M_start / _M_finish ...) into the memory view.
 */
const steps = (fixture as any).trace as ExecPoint[];
const qAt = (i: number) =>
  normalizeMemory(steps[i]).frames[0].cells.find((c) => c.name === "q")!;

describe("empty std::queue", () => {
  it("renders a constructed-but-empty queue as an empty container", () => {
    // Last step that still has `q` in scope — q is empty there (after pop()).
    const i = steps.map((s) => (s.stack_to_render as any)?.[0]?.encoded_locals?.q)
      .reduce((acc, q, idx) => (q ? idx : acc), -1);
    const q = qAt(i);
    expect(q.containerKind).toBe("queue");
    expect(q.children ?? []).toEqual([]);
    expect(q.length).toBe(0);
  });

  it("still decodes the same queue once it holds an element", () => {
    const withElem = steps.findIndex((s) => {
      const q = (s.stack_to_render as any)?.[0]?.encoded_locals?.q;
      return q && normalizeMemory(s).frames[0].cells.find((c) => c.name === "q")?.length === 1;
    });
    expect(withElem).toBeGreaterThanOrEqual(0);
    expect(qAt(withElem).children?.map((c) => c.displayValue)).toEqual(["1"]);
  });
});
