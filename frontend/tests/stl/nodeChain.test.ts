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
import type { NormalizedCell } from "../../src/viz/memoryModel";
import type { DecodeCtx } from "../../src/viz/stl/types";
import type { ExecPoint } from "../../src/types/trace";
import listFixture from "../fixtures/stl/list.json";
import treeFixture from "../fixtures/stl/tree.json";
import hashFixture from "../fixtures/stl/hash.json";
import {
  walkChainNodes,
  findPayloadMember,
  collectNodePayloads,
} from "../../src/viz/stl/nodeChain";

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

// ------------------------------------------------------------------ shared
// node-payload helper tests (Task 3). These exercise walkChainNodes,
// findPayloadMember, and collectNodePayloads directly against hand-built
// synthetic node cells — they do NOT depend on the tracer emitting real
// payload values, since no current fixture has one yet.

/** A scalar leaf cell, as memoryModel would decode a C_DATA int. */
function scalar(id: string, name: string, address: string, value: string): NormalizedCell {
  return {
    id, name, source: "heap", kind: "scalar",
    address, type: "int", displayValue: value, rawValue: value,
  };
}

/** A reference (pointer) cell, as memoryModel would decode a C_DATA pointer. */
function ptr(id: string, name: string, target: string): NormalizedCell {
  return {
    id, name, source: "heap", kind: "reference",
    address: null, type: null, displayValue: `-> ${target}`, rawValue: null,
    targetAddress: target,
  };
}

/**
 * A heap "node" as it appears in ctx.heapByAddress: a C_ARRAY cell whose first
 * child is the node struct (address shared with the array), matching how the
 * real tracer emits list/forward_list/hash nodes (see fixtures/stl/list.json).
 */
function nodeArray(
  addr: string, nextName: string, nextAddr: string,
  payload?: { name: string; value: string },
): NormalizedCell {
  const children: NormalizedCell[] = [ptr(`${addr}-${nextName}`, nextName, nextAddr)];
  if (payload) children.push(scalar(`${addr}-payload`, payload.name, addr, payload.value));
  const struct: NormalizedCell = {
    id: `struct-${addr}`, name: "", source: "heap", kind: "struct",
    address: addr, type: "_Node_base", children, displayValue: "_Node_base", rawValue: null,
  };
  return {
    id: `arr-${addr}`, name: "", source: "heap", kind: "array",
    address: addr, type: "array", length: 1, children: [struct], displayValue: "array",
  };
}

function ctxFor(nodes: NormalizedCell[]): DecodeCtx {
  const heapByAddress = new Map(nodes.map((n) => [n.address!, n]));
  return { heapByAddress, consumed: new Set() };
}

function containerCell(id: string): NormalizedCell {
  return {
    id, name: "c", source: "stack", kind: "container", address: "0xC0",
    type: "container<int>", displayValue: "container", rawValue: null,
  };
}

describe("walkChainNodes — trusted vs untrusted walks", () => {
  it("returns complete:true with all node cells for a null-terminated chain, and consumes addresses", () => {
    const n1 = nodeArray("0x100", "_M_next", "0x200");
    const n2 = nodeArray("0x200", "_M_next", "0x300");
    const n3 = nodeArray("0x300", "_M_next", "0x0");
    const ctx = ctxFor([n1, n2, n3]);

    const result = walkChainNodes("0x100", "_M_next", ctx);

    expect(result.complete).toBe(true);
    expect(result.nodes).toHaveLength(3);
    expect(ctx.consumed.has("0x100")).toBe(true);
    expect(ctx.consumed.has("0x200")).toBe(true);
    expect(ctx.consumed.has("0x300")).toBe(true);
  });

  it("stops at the sentinel address (list rule) and consumes only the visited nodes", () => {
    const n1 = nodeArray("0x100", "_M_next", "0x200");
    const n2 = nodeArray("0x200", "_M_next", "0xSENTINEL");
    const ctx = ctxFor([n1, n2]);

    const result = walkChainNodes("0x100", "_M_next", ctx, "0xSENTINEL");

    expect(result.complete).toBe(true);
    expect(result.nodes).toHaveLength(2);
    expect(ctx.consumed.size).toBe(2);
  });

  it("returns complete:false and does NOT consume any address when a node is missing from the snapshot", () => {
    const n1 = nodeArray("0x100", "_M_next", "0x200"); // 0x200 never provided
    const ctx = ctxFor([n1]);

    const result = walkChainNodes("0x100", "_M_next", ctx);

    expect(result.complete).toBe(false);
    expect(ctx.consumed.size).toBe(0);
  });

  it("returns complete:false when a doubly-linked chain never loops back to the sentinel", () => {
    const n1 = nodeArray("0x100", "_M_next", "0x200");
    const n2 = nodeArray("0x200", "_M_next", "0x0"); // never reaches sentinel
    const ctx = ctxFor([n1, n2]);

    const result = walkChainNodes("0x100", "_M_next", ctx, "0xSENTINEL");

    expect(result.complete).toBe(false);
    expect(ctx.consumed.size).toBe(0);
  });
});

describe("findPayloadMember — accepted-names lookup", () => {
  it("finds the payload member by the first matching accepted name", () => {
    const node = nodeArray("0x100", "_M_next", "0x0", { name: "_M_value", value: "42" });
    const found = findPayloadMember(node, ["_M_data", "_M_value", "_M_value_field"]);
    expect(found?.displayValue).toBe("42");
  });

  it("returns undefined when no accepted name is present (old tracer, no payload)", () => {
    const node = nodeArray("0x100", "_M_next", "0x0"); // no payload member at all
    const found = findPayloadMember(node, ["_M_data", "_M_value", "_M_value_field"]);
    expect(found).toBeUndefined();
  });
});

describe("collectNodePayloads — placeholder fallback and rebasing", () => {
  it("returns null when ANY visited node is missing its payload (fallback to placeholders, not raw internals)", () => {
    const n1 = nodeArray("0x100", "_M_next", "0x200", { name: "_M_data", value: "1" });
    const n2 = nodeArray("0x200", "_M_next", "0x0"); // missing payload
    const parent = containerCell("stack-l");

    const result = collectNodePayloads(parent, [n1, n2], ["_M_data"]);

    expect(result).toBeNull();
  });

  it("rebases each recovered payload under the owning container with stable logical ids", () => {
    const n1 = nodeArray("0x100", "_M_next", "0x200", { name: "_M_data", value: "1" });
    const n2 = nodeArray("0x200", "_M_next", "0x0", { name: "_M_data", value: "2" });
    const parent = containerCell("stack-l");

    const result = collectNodePayloads(parent, [n1, n2], ["_M_data"]);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].displayValue).toBe("1");
    expect(result![1].displayValue).toBe("2");
    // Rebased under the container's own id, NOT the transient heap node's id.
    expect(result![0].id.startsWith(parent.id)).toBe(true);
    expect(result![1].id.startsWith(parent.id)).toBe(true);
  });

  it("preserves nested payload structure (e.g. a pair-shaped payload keeps its children)", () => {
    const pairPayload: NormalizedCell = {
      id: "payload-pair", name: "_M_value_field", source: "heap", kind: "struct",
      address: "0x100", type: "pair<int,int>", displayValue: "pair<int,int>", rawValue: null,
      children: [
        scalar("payload-pair-first", "first", "0x100", "5"),
        scalar("payload-pair-second", "second", "0x104", "9"),
      ],
    };
    const struct: NormalizedCell = {
      id: "struct-0x100", name: "", source: "heap", kind: "struct", address: "0x100",
      type: "_Rb_tree_node", displayValue: "_Rb_tree_node", rawValue: null,
      children: [ptr("0x100-next", "_M_next", "0x0"), pairPayload],
    };
    const node: NormalizedCell = {
      id: "arr-0x100", name: "", source: "heap", kind: "array", address: "0x100",
      type: "array", length: 1, children: [struct], displayValue: "array",
    };
    const parent = containerCell("stack-m");

    const result = collectNodePayloads(parent, [node], ["_M_value_field"]);

    expect(result).not.toBeNull();
    expect(result![0].children).toHaveLength(2);
    expect(result![0].children![0].displayValue).toBe("5");
    expect(result![0].children![1].displayValue).toBe("9");
  });
});
