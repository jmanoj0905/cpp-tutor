// frontend/tests/stl/nodeChain.test.ts
//
// Node-container decode tests.
//
// Tracer limitation (verified against real traces): this old libstdc++ tracer
// does NOT emit node payload values for any node-based container:
//   - std::list/forward_list nodes: C_ARRAY with two _List_node_base entries;
//     the value area appears as UNINITIALIZED/UNALLOCATED — int is gone.
//   - std::map/set nodes: C_ARRAY with only _Rb_tree_node_base (color+parent+
//     left+right); the key/value slot is absent entirely.
//   - std::unordered_*/hash nodes: C_ARRAY with _Hash_node_base/_M_nxt only;
//     the stored value is absent.
//
// All families collapse to kind:"container" with placeholder children.
// Element values remain unrecoverable (tracer limitation).
// map/set: treeDecoder uses _M_node_count for size.
// list/forward_list: listDecoder/forwardListDecoder walk the node chain.
// unordered_*: hashDecoder walks _M_nxt chain or falls back to _M_element_count.

import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";
import listFixture from "../fixtures/stl/list.json";
import treeFixture from "../fixtures/stl/tree.json";
import hashFixture from "../fixtures/stl/hash.json";

/** Last step in a fixture where `name` appears in frame locals. */
function lastStep(fixture: { trace: unknown[] }, name: string): ExecPoint {
  const steps = fixture.trace as ExecPoint[];
  return [...steps].reverse().find(
    (s) => (s.stack_to_render as any)?.[0]?.encoded_locals?.[name],
  )!;
}

describe("node-chain decoders — container collapse", () => {
  it("std::list collapses to a placeholder container", () => {
    const step = lastStep(listFixture as any, "l");
    const cell = normalizeMemory(step).frames[0].cells.find((c) => c.name === "l")!;
    expect(cell).toBeDefined();
    expect(cell.kind).toBe("container");
    expect(cell.containerKind).toBe("list");
    expect(cell.placeholders).toBe(true);
  });

  it("std::forward_list collapses to a placeholder container", () => {
    const step = lastStep(listFixture as any, "f");
    const cell = normalizeMemory(step).frames[0].cells.find((c) => c.name === "f")!;
    expect(cell).toBeDefined();
    expect(cell.kind).toBe("container");
    expect(cell.containerKind).toBe("forward_list");
    expect(cell.placeholders).toBe(true);
  });

  it("std::map collapses to a placeholder container (treeDecoder)", () => {
    const step = lastStep(treeFixture as any, "m");
    const cell = normalizeMemory(step).frames[0].cells.find((c) => c.name === "m")!;
    expect(cell).toBeDefined();
    expect(cell.kind).toBe("container");
    expect(cell.containerKind).toBe("map");
    expect(cell.placeholders).toBe(true);
  });

  it("std::set collapses to a placeholder container (treeDecoder)", () => {
    const step = lastStep(treeFixture as any, "s");
    const cell = normalizeMemory(step).frames[0].cells.find((c) => c.name === "s")!;
    expect(cell).toBeDefined();
    expect(cell.kind).toBe("container");
    expect(cell.containerKind).toBe("set");
    expect(cell.placeholders).toBe(true);
  });

  it("std::unordered_map collapses to a placeholder container", () => {
    const step = lastStep(hashFixture as any, "um");
    const cell = normalizeMemory(step).frames[0].cells.find((c) => c.name === "um")!;
    expect(cell).toBeDefined();
    expect(cell.kind).toBe("container");
    expect(cell.containerKind).toBe("unordered_map");
    expect(cell.placeholders).toBe(true);
  });

  it("std::unordered_set collapses to a placeholder container", () => {
    const step = lastStep(hashFixture as any, "us");
    const cell = normalizeMemory(step).frames[0].cells.find((c) => c.name === "us")!;
    expect(cell).toBeDefined();
    expect(cell.kind).toBe("container");
    expect(cell.containerKind).toBe("unordered_set");
    expect(cell.placeholders).toBe(true);
  });
});
