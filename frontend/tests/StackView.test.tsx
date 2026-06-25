import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StackView } from "../src/viz/StackView";
import type { ExecPoint } from "../src/types/trace";

const point: ExecPoint = {
  line: 4, event: "step_line", func_name: "main",
  stack_to_render: [{
    func_name: "main",
    ordered_varnames: ["x", "y"],
    encoded_locals: { x: 41, y: 42 },
  }] as any,
  heap: {}, globals: {}, ordered_globals: [], stdout: "",
};

describe("StackView", () => {
  it("renders frame name and scalar locals in order", () => {
    render(<StackView point={point} />);
    expect(screen.getByText("main")).toBeDefined();
    expect(screen.getByText("x")).toBeDefined();
    expect(screen.getByText("41")).toBeDefined();
    expect(screen.getByText("42")).toBeDefined();
  });
});
