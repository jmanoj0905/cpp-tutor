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
  // _Tuple_impl<1ul,...> and _Tuple_impl<2ul,...> base classes are not in the trace.
  // Only element [0]=1 is recoverable. Decoder returns what leaves() finds.
  it("decodes std::tuple (partial: old tracer emits only element 0)", () => {
    const tp = normalizeMemory(last("tp")).frames[0].cells.find((c) => c.name === "tp")!;
    expect(tp.containerKind).toBe("tuple");
    // Only leaf from _Head_base<0ul> is visible; values 2 and 3 are not in the trace.
    expect(tp.children?.map((c) => c.displayValue)).toEqual(["1"]);
  });

  it("decodes std::bitset as binary string", () => {
    const bs = normalizeMemory(last("bs")).frames[0].cells.find((c) => c.name === "bs")!;
    expect(bs.containerKind).toBe("bitset");
    // bitset<8>(5) → 00000101
    expect(bs.displayValue).toBe("00000101");
  });
});
