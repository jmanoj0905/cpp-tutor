import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";
import fixture from "../fixtures/stl/structlike.json";
import smartFixture from "../fixtures/stl/smartptr.json";

const last = (name: string): ExecPoint => {
  const steps = (fixture as any).trace as ExecPoint[];
  return [...steps].reverse().find((s) => (s.stack_to_render as any)?.[0]?.encoded_locals?.[name])!;
};

// ------------------------------------------------------------------ helpers
/** Minimal ExecPoint carrying one stack local. Heap is optional. */
function oneLocalStep(
  name: string,
  rawValue: unknown,
  heap: Record<string, unknown> = {},
): ExecPoint {
  return {
    line: 1,
    event: "step_line",
    func_name: "main",
    ordered_globals: [],
    globals: {},
    stdout: "",
    heap,
    stack_to_render: [
      {
        func_name: "main",
        unique_hash: "main_1",
        ordered_varnames: [name],
        encoded_locals: { [name]: rawValue },
      },
    ],
  };
}

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

  // ---------------------------------------------------------------- smart pointers
  // NOTE: The Valgrind 3.11.0 tracer crashes (DWARF assertion) for any program that
  // includes std::shared_ptr. smartptr.json therefore only contains unique_ptr steps.
  // The shared_ptr and weak_ptr decoder tests use synthetic ExecPoints instead.

  it("decodes unique_ptr as a reference to its pointee (real fixture)", () => {
    const steps = (smartFixture as any).trace as ExecPoint[];
    // Find a step where `up` is in locals
    const step = [...steps].reverse().find(
      (s) => (s.stack_to_render as any)?.[0]?.encoded_locals?.up,
    )!;
    expect(step).toBeDefined();
    const m = normalizeMemory(step);
    const up = m.frames[0].cells.find((c) => c.name === "up")!;
    expect(up.kind).toBe("reference");
    expect(up.containerKind).toBe("unique_ptr");
    // Link drawn to the heap pointee
    expect(m.links.some((l) => l.fromName === "up")).toBe(true);
  });

  it("decodes shared_ptr as a reference to its pointee with a refcount note (synthetic)", () => {
    // Synthetic ExecPoint — shared_ptr crashes Valgrind 3.11.0 so no real fixture.
    // Structure mirrors libstdc++ shared_ptr: _M_ptr (pointee) + _M_refcount._M_use_count.
    const step = oneLocalStep(
      "sp",
      [
        "C_STRUCT",
        "0x200",
        "shared_ptr<int>",
        ["_M_ptr", ["C_DATA", "0x200", "pointer", "0x100"]],
        [
          "_M_refcount",
          [
            "C_STRUCT",
            "0x208",
            "_Sp_counted_base<(__gnu_cxx::_Lock_policy)2>",
            ["_M_use_count", ["C_DATA", "0x20c", "int", 1]],
            ["_M_weak_count", ["C_DATA", "0x210", "int", 1]],
          ],
        ],
      ],
      {
        "0x100": ["C_ARRAY", "0x100", ["C_DATA", "0x100", "int", 42]],
      },
    );
    const m = normalizeMemory(step);
    const sp = m.frames[0].cells.find((c) => c.name === "sp")!;
    expect(sp.kind).toBe("reference");
    expect(sp.containerKind).toBe("shared_ptr");
    expect(sp.note).toMatch(/use_count/);
    // Link drawn to the heap pointee
    expect(m.links.some((l) => l.fromName === "sp")).toBe(true);
  });

  it("decodes weak_ptr as a reference to its pointee (synthetic)", () => {
    // Same libstdc++ layout as shared_ptr but use_count is irrelevant for weak_ptr.
    const step = oneLocalStep(
      "wp",
      [
        "C_STRUCT",
        "0x300",
        "weak_ptr<int>",
        ["_M_ptr", ["C_DATA", "0x300", "pointer", "0x100"]],
        ["_M_refcount", ["C_STRUCT", "0x308", "_Weak_count", []]],
      ],
      {
        "0x100": ["C_ARRAY", "0x100", ["C_DATA", "0x100", "int", 42]],
      },
    );
    const m = normalizeMemory(step);
    const wp = m.frames[0].cells.find((c) => c.name === "wp")!;
    expect(wp.kind).toBe("reference");
    expect(wp.containerKind).toBe("weak_ptr");
    expect(wp.note).toBe("weak (non-owning)");
    // Link drawn to the heap pointee
    expect(m.links.some((l) => l.fromName === "wp")).toBe(true);
  });
});
