import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryCell } from "../src/viz/MemoryCell";
import type { NormalizedCell } from "../src/viz/memoryModel";
import { MemoryView } from "../src/viz/MemoryView";
import type { ExecPoint } from "../src/types/trace";

function cell(p: Partial<NormalizedCell>): NormalizedCell {
  return { id: "id", name: "n", source: "stack", kind: "scalar", address: null, type: null, displayValue: "", rawValue: null, ...p };
}

describe("MemoryCell", () => {
  it("tags a reference cell with cell id and a port", () => {
    const { container } = render(<MemoryCell cell={cell({ id: "stack-f-p", name: "p", kind: "reference", displayValue: "-> 0x100", targetAddress: "0x100" })} />);
    expect(container.querySelector('[data-cell-id="stack-f-p"]')).not.toBeNull();
    expect(container.querySelector('[data-port-id="stack-f-p"]')).not.toBeNull();
  });

  it("renders a vector header and indexed children", () => {
    render(<MemoryCell cell={cell({ id: "v", name: "v", kind: "vector", elementType: "int", length: 2, displayValue: "vector<int> · 2",
      children: [cell({ id: "v0", name: "[0]", displayValue: "10" }), cell({ id: "v1", name: "[1]", displayValue: "20" })] })} />);
    expect(screen.getByText("vector<int> · 2")).toBeDefined();
    expect(screen.getByText("10")).toBeDefined();
    expect(screen.getByText("20")).toBeDefined();
  });

  it("renders globals, stack frames by name, and heap sections", () => {
    const point: ExecPoint = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: ["g"], globals: { g: ["C_DATA", "0x1", "int", 5] },
      heap: { "0x100": ["C_DATA", "0x100", "int", 7] },
      stack_to_render: [{ unique_hash: "main_0x1", frame_id: "0x1", func_name: "main",
        ordered_varnames: ["x"], encoded_locals: { x: ["C_DATA", "0x10", "int", 41] } }] as any,
    };
    render(<MemoryView point={point} />);
    expect(screen.getByText("Globals")).toBeDefined();
    expect(screen.getByText("main")).toBeDefined();
    expect(screen.getByText("Heap")).toBeDefined();
    expect(screen.getByText("41")).toBeDefined();
  });

  it("renders a container cell with its summary and elements", () => {
    const point = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {},
      heap: { "0x9000": ["C_ARRAY", "0x9000",
        ["C_DATA", "0x9000", "int", 7], ["C_DATA", "0x9004", "int", 8]] },
      stack_to_render: [{
        unique_hash: "main_0x1", frame_id: "0x1", func_name: "main",
        ordered_varnames: ["v"],
        encoded_locals: { v: ["C_STRUCT", "0x10", "std::vector<int>",
          ["_M_start",  ["C_DATA", "0x10", "pointer", ["REF", "0x9000"]]],
          ["_M_finish", ["C_DATA", "0x18", "pointer", ["REF", "0x9008"]]]] },
      }],
    } as any;
    const { container } = render(<MemoryView point={point} />);
    expect(container.querySelector(".cell-container")).toBeTruthy();
    expect(container.textContent).toContain("vector<int>");
  });

  it("renders a stack pane and a heap pane side by side", () => {
    const point = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {},
      heap: { "0x100": ["C_DATA", "0x100", "int", 7] },
      stack_to_render: [{
        unique_hash: "main_0x1", frame_id: "0x1", func_name: "main",
        ordered_varnames: ["p"],
        encoded_locals: { p: ["C_DATA", "0x18", "int *", ["REF", "0x100"]] },
      }],
    } as any;
    const { container } = render(<MemoryView point={point} />);
    expect(container.querySelector(".stack-pane")).toBeTruthy();
    expect(container.querySelector(".heap-pane")).toBeTruthy();
  });
});
