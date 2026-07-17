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

function vectorPoint(start: string, values: number[]): ExecPoint {
  const base = Number.parseInt(start, 16);
  const elems = values.map((value, i) => ["C_DATA", `0x${(base + i * 4).toString(16)}`, "int", value]);
  return point({
    v: ["C_STRUCT", "0x10", "std::vector<int>",
      ["_M_start", ["C_DATA", "0x10", "int*", start]],
      ["_M_finish", ["C_DATA", "0x18", "int*", `0x${(base + values.length * 4).toString(16)}`]]],
  }, ["v"], {
    [start]: ["C_ARRAY", start, ...elems],
  });
}

function stringPoint(text: string): ExecPoint {
  const chars = [...text].map((ch, i) => ["C_DATA", `0x${(0x9000 + i).toString(16)}`, "char", ch.charCodeAt(0)]);
  return point({
    s: ["C_STRUCT", "0x20", "std::string",
      ["_M_p", ["C_DATA", "0x20", "char*", "0x9000"]]],
  }, ["s"], {
    "0x9000": ["C_ARRAY", "0x9000", ...chars, ["C_DATA", `0x${(0x9000 + chars.length).toString(16)}`, "char", 0]],
  });
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

  it("marks only the changed std::vector element, even when the heap buffer moves", () => {
    const prev = normalizeMemory(vectorPoint("0x9000", [1, 2, 3]));
    const curr = normalizeMemory(vectorPoint("0xa000", [1, 9, 3]));
    expect(changedCellIds(prev, curr)).toEqual(new Set(["stack-f1-v-1"]));
  });

  it("marks only the changed std::array element", () => {
    const mk = (middle: number) => normalizeMemory(point({
      a: ["C_STRUCT", "0x30", "std::array<int, 3>",
        ["_M_elems", ["C_ARRAY", "0x30",
          ["C_DATA", "0x30", "int", 1],
          ["C_DATA", "0x34", "int", middle],
          ["C_DATA", "0x38", "int", 3]]]],
    }, ["a"]));
    expect(changedCellIds(mk(2), mk(9))).toEqual(new Set(["stack-f1-a-1"]));
  });

  it("marks only the changed std::pair member", () => {
    const mk = (second: number) => normalizeMemory(point({
      pr: ["C_STRUCT", "0x40", "std::pair<int, int>",
        ["first", ["C_DATA", "0x40", "int", 1]],
        ["second", ["C_DATA", "0x44", "int", second]]],
    }, ["pr"]));
    expect(changedCellIds(mk(2), mk(9))).toEqual(new Set(["stack-f1-pr-second"]));
  });

  it("marks only the changed std::string character", () => {
    const prev = normalizeMemory(stringPoint("abc"));
    const curr = normalizeMemory(stringPoint("axc"));
    expect(changedCellIds(prev, curr)).toEqual(new Set(["stack-f1-s-1"]));
  });

  it("marks only the changed std::bitset bit", () => {
    const mk = (word: number) => normalizeMemory(point({
      bs: ["C_STRUCT", "0x50", "std::bitset<4ul>",
        ["_M_w", ["C_DATA", "0x50", "unsigned long", word]]],
    }, ["bs"]));
    expect(changedCellIds(mk(5), mk(7))).toEqual(new Set(["stack-f1-bs-2"]));
  });

  it("marks a changed heap cell", () => {
    const mk = (v: number) =>
      normalizeMemory(point({}, [], { "0x100": ["C_DATA", "0x100", "int", v] }));
    expect(changedCellIds(mk(7), mk(8))).toEqual(new Set(["heap-heap-0x100"]));
  });
});
