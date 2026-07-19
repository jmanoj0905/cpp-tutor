import { describe, expect, it } from "vitest";
import listReverse from "./fixtures/shapes/list-reverse.json";
import listCycle from "./fixtures/shapes/list-cycle.json";
import treeInsert from "./fixtures/shapes/tree-insert.json";
import type { Trace } from "../src/types/trace";

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
