import { describe, it, expect } from "vitest";
import { changedCellIds } from "../src/viz/memoryDiff";
import { normalizeMemory } from "../src/viz/memoryModel";
import type { ExecPoint } from "../src/types/trace";

function point(locals: Record<string, unknown>, varnames: string[], heap: Record<string, unknown> = {}): ExecPoint {
  return {
    line: 1, event: "step_line", func_name: "main", stdout: "",
    ordered_globals: [], globals: {}, heap,
    stack_to_render: [{
      unique_hash: "f1", frame_id: "f1", func_name: "main",
      ordered_varnames: varnames, encoded_locals: locals,
    }],
  } as unknown as ExecPoint;
}

describe("changedCellIds", () => {
  it("returns the id of a scalar whose value changed", () => {
    const prev = normalizeMemory(point({ x: ["C_DATA", "0x10", "int", 1] }, ["x"]));
    const curr = normalizeMemory(point({ x: ["C_DATA", "0x10", "int", 2] }, ["x"]));
    expect(changedCellIds(prev, curr)).toEqual(new Set(["stack-f1-x"]));
  });

  it("returns nothing when values are unchanged", () => {
    const prev = normalizeMemory(point({ x: ["C_DATA", "0x10", "int", 1] }, ["x"]));
    const curr = normalizeMemory(point({ x: ["C_DATA", "0x10", "int", 1] }, ["x"]));
    expect(changedCellIds(prev, curr).size).toBe(0);
  });

  it("returns an empty set when prev is null (first step)", () => {
    const curr = normalizeMemory(point({ x: ["C_DATA", "0x10", "int", 1] }, ["x"]));
    expect(changedCellIds(null, curr).size).toBe(0);
  });

  it("marks a cell that newly appeared", () => {
    const prev = normalizeMemory(point({ x: ["C_DATA", "0x10", "int", 1] }, ["x"]));
    const curr = normalizeMemory(point(
      { x: ["C_DATA", "0x10", "int", 1], y: ["C_DATA", "0x14", "int", 9] },
      ["x", "y"],
    ));
    expect(changedCellIds(prev, curr)).toEqual(new Set(["stack-f1-y"]));
  });

  it("marks only the changed child of a struct, not the parent", () => {
    const mk = (a: number) =>
      normalizeMemory(point({
        s: ["C_STRUCT", "0x20", "Point",
          ["a", ["C_DATA", "0x20", "int", a]],
          ["b", ["C_DATA", "0x24", "int", 5]]],
      }, ["s"]));
    const ids = changedCellIds(mk(1), mk(2));
    expect(ids.has("stack-f1-s-a")).toBe(true);
    expect(ids.has("stack-f1-s-b")).toBe(false);
    expect(ids.has("stack-f1-s")).toBe(false);
  });

  it("marks a changed heap cell", () => {
    const mk = (v: number) =>
      normalizeMemory(point({}, [], { "0x100": ["C_DATA", "0x100", "int", v] }));
    expect(changedCellIds(mk(7), mk(8))).toEqual(new Set(["heap-heap-0x100"]));
  });
});
