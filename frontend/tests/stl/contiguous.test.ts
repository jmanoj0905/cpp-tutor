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
  it("hides std::string internals when the backing pointer is unavailable", () => {
    const point: ExecPoint = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {}, heap: {},
      stack_to_render: [{
        unique_hash: "main_0x1", frame_id: "0x1", func_name: "main",
        ordered_varnames: ["s"],
        encoded_locals: {
          s: ["C_STRUCT", "0x20", "string",
            ["_M_dataplus", ["C_STRUCT", "0x20", "_Alloc_hider",
              ["_M_p", ["C_DATA", "0x20", "pointer", "<UNALLOCATED>"]]]]],
        },
      }] as any,
    };
    const s = normalizeMemory(point).frames[0].cells.find((c) => c.name === "s")!;
    expect(s.kind).toBe("container");
    expect(s.containerKind).toBe("string");
    expect(s.displayValue).toBe("string · ?");
    expect(s.children).toEqual([]);
  });
  it("decodes std::array elements", () => {
    const m = normalizeMemory(lastWith("a"));
    const a = m.frames[0].cells.find((c) => c.name === "a")!;
    expect(a.containerKind).toBe("array");
    expect(a.children?.map((c) => c.displayValue)).toEqual(["7", "8", "9"]);
  });
});
