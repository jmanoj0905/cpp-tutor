import { describe, it, expect } from "vitest";
import { normalizeMemory, type NormalizedCell } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";

function point(
  locals: Record<string, unknown>,
  varnames: string[],
  heap: Record<string, unknown> = {},
): ExecPoint {
  return {
    line: 1, event: "step_line", func_name: "main", stdout: "",
    ordered_globals: [], globals: {}, heap,
    stack_to_render: [{
      unique_hash: "f1", frame_id: "f1", func_name: "main",
      ordered_varnames: varnames, encoded_locals: locals,
    }],
  } as unknown as ExecPoint;
}

function data(addr: string, type: string, value: unknown): unknown[] {
  return ["C_DATA", addr, type, value];
}

function ptr(addr: string, target: string): unknown[] {
  return data(addr, "pointer", target);
}

function local(memory: ReturnType<typeof normalizeMemory>, name: string): NormalizedCell {
  const found = memory.frames[0].cells.find((c) => c.name === name);
  expect(found).toBeDefined();
  return found!;
}

function values(cell: NormalizedCell): string[] {
  return (cell.children ?? []).map((c) => c.displayValue);
}

function pairPayload(addr: string, key: number, value: number): unknown[] {
  const base = Number.parseInt(addr, 16);
  return ["C_STRUCT", addr, "pair<int const, int>",
    ["first", data(addr, "int", key)],
    ["second", data(`0x${(base + 4).toString(16)}`, "int", value)],
  ];
}

function forwardListPoint(items: number[]): ExecPoint {
  const nodeAddrs = items.map((_, i) => `0x${(0xf100 + i * 0x20).toString(16)}`);
  const heap: Record<string, unknown> = {};
  items.forEach((value, i) => {
    const addr = nodeAddrs[i];
    const next = nodeAddrs[i + 1] ?? "0x0";
    heap[addr] = ["C_ARRAY", addr,
      ["C_STRUCT", addr, "std::_Fwd_list_node<int>",
        ["_M_next", ptr(addr, next)],
        ["_M_storage", data(`0x${(Number.parseInt(addr, 16) + 8).toString(16)}`, "int", value)]],
    ];
  });

  return point({
    fl: ["C_STRUCT", "0x50", "forward_list<int, std::allocator<int> >",
      ["_M_head", ["C_STRUCT", "0x50", "_Fwd_list_node_base",
        ["_M_next", ptr("0x50", nodeAddrs[0] ?? "0x0")]]]],
  }, ["fl"], heap);
}

interface TreeNode {
  addr: string;
  left?: string;
  right?: string;
  payload: unknown[];
}

function treePoint(name: string, type: string, nodes: TreeNode[], root: string): ExecPoint {
  const heap: Record<string, unknown> = {};
  for (const node of nodes) {
    heap[node.addr] = ["C_ARRAY", node.addr,
      ["C_STRUCT", node.addr, "std::_Rb_tree_node",
        ["_M_color", data(node.addr, "_Rb_tree_color", 1)],
        ["_M_parent", ptr(`0x${(Number.parseInt(node.addr, 16) + 8).toString(16)}`, "0x0")],
        ["_M_left", ptr(`0x${(Number.parseInt(node.addr, 16) + 16).toString(16)}`, node.left ?? "0x0")],
        ["_M_right", ptr(`0x${(Number.parseInt(node.addr, 16) + 24).toString(16)}`, node.right ?? "0x0")],
        ["_M_value_field", node.payload]],
    ];
  }

  return point({
    [name]: ["C_STRUCT", "0x70", type,
      ["_M_header", ["C_STRUCT", "0x78", "_Rb_tree_node_base",
        ["_M_parent", ptr("0x80", root)],
        ["_M_left", ptr("0x88", nodes[0]?.addr ?? "0x0")],
        ["_M_right", ptr("0x90", nodes[nodes.length - 1]?.addr ?? "0x0")]]],
      ["_M_node_count", data("0x98", "size_type", nodes.length)]],
  }, [name], heap);
}

function setTreePoint(name: string, type: string, vals: [number, number, number]): ExecPoint {
  const [left, root, right] = vals;
  return treePoint(name, type, [
    { addr: "0xa100", payload: data("0xa120", "int", left) },
    { addr: "0xa200", left: "0xa100", right: "0xa300", payload: data("0xa220", "int", root) },
    { addr: "0xa300", payload: data("0xa320", "int", right) },
  ], "0xa200");
}

function mapTreePoint(name: string, type: string, entries: [[number, number], [number, number]]): ExecPoint {
  return treePoint(name, type, [
    { addr: "0xb100", payload: pairPayload("0xb120", entries[0][0], entries[0][1]) },
    { addr: "0xb200", left: "0xb100", payload: pairPayload("0xb220", entries[1][0], entries[1][1]) },
  ], "0xb200");
}

function hashPoint(name: string, type: string, payloads: unknown[]): ExecPoint {
  const nodeAddrs = payloads.map((_, i) => `0x${(0xc100 + i * 0x20).toString(16)}`);
  const heap: Record<string, unknown> = {
    "0xc000": ["C_ARRAY", "0xc000",
      ...nodeAddrs.map((addr, i) => data(`0x${(0xc000 + i * 8).toString(16)}`, "pointer", ["REF", addr])),
    ],
  };
  payloads.forEach((payload, i) => {
    const addr = nodeAddrs[i];
    heap[addr] = ["C_ARRAY", addr,
      ["C_STRUCT", addr, "std::__detail::_Hash_node",
        ["_M_nxt", ptr(addr, nodeAddrs[i + 1] ?? "0x0")],
        ["_M_v", payload]],
    ];
  });

  const table = ["C_STRUCT", "0xc8", "_Hashtable",
    ["_M_buckets", ptr("0xc8", "0xc000")],
    ["_M_bbegin", ["C_STRUCT", "0xd0", "__before_begin",
      ["_M_node", ["C_STRUCT", "0xd0", "_Hash_node_base",
        ["_M_nxt", ptr("0xd0", nodeAddrs[0] ?? "0x0")]]]]],
    ["_M_element_count", data("0xd8", "size_type", payloads.length)],
  ];

  return point({
    [name]: ["C_STRUCT", "0xc8", type, ["_M_h", table]],
  }, [name], heap);
}

describe("node payload frontend decode", () => {
  it("recovers forward_list payloads in chain order", () => {
    const memory = normalizeMemory(forwardListPoint([4, 5, 6]));
    const fl = local(memory, "fl");
    expect(fl.containerKind).toBe("forward_list");
    expect(fl.placeholders).toBeFalsy();
    expect(fl.displayValue).toBe("forward_list<int> · 3");
    expect(values(fl)).toEqual(["4", "5", "6"]);
    expect(memory.heap).toEqual([]);
  });

  it("recovers set and multiset payloads in tree order", () => {
    const setType = "set<int, std::less<int>, std::allocator<int> >";
    const s = local(normalizeMemory(setTreePoint("s", setType, [1, 2, 3])), "s");
    expect(s.containerKind).toBe("set");
    expect(s.placeholders).toBeFalsy();
    expect(values(s)).toEqual(["1", "2", "3"]);

    const multisetType = "multiset<int, std::less<int>, std::allocator<int> >";
    const ms = local(normalizeMemory(setTreePoint("ms", multisetType, [1, 1, 2])), "ms");
    expect(ms.containerKind).toBe("multiset");
    expect(ms.placeholders).toBeFalsy();
    expect(values(ms)).toEqual(["1", "1", "2"]);
  });

  it("recovers map and multimap key/value payloads in tree order", () => {
    const mapType = "map<int, int, std::less<int>, std::allocator<std::pair<int const, int> > >";
    const m = local(normalizeMemory(mapTreePoint("m", mapType, [[1, 10], [2, 20]])), "m");
    expect(m.containerKind).toBe("map");
    expect(m.placeholders).toBeFalsy();
    expect((m.children ?? []).map((row) => (row.children ?? []).map((c) => c.displayValue))).toEqual([
      ["1", "10"],
      ["2", "20"],
    ]);

    const multimapType = "multimap<int, int, std::less<int>, std::allocator<std::pair<int const, int> > >";
    const mm = local(normalizeMemory(mapTreePoint("mm", multimapType, [[1, 10], [1, 11]])), "mm");
    expect(mm.containerKind).toBe("multimap");
    expect((mm.children ?? []).map((row) => (row.children ?? []).map((c) => c.displayValue))).toEqual([
      ["1", "10"],
      ["1", "11"],
    ]);
  });

  it("recovers unordered set-family payloads in flat chain order", () => {
    const usType = "unordered_set<int, std::hash<int>, std::equal_to<int>, std::allocator<int> >";
    const us = local(normalizeMemory(hashPoint("us", usType, [
      data("0xc108", "int", 8),
      data("0xc128", "int", 7),
    ])), "us");
    expect(us.containerKind).toBe("unordered_set");
    expect(us.placeholders).toBeFalsy();
    expect(values(us)).toEqual(["8", "7"]);

    const umsType = "unordered_multiset<int, std::hash<int>, std::equal_to<int>, std::allocator<int> >";
    const ums = local(normalizeMemory(hashPoint("ums", umsType, [
      data("0xc108", "int", 7),
      data("0xc128", "int", 7),
    ])), "ums");
    expect(ums.containerKind).toBe("unordered_multiset");
    expect(values(ums)).toEqual(["7", "7"]);
  });

  it("recovers unordered map-family payloads in flat chain order", () => {
    const umType = "unordered_map<int, int, std::hash<int>, std::equal_to<int>, std::allocator<std::pair<int const, int> > >";
    const um = local(normalizeMemory(hashPoint("um", umType, [
      pairPayload("0xc108", 2, 200),
      pairPayload("0xc128", 1, 100),
    ])), "um");
    expect(um.containerKind).toBe("unordered_map");
    expect((um.children ?? []).map((row) => (row.children ?? []).map((c) => c.displayValue))).toEqual([
      ["2", "200"],
      ["1", "100"],
    ]);

    const ummType = "unordered_multimap<int, int, std::hash<int>, std::equal_to<int>, std::allocator<std::pair<int const, int> > >";
    const umm = local(normalizeMemory(hashPoint("umm", ummType, [
      pairPayload("0xc108", 1, 100),
      pairPayload("0xc128", 1, 101),
    ])), "umm");
    expect(umm.containerKind).toBe("unordered_multimap");
    expect((umm.children ?? []).map((row) => (row.children ?? []).map((c) => c.displayValue))).toEqual([
      ["1", "100"],
      ["1", "101"],
    ]);
  });
});
