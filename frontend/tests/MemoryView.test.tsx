import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryCell } from "../src/viz/MemoryCell";
import type { NormalizedCell } from "../src/viz/memoryModel";

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
});
