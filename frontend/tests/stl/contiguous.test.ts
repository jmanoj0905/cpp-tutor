import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";
import fixture from "../fixtures/stl/string-array.json";

function lastWith(name: string): ExecPoint {
  const steps = (fixture as any).trace as ExecPoint[];
  return [...steps].reverse().find(
    (s) => (s.stack_to_render as any)?.[0]?.encoded_locals?.[name],
  )!;
}

describe("contiguous decoders", () => {
  it("decodes std::string contents", () => {
    const m = normalizeMemory(lastWith("s"));
    const s = m.frames[0].cells.find((c) => c.name === "s")!;
    expect(s.kind).toBe("container");
    expect(s.containerKind).toBe("string");
    expect(s.displayValue).toContain("hello world");
  });
  it("decodes std::array elements", () => {
    const m = normalizeMemory(lastWith("a"));
    const a = m.frames[0].cells.find((c) => c.name === "a")!;
    expect(a.containerKind).toBe("array");
    expect(a.children?.map((c) => c.displayValue)).toEqual(["7", "8", "9"]);
  });
});
