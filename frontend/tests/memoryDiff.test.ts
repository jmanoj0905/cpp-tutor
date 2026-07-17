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

function vectorBoolPoint(varName: string, word: number, size: number): ExecPoint {
  return point({
    [varName]: ["C_STRUCT", "0x60", "std::vector<bool, std::allocator<bool> >",
      ["_M_start", ["C_STRUCT", "0x60", "_Bit_iterator",
        ["_M_p", ["C_DATA", "0x60", "_Bit_type*", "0x9100"]],
        ["_M_offset", ["C_DATA", "0x68", "unsigned int", 0]]]],
      ["_M_finish", ["C_STRUCT", "0x70", "_Bit_iterator",
        ["_M_p", ["C_DATA", "0x70", "_Bit_type*", "0x9100"]],
        ["_M_offset", ["C_DATA", "0x78", "unsigned int", size]]]],
    ],
  }, [varName], {
    "0x9100": ["C_ARRAY", "0x9100", ["C_DATA", "0x9100", "unsigned long", word]],
  });
}

/** Raw C_STRUCT array for a single-chunk std::deque<int> living at `structAddr`,
 *  with its one chunk at `chunkAddr` holding `values`. Helper-shared by both the
 *  standalone deque test and the stack/queue adaptor tests below (adaptors wrap
 *  a deque/vector under a member named "c"). */
function dequeStruct(structAddr: string, mapAddr: string, chunkAddr: string, values: number[]): unknown[] {
  const base = Number.parseInt(chunkAddr, 16);
  const finishCur = `0x${(base + values.length * 4).toString(16)}`;
  const chunkEnd = `0x${(base + 512).toString(16)}`;
  return ["C_STRUCT", structAddr, "std::deque<int, std::allocator<int> >",
    ["_M_map", ["C_DATA", structAddr, "pointer", mapAddr]],
    ["_M_map_size", ["C_DATA", structAddr, "size_t", 8]],
    ["_M_start", ["C_STRUCT", structAddr, "iterator",
      ["_M_cur", ["C_DATA", structAddr, "pointer", chunkAddr]],
      ["_M_first", ["C_DATA", structAddr, "pointer", chunkAddr]],
      ["_M_last", ["C_DATA", structAddr, "pointer", chunkEnd]],
      ["_M_node", ["C_DATA", structAddr, "pointer", "0x2000"]]]],
    ["_M_finish", ["C_STRUCT", structAddr, "iterator",
      ["_M_cur", ["C_DATA", structAddr, "pointer", finishCur]],
      ["_M_first", ["C_DATA", structAddr, "pointer", chunkAddr]],
      ["_M_last", ["C_DATA", structAddr, "pointer", chunkEnd]],
      ["_M_node", ["C_DATA", structAddr, "pointer", "0x2000"]]]],
  ];
}

function dequePoint(mapAddr: string, chunkAddr: string, values: number[]): ExecPoint {
  return point({
    d: dequeStruct("0x80", mapAddr, chunkAddr, values) as unknown,
  }, ["d"], {
    [chunkAddr]: ["C_ARRAY", chunkAddr, ...values.map((value, i) =>
      ["C_DATA", `0x${(Number.parseInt(chunkAddr, 16) + i * 4).toString(16)}`, "int", value])],
  });
}

function vectorStruct(structAddr: string, start: string, values: number[]): unknown[] {
  const base = Number.parseInt(start, 16);
  const finish = `0x${(base + values.length * 4).toString(16)}`;
  return ["C_STRUCT", structAddr, "std::vector<int, std::allocator<int> >",
    ["_M_start", ["C_DATA", structAddr, "int*", start]],
    ["_M_finish", ["C_DATA", structAddr, "int*", finish]]];
}

function adaptorPoint(
  varName: string,
  outerType: string,
  innerStruct: unknown[],
  heapAddr: string,
  values: number[],
): ExecPoint {
  const elems = values.map((value, i) => ["C_DATA", `0x${(Number.parseInt(heapAddr, 16) + i * 4).toString(16)}`, "int", value]);
  return point({
    [varName]: ["C_STRUCT", "0x40", outerType, ["c", innerStruct]],
  }, [varName], {
    [heapAddr]: ["C_ARRAY", heapAddr, ...elems],
  });
}

/** Raw shape for one `_List_node<int>` heap chunk: a C_ARRAY holding one
 *  C_STRUCT with `_M_next`/`_M_prev` pointers plus an `_M_data` payload,
 *  matching what the patched tracer emits (see fixtures/stl/list.json). */
function listNodeChunk(addr: string, next: string, prev: string, value: number): unknown[] {
  return ["C_ARRAY", addr,
    ["C_STRUCT", addr, "std::_List_node<int>",
      ["_M_next", ["C_DATA", addr, "pointer", next]],
      ["_M_prev", ["C_DATA", addr, "pointer", prev]],
      ["_M_data", ["C_DATA", `0x${(Number.parseInt(addr, 16) + 0x10).toString(16)}`, "int", value]]],
  ];
}

/** A std::list<int> at `sentinelAddr` with real node payloads for `values`. */
function listPoint(sentinelAddr: string, values: number[]): ExecPoint {
  const nodeAddrs = values.map((_, i) => `0x${(0x9600 + i * 0x20).toString(16)}`);
  const heap: Record<string, unknown> = {};
  values.forEach((value, i) => {
    const addr = nodeAddrs[i];
    const next = i + 1 < values.length ? nodeAddrs[i + 1] : sentinelAddr;
    const prev = i > 0 ? nodeAddrs[i - 1] : sentinelAddr;
    heap[addr] = listNodeChunk(addr, next, prev, value);
  });
  const firstNode = nodeAddrs[0] ?? sentinelAddr;
  const lastNode = nodeAddrs[nodeAddrs.length - 1] ?? sentinelAddr;
  return point({
    l: ["C_STRUCT", sentinelAddr, "std::list<int, std::allocator<int> >",
      ["_M_node", ["C_STRUCT", sentinelAddr, "_List_node_base",
        ["_M_next", ["C_DATA", sentinelAddr, "pointer", firstNode]],
        ["_M_prev", ["C_DATA", sentinelAddr, "pointer", lastNode]]]]],
  }, ["l"], heap);
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
    const ids = changedCellIds(prev, curr);
    expect(ids).toEqual(new Set(["stack-f1-v-1"]));
    expect(ids.has("stack-f1-v")).toBe(false);
    expect(ids.has("stack-f1-v-0")).toBe(false);
    expect(ids.has("stack-f1-v-2")).toBe(false);
  });

  it("marks only the changed std::array element", () => {
    const mk = (middle: number) => normalizeMemory(point({
      a: ["C_STRUCT", "0x30", "std::array<int, 3>",
        ["_M_elems", ["C_ARRAY", "0x30",
          ["C_DATA", "0x30", "int", 1],
          ["C_DATA", "0x34", "int", middle],
          ["C_DATA", "0x38", "int", 3]]]],
    }, ["a"]));
    const ids = changedCellIds(mk(2), mk(9));
    expect(ids).toEqual(new Set(["stack-f1-a-1"]));
    expect(ids.has("stack-f1-a")).toBe(false);
    expect(ids.has("stack-f1-a-0")).toBe(false);
    expect(ids.has("stack-f1-a-2")).toBe(false);
  });

  it("marks only the changed std::vector<bool> bit, not the vector", () => {
    // word 0b0010 -> bits [false,true,false,false]; word 0b0110 -> bits [false,true,true,false].
    // Only bit index 2 flips.
    const mk = (word: number) => normalizeMemory(vectorBoolPoint("vb", word, 4));
    const ids = changedCellIds(mk(0b0010), mk(0b0110));
    expect(ids).toEqual(new Set(["stack-f1-vb-2"]));
    expect(ids.has("stack-f1-vb")).toBe(false);
    expect(ids.has("stack-f1-vb-0")).toBe(false);
    expect(ids.has("stack-f1-vb-1")).toBe(false);
    expect(ids.has("stack-f1-vb-3")).toBe(false);
  });

  it("marks only the changed std::deque element, even when chunk/map addresses move", () => {
    const prev = normalizeMemory(dequePoint("0x2000", "0x9200", [10, 20, 30]));
    const curr = normalizeMemory(dequePoint("0x3000", "0xb200", [10, 99, 30]));
    const ids = changedCellIds(prev, curr);
    expect(ids).toEqual(new Set(["stack-f1-d-1"]));
    expect(ids.has("stack-f1-d")).toBe(false);
    expect(ids.has("stack-f1-d-0")).toBe(false);
    expect(ids.has("stack-f1-d-2")).toBe(false);
  });

  it("marks only the changed std::stack element, re-parented under the adaptor, not the underlying deque", () => {
    const mk = (middle: number) => normalizeMemory(adaptorPoint(
      "st", "std::stack<int, std::deque<int, std::allocator<int> > >",
      dequeStruct("0x40", "0x2000", "0x9300", [1, middle, 3]),
      "0x9300", [1, middle, 3],
    ));
    const ids = changedCellIds(mk(2), mk(99));
    expect(ids).toEqual(new Set(["stack-f1-st-1"]));
    expect(ids.has("stack-f1-st")).toBe(false);
    expect(ids.has("stack-f1-st-0")).toBe(false);
    expect(ids.has("stack-f1-st-2")).toBe(false);
    expect(ids.has("stack-f1-st-c-1")).toBe(false);
  });

  it("marks only the changed std::queue element, re-parented under the adaptor, not the underlying deque", () => {
    const mk = (middle: number) => normalizeMemory(adaptorPoint(
      "q", "std::queue<int, std::deque<int, std::allocator<int> > >",
      dequeStruct("0x40", "0x2000", "0x9400", [10, middle, 30]),
      "0x9400", [10, middle, 30],
    ));
    const ids = changedCellIds(mk(20), mk(77));
    expect(ids).toEqual(new Set(["stack-f1-q-1"]));
    expect(ids.has("stack-f1-q")).toBe(false);
    expect(ids.has("stack-f1-q-0")).toBe(false);
    expect(ids.has("stack-f1-q-2")).toBe(false);
    expect(ids.has("stack-f1-q-c-1")).toBe(false);
  });

  it("marks only the changed std::priority_queue element, re-parented under the adaptor, not the underlying vector", () => {
    const mk = (middle: number) => normalizeMemory(adaptorPoint(
      "pq", "std::priority_queue<int, std::vector<int, std::allocator<int> >, std::less<int> >",
      vectorStruct("0x40", "0x9500", [9, middle, 1]),
      "0x9500", [9, middle, 1],
    ));
    const ids = changedCellIds(mk(5), mk(6));
    expect(ids).toEqual(new Set(["stack-f1-pq-1"]));
    expect(ids.has("stack-f1-pq")).toBe(false);
    expect(ids.has("stack-f1-pq-0")).toBe(false);
    expect(ids.has("stack-f1-pq-2")).toBe(false);
    expect(ids.has("stack-f1-pq-c-1")).toBe(false);
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

  it("marks only the changed std::list element, not the list itself or its siblings", () => {
    const mk = (last: number) => normalizeMemory(listPoint("0xFFF000B50", [1, 2, last]));
    const ids = changedCellIds(mk(3), mk(99));
    expect(ids).toEqual(new Set(["stack-f1-l-2"]));
    expect(ids.has("stack-f1-l")).toBe(false);
    expect(ids.has("stack-f1-l-0")).toBe(false);
    expect(ids.has("stack-f1-l-1")).toBe(false);
  });

  it("marks a changed heap cell", () => {
    const mk = (v: number) =>
      normalizeMemory(point({}, [], { "0x100": ["C_DATA", "0x100", "int", v] }));
    expect(changedCellIds(mk(7), mk(8))).toEqual(new Set(["heap-heap-0x100"]));
  });
});
