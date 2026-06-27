import { describe, expect, it } from "vitest";
import { decodeMemoryValue, normalizeMemory } from "../src/viz/memoryModel";
import type { ExecPoint } from "../src/types/trace";
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
    const steps = (vectorTrace as any).trace as ExecPoint[];
    const memory = normalizeMemory(steps[steps.length - 1]);
    const v = memory.frames[0].cells.find((c) => c.name === "v")!;
    expect(v.kind).toBe("vector");
    expect(v.length).toBe(3);
    expect(v.elementType).toBe("int");
    expect(v.children?.map((c) => c.displayValue)).toEqual(["10", "20", "30"]);
    expect(memory.heap.find((c) => c.address === "0x5000")).toBeUndefined();
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
    expect(v.kind).toBe("vector");
    expect(v.length).toBe(1);
    expect(v.children?.map((c) => c.displayValue)).toEqual(["7"]);
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
