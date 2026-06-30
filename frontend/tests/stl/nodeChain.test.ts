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
// list/forward_list/hash: return null → struct fallback (asserted below).
// map/set: treeDecoder collapses to kind:"container" with placeholder children.

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

describe("node-chain decoders — struct fallback", () => {
  it("std::list falls back to struct (tracer omits node payload)", () => {
    const step = lastStep(listFixture as any, "l");
    const cell = normalizeMemory(step).frames[0].cells.find((c) => c.name === "l")!;
    expect(cell).toBeDefined();
    expect(cell.kind).toBe("struct");
    expect((cell as any).containerKind).toBeUndefined();
  });

  it("std::forward_list falls back to struct (tracer omits node payload)", () => {
    const step = lastStep(listFixture as any, "f");
    const cell = normalizeMemory(step).frames[0].cells.find((c) => c.name === "f")!;
    expect(cell).toBeDefined();
    expect(cell.kind).toBe("struct");
    expect((cell as any).containerKind).toBeUndefined();
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

  it("std::unordered_map falls back to struct (tracer omits node payload)", () => {
    const step = lastStep(hashFixture as any, "um");
    const cell = normalizeMemory(step).frames[0].cells.find((c) => c.name === "um")!;
    expect(cell).toBeDefined();
    expect(cell.kind).toBe("struct");
    expect((cell as any).containerKind).toBeUndefined();
  });

  it("std::unordered_set falls back to struct (tracer omits node payload)", () => {
    const step = lastStep(hashFixture as any, "us");
    const cell = normalizeMemory(step).frames[0].cells.find((c) => c.name === "us")!;
    expect(cell).toBeDefined();
    expect(cell.kind).toBe("struct");
    expect((cell as any).containerKind).toBeUndefined();
  });
});
