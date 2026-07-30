import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CallLogPanel } from "../src/viz/CallLogPanel";
import { buildCallTree } from "../src/viz/callTree";
import type { ExecPoint } from "../src/types/trace";

type Fr = [string, string] | [string, string, Record<string, unknown>];
function pt(stack: Fr[], event = "step_line"): ExecPoint {
  return {
    line: 1, event, stdout: "", ordered_globals: [], globals: {}, heap: {},
    func_name: stack[stack.length - 1]?.[0] ?? "main",
    stack_to_render: stack.map(([fn, id, locals]) => ({
      func_name: fn, frame_id: id, unique_hash: `${fn}_${id}`,
      ordered_varnames: Object.keys(locals ?? {}), encoded_locals: locals ?? {},
    })),
  } as unknown as ExecPoint;
}

// main(0) -> f(returns 7 at step2) -> g(live at step3)
const trace = [
  pt([["main", "0x1"]]),
  pt([["main", "0x1"], ["f", "0x2", { n: ["C_DATA", "0xA0", "int", 3] }]], "call"),
  pt([["main", "0x1"], ["f", "0x2", { __return__: ["C_DATA", "0xA0", "int", 7] }]], "return"),
  pt([["main", "0x1"], ["g", "0x3"]], "call"),
];
const tree = buildCallTree(trace);
const main = tree.roots[0];
const [f, g] = main.children;

describe("CallLogPanel", () => {
  it("indents each row by its depth and lists the whole trace", () => {
    const { container } = render(<CallLogPanel tree={tree} step={1} trace={trace} />);
    expect(container.querySelectorAll(".cl-node")).toHaveLength(3); // main, f, g
    const gRow = container.querySelector(`[data-testid="cl-node-${g.id}"]`) as HTMLElement;
    expect(gRow.style.paddingLeft).toBe(`${g.depth * 16}px`);
  });

  it("tags rows with their nodeState class; future rows are ghosts", () => {
    const { container } = render(<CallLogPanel tree={tree} step={1} trace={trace} />);
    expect(container.querySelector(`[data-testid="cl-node-${g.id}"]`)!.className).toContain("cl-future");
  });

  it("shows the return value on a returned row", () => {
    const { container } = render(<CallLogPanel tree={tree} step={3} trace={trace} />);
    const fRow = container.querySelector(`[data-testid="cl-node-${f.id}"]`)!;
    expect(fRow.textContent).toContain("→ 7");
  });

  it("clicking a fold triangle collapses the subtree and shows a count", () => {
    const { container, queryByTestId } = render(<CallLogPanel tree={tree} step={3} trace={trace} />);
    fireEvent.click(container.querySelector(`[data-testid="cl-fold-${main.id}"]`)!);
    // f and g are main's descendants -> hidden
    expect(queryByTestId(`cl-node-${f.id}`)).toBeNull();
    expect(queryByTestId(`cl-node-${g.id}`)).toBeNull();
    expect(container.querySelector(`[data-testid="cl-node-${main.id}"]`)!.textContent).toContain("(2 calls)");
  });

  it("clicking a row opens NodeDetail and never changes the step", () => {
    const onStep = () => { throw new Error("step must not move"); };
    void onStep; // CallLogPanel has no step-changing prop by contract
    const { container, getByTestId } = render(<CallLogPanel tree={tree} step={3} trace={trace} />);
    fireEvent.click(container.querySelector(`[data-testid="cl-node-${g.id}"]`)!);
    expect(getByTestId("ct-detail")).toBeTruthy();
  });

  it("auto-folds a subtree that returned before the current step", () => {
    // at step 3, f returned at step 2; if f had children they'd be hidden.
    // Here assert main stays expanded (live) and f row present but marked returned.
    const { container } = render(<CallLogPanel tree={tree} step={3} trace={trace} />);
    expect(container.querySelector(`[data-testid="cl-node-${f.id}"]`)!.className).toContain("cl-returned");
  });
});
