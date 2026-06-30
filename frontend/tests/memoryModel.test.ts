import { describe, expect, it } from "vitest";
import { decodeMemoryValue, normalizeMemory, gridShape } from "../src/viz/memoryModel";
import type { ExecPoint } from "../src/types/trace";
import type { NormalizedCell } from "../src/viz/memoryModel";
import vectorTrace from "./fixtures/vector-trace.json";

const point: ExecPoint = {
  line: 6,
  event: "step_line",
  func_name: "main",
  stdout: "",
  ordered_globals: ["gp"],
  globals: {
    gp: ["C_DATA", "0x30", "int *", ["REF", "0x100"]],
  },
  heap: {
    "0x100": ["C_DATA", "0x100", "int", 7],
  },
  stack_to_render: [
    {
      unique_hash: "main_0x1",
      frame_id: "0x1",
      func_name: "main",
      ordered_varnames: ["x", "p", "missing", "items"],
      encoded_locals: {
        x: ["C_DATA", "0x10", "int", 41],
        p: ["C_DATA", "0x18", "int *", ["REF", "0x100"]],
        missing: ["REF", "0x999"],
        items: [
          "C_ARRAY",
          "0x40",
          ["C_DATA", "0x40", "int", 1],
          ["C_DATA", "0x44", "int", 2],
        ],
      },
    },
  ],
};

describe("memoryModel", () => {
  it("decodes scalar C_DATA values", () => {
    expect(decodeMemoryValue(["C_DATA", "0x10", "int", 41], "x", "stack", "frame-1")).toMatchObject({
      name: "x",
      source: "stack",
      kind: "scalar",
      address: "0x10",
      type: "int",
      displayValue: "41",
    });
  });

  it("decodes C_DATA references and bare REF values", () => {
    expect(decodeMemoryValue(["C_DATA", "0x18", "int *", ["REF", "0x100"]], "p", "stack", "frame-1")).toMatchObject({
      kind: "reference",
      displayValue: "-> 0x100",
      targetAddress: "0x100",
    });

    expect(decodeMemoryValue(["REF", "0x999"], "missing", "stack", "frame-1")).toMatchObject({
      kind: "reference",
      displayValue: "-> 0x999",
      targetAddress: "0x999",
    });
  });

  it("decodes arrays recursively with indexed children", () => {
    const cell = decodeMemoryValue(
      ["C_ARRAY", "0x40", ["C_DATA", "0x40", "int", 1], ["C_DATA", "0x44", "int", 2]],
      "items", "stack", "frame-1",
    );
    expect(cell).toMatchObject({ kind: "array", address: "0x40", length: 2, displayValue: "int[2]" });
    expect(cell.children?.map((c) => [c.name, c.displayValue])).toEqual([["[0]", "1"], ["[1]", "2"]]);
  });

  it("decodes structs recursively with named member children", () => {
    const cell = decodeMemoryValue(
      ["C_STRUCT", "0x50", "Point", ["x", ["C_DATA", "0x50", "int", 3]], ["y", ["C_DATA", "0x54", "int", 4]]],
      "pt", "stack", "frame-1",
    );
    expect(cell).toMatchObject({ kind: "struct", address: "0x50", type: "Point", displayValue: "Point" });
    expect(cell.children?.map((c) => [c.name, c.displayValue])).toEqual([["x", "3"], ["y", "4"]]);
  });

  it("derives links from nested struct members and heap-to-heap", () => {
    const nestedPoint: ExecPoint = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {},
      heap: {
        "0xA0": ["C_STRUCT", "0xA0", "Node",
          ["next", ["C_DATA", "0xA8", "Node *", ["REF", "0xB0"]]]],
        "0xB0": ["C_DATA", "0xB0", "int", 9],
      },
      stack_to_render: [{
        unique_hash: "main_0x1", frame_id: "0x1", func_name: "main",
        ordered_varnames: ["root"],
        encoded_locals: {
          root: ["C_STRUCT", "0x10", "Wrap",
            ["ptr", ["C_DATA", "0x10", "Node *", ["REF", "0xA0"]]]],
        },
      }] as any,
    };
    const memory = normalizeMemory(nestedPoint);
    const targets = memory.links.map((l) => [l.fromName, l.targetAddress]);
    expect(targets).toContainEqual(["ptr", "0xA0"]);
    expect(targets).toContainEqual(["next", "0xB0"]);
  });

  it("decodes std::vector with size from pointer arithmetic and inlined elements", () => {
    // Real trace captured from the patched Valgrind backend. The last step
    // where `v` is still in scope holds all three pushed elements.
    const steps = (vectorTrace as any).trace as ExecPoint[];
    const step = [...steps].reverse().find(
      (s) => (s.stack_to_render as any)?.[0]?.encoded_locals?.v,
    )!;
    const memory = normalizeMemory(step);
    const v = memory.frames[0].cells.find((c) => c.name === "v")!;
    expect(v.kind).toBe("container");
    expect(v.containerKind).toBe("vector");
    expect(v.length).toBe(3);
    expect(v.elementType).toBe("int");
    expect(v.children?.map((c) => c.displayValue)).toEqual(["10", "20", "30"]);
    // The heap element buffer was inlined into the vector and removed from the
    // standalone heap section.
    expect(memory.heap).toHaveLength(0);
  });

  it("computes vector size from buffer length when arithmetic is unavailable", () => {
    const point: ExecPoint = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {},
      heap: { "0x9000": ["C_ARRAY", "0x9000", ["C_DATA", "0x9000", "int", 7]] },
      stack_to_render: [{
        unique_hash: "main_0x1", frame_id: "0x1", func_name: "main",
        ordered_varnames: ["v"],
        encoded_locals: {
          v: ["C_STRUCT", "0x10", "std::vector<int>",
            ["_M_start",  ["C_DATA", "0x10", "pointer", ["REF", "0x9000"]]],
            ["_M_finish", ["C_DATA", "0x18", "pointer", ["REF", "0x9004"]]]],
        },
      }] as any,
    };
    const v = normalizeMemory(point).frames[0].cells.find((c) => c.name === "v")!;
    expect(v.kind).toBe("container");
    expect(v.containerKind).toBe("vector");
    expect(v.length).toBe(1);
    expect(v.children?.map((c) => c.displayValue)).toEqual(["7"]);
  });

  it("resolves pointers to stack/global variables (real-backend shape), not just heap", () => {
    const pt: ExecPoint = {
      line: 3, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: ["g"],
      globals: { g: ["C_DATA", "0x600", "int", 99] },
      heap: {},
      stack_to_render: [{
        unique_hash: "main_0x1", frame_id: "0x1", func_name: "main",
        ordered_varnames: ["a", "p", "pg"],
        encoded_locals: {
          a: ["C_DATA", "0xFFF000B38", "int", 7],
          p: ["C_DATA", "0xFFF000B40", "pointer", "0xFFF000B38"],
          pg: ["C_DATA", "0xFFF000B48", "pointer", "0x600"],
        },
      }] as any,
    };
    const memory = normalizeMemory(pt);
    const a = memory.frames[0].cells.find((c) => c.name === "a")!;
    const p = memory.frames[0].cells.find((c) => c.name === "p")!;
    const pg = memory.frames[0].cells.find((c) => c.name === "pg")!;
    const g = memory.globals.find((c) => c.name === "g")!;

    expect(p).toMatchObject({ kind: "reference", unresolved: false, targetAddress: "0xFFF000B38" });
    expect(p.targetId).toBe(a.id);
    expect(pg.targetId).toBe(g.id);
    expect(memory.links.map((l) => [l.fromName, l.targetAddress])).toEqual([
      ["p", "0xFFF000B38"],
      ["pg", "0x600"],
    ]);
  });

  it("normalizes stack frames, globals, heap entries, resolved links, and unresolved references", () => {
    const memory = normalizeMemory(point);

    expect(memory.globals.map((cell) => cell.name)).toEqual(["gp"]);
    expect(memory.frames[0].name).toBe("main");
    expect(memory.frames[0].cells.map((cell) => cell.name)).toEqual(["x", "p", "missing", "items"]);
    expect(memory.heap).toHaveLength(1);
    expect(memory.heap[0]).toMatchObject({
      source: "heap",
      name: "0x100",
      address: "0x100",
      displayValue: "7",
    });

    const p = memory.frames[0].cells.find((cell) => cell.name === "p");
    const missing = memory.frames[0].cells.find((cell) => cell.name === "missing");
    const gp = memory.globals.find((cell) => cell.name === "gp");

    expect(p?.targetId).toBe(memory.heap[0].id);
    expect(gp?.targetId).toBe(memory.heap[0].id);
    expect(missing).toMatchObject({ kind: "reference", unresolved: true, targetAddress: "0x999" });
    expect(memory.links.map((link) => [link.fromName, link.targetAddress])).toEqual([
      ["gp", "0x100"],
      ["p", "0x100"],
    ]);
  });
});

function gcell(p: Partial<NormalizedCell>): NormalizedCell {
  return { id: "id", name: "n", source: "stack", kind: "scalar", address: null, type: null, displayValue: "", rawValue: null, ...p };
}

function row(id: string, vals: string[]): NormalizedCell {
  return gcell({
    id, name: id, kind: "container", containerKind: "vector",
    children: vals.map((v, i) => gcell({ id: `${id}-${i}`, name: `[${i}]`, displayValue: v })),
  });
}

describe("gridShape", () => {
  it("returns rows×cols for a rectangular 2D container", () => {
    const m = gcell({ id: "m", kind: "container", containerKind: "vector",
      children: [row("r0", ["1", "2", "3"]), row("r1", ["4", "5", "6"])] });
    expect(gridShape(m)).toEqual({ rows: 2, cols: 3 });
  });
  it("returns null for a jagged 2D container", () => {
    const m = gcell({ id: "m", kind: "container",
      children: [row("r0", ["1", "2"]), row("r1", ["3", "4", "5"])] });
    expect(gridShape(m)).toBeNull();
  });
  it("returns null for a 1D container (children have no children)", () => {
    expect(gridShape(row("r0", ["1", "2", "3"]))).toBeNull();
  });
  it("returns null for fewer than 2 rows", () => {
    const m = gcell({ id: "m", kind: "container", children: [row("r0", ["1", "2"])] });
    expect(gridShape(m)).toBeNull();
  });
  it("returns null when the cell is not array/container", () => {
    const s = gcell({ id: "s", kind: "struct", children: [row("r0", ["1"]), row("r1", ["2"])] });
    expect(gridShape(s)).toBeNull();
  });
  it("returns the outer shape for a 3D container (inner recurses)", () => {
    const inner = (id: string) => gcell({ id, kind: "container", children: [row(`${id}a`, ["1", "2"]), row(`${id}b`, ["3", "4"])] });
    const m = gcell({ id: "m", kind: "container", children: [inner("x"), inner("y")] });
    expect(gridShape(m)).toEqual({ rows: 2, cols: 2 });
  });
});
