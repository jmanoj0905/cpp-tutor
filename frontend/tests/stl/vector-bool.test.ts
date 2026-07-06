import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { parseTraceJson } from "../../src/api/client";
import type { ExecPoint, Trace } from "../../src/types/trace";
// Import as raw text and parse through parseTraceJson: vector<bool> packs its
// bits into 64-bit _Bit_type words that exceed Number.MAX_SAFE_INTEGER, so a
// plain JSON import would corrupt them exactly as fetch().json() would.
import raw from "../fixtures/stl/vector-bool.json?raw";

const fixture = parseTraceJson(raw) as Trace;

// First step at line 9: all three vectors are constructed and the heap word
// buffers are populated. (The trace revisits line 9 at the very end with a
// childless buffer snapshot — a tracer quirk covered by its own test below.)
function lastStepWithLocals(): ExecPoint {
  const steps = fixture.trace as ExecPoint[];
  return steps.find(
    (s) => s.line === 9 && (s.stack_to_render as any)?.[0]?.encoded_locals?.big,
  )!;
}

describe("vector<bool> decoder", () => {
  it("decodes a single-word vector with per-element true/false values", () => {
    const m = normalizeMemory(lastStepWithLocals());
    const test = m.frames[0].cells.find((c) => c.name === "test")!;
    expect(test.containerKind).toBe("vector");
    expect(test.length).toBe(10);
    expect(test.displayValue).toBe("vector<bool> · 10");
    const values = test.children!.map((c) => c.displayValue);
    expect(values).toEqual([
      "false", "false", "false", "true", "false",
      "false", "false", "false", "false", "false",
    ]);
    expect(test.children![0].type).toBe("bool");
  });

  it("decodes a multi-word vector spanning two _Bit_type words", () => {
    const m = normalizeMemory(lastStepWithLocals());
    const big = m.frames[0].cells.find((c) => c.name === "big")!;
    expect(big.length).toBe(70);
    const values = big.children!.map((c) => c.displayValue);
    expect(values[64]).toBe("true");
    expect(values[65]).toBe("false");
    expect(values.filter((v) => v === "false")).toEqual(["false"]);
  });

  it("decodes an empty vector<bool> as an empty container", () => {
    const m = normalizeMemory(lastStepWithLocals());
    const empty = m.frames[0].cells.find((c) => c.name === "empty_v")!;
    expect(empty.containerKind).toBe("vector");
    expect(empty.length).toBe(0);
    expect(empty.displayValue).toBe("vector<bool> · 0");
  });

  it("consumes the bit-word heap buffers so they are hidden from Heap", () => {
    const m = normalizeMemory(lastStepWithLocals());
    expect(m.heap).toEqual([]);
  });

  it("renders ? placeholders when the tracer omits the word values", () => {
    // The final line-9 step carries a childless C_ARRAY for big's buffer.
    const steps = fixture.trace as ExecPoint[];
    const step = [...steps].reverse().find(
      (s) => (s.stack_to_render as any)?.[0]?.encoded_locals?.big,
    )!;
    const m = normalizeMemory(step);
    const big = m.frames[0].cells.find((c) => c.name === "big")!;
    expect(big.length).toBe(70);
    expect(big.children![0].displayValue).toBe("?");
  });
});
