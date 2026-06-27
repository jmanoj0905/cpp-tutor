import { describe, expect, it } from "vitest";
import { decodeMemoryValue, normalizeMemory } from "../src/viz/memoryModel";
import type { ExecPoint } from "../src/types/trace";

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
