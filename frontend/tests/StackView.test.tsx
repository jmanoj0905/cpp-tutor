import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StackView } from "../src/viz/StackView";
import type { ExecPoint } from "../src/types/trace";

// Real OPT backend format: scalars encoded as ["C_DATA", addr, type, value]
const point: ExecPoint = {
  line: 4, event: "step_line", func_name: "main",
  stack_to_render: [{
    func_name: "main",
    ordered_varnames: ["x", "y"],
    encoded_locals: {
      x: ["C_DATA", "0x1", "int", 41],
      y: ["C_DATA", "0x2", "int", 42],
    },
  }] as any,
  heap: {}, globals: {}, ordered_globals: [], stdout: "",
};

// Second frame covering uninitialized, non-scalar (pointer), and bare REF
const point2: ExecPoint = {
  line: 8, event: "step_line", func_name: "main",
  stack_to_render: [{
    func_name: "main",
    ordered_varnames: ["u", "p", "r"],
    encoded_locals: {
      u: ["C_DATA", "0x3", "int", "<UNINITIALIZED>"],
      p: ["C_DATA", "0x4", "int *", ["REF", 5]],   // non-scalar 4th element → "…"
      r: ["REF", 5],                                // bare REF → "…"
    },
  }] as any,
  heap: {}, globals: {}, ordered_globals: [], stdout: "",
};

describe("StackView", () => {
  it("renders frame name and scalar C_DATA locals in order", () => {
    render(<StackView point={point} />);
    expect(screen.getByText("main")).toBeDefined();
    expect(screen.getByText("x")).toBeDefined();
    expect(screen.getByText("y")).toBeDefined();
    expect(screen.getByText("41")).toBeDefined();
    expect(screen.getByText("42")).toBeDefined();
  });

  it("renders <UNINITIALIZED> for uninitialized scalar C_DATA", () => {
    render(<StackView point={point2} />);
    expect(screen.getByText("<UNINITIALIZED>")).toBeDefined();
  });

  it("renders '…' for non-scalar C_DATA (pointer/struct) and bare REF", () => {
    render(<StackView point={point2} />);
    // both p and r should render as "…" — getAllByText since there are two
    const ellipses = screen.getAllByText("…");
    expect(ellipses.length).toBeGreaterThanOrEqual(2);
  });
});
