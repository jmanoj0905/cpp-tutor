import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";
import fixture from "../fixtures/stl/structlike.json";

const last = (name: string): ExecPoint => {
  const steps = (fixture as any).trace as ExecPoint[];
  return [...steps].reverse().find((s) => (s.stack_to_render as any)?.[0]?.encoded_locals?.[name])!;
};

describe("struct-like decoders", () => {
  it("decodes std::pair", () => {
    const pr = normalizeMemory(last("pr")).frames[0].cells.find((c) => c.name === "pr")!;
    expect(pr.containerKind).toBe("pair");
    expect(pr.displayValue).toBe("(3, 4)");
  });

  // NOTE: Old libstdc++ tracer only emits _Head_base<0ul> (element 0) for tuple;
  // _Tuple_impl<1ul,...> and _Tuple_impl<2ul,...> base classes are NOT in the trace,
  // so only 1 of 3 declared elements is recoverable. Per the project rule
  // (untraceable → struct fallback), tupleDecoder returns null when recovered leaves
  // are fewer than the declared arity, and the generic struct renderer is used instead.
  it("tuple falls back to struct when trace is incomplete (old tracer omits elements 1+)", () => {
    const tp = normalizeMemory(last("tp")).frames[0].cells.find((c) => c.name === "tp")!;
    // Must NOT be a tuple container — it would be misleadingly partial.
    expect(tp.kind).toBe("struct");
    expect(tp.containerKind).toBeUndefined();
  });

  it("decodes std::bitset as binary string", () => {
    const bs = normalizeMemory(last("bs")).frames[0].cells.find((c) => c.name === "bs")!;
    expect(bs.containerKind).toBe("bitset");
    // bitset<8>(5) → 00000101
    expect(bs.displayValue).toBe("00000101");
  });
});
