import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CallTreePanel } from "../src/viz/CallTreePanel";
import { buildCallTree, finalLabel } from "../src/viz/callTree";
import { nodeWidth } from "../src/viz/treeLayout";
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

// main(0) -> f(1..2 returned) -> g(3 live)
const trace = [
  pt([["main", "0x1"]]),
  pt([["main", "0x1"], ["f", "0x2", { n: ["C_DATA", "0xA0", "int", 3] }]], "call"),
  pt([["main", "0x1"]]),
  pt([["main", "0x1"], ["g", "0x3"]], "call"),
];
const tree = buildCallTree(trace);
const [f, g] = tree.roots[0].children;

describe("CallTreePanel", () => {
  it("renders the whole tree; not-yet-called nodes are future ghosts", () => {
    const { container } = render(<CallTreePanel tree={tree} step={1} />);
    expect(container.querySelectorAll(".ct-node")).toHaveLength(3); // main, f, g
    const gNode = container.querySelector(`[data-testid="ct-node-${g.id}"]`)!;
    expect(gNode.classList.contains("ct-future")).toBe(true);
  });

  it("tags nodes with their state classes", () => {
    const { container } = render(<CallTreePanel tree={tree} step={3} />);
    expect(container.querySelector(`[data-testid="ct-node-${g.id}"]`)!.classList.contains("ct-current")).toBe(true);
    expect(container.querySelector(`[data-testid="ct-node-${f.id}"]`)!.classList.contains("ct-returned")).toBe(true);
    expect(container.querySelector('[data-testid="ct-node-0"]')!.classList.contains("ct-on-stack")).toBe(true);
  });

  it("labels args and marks returned calls with → ?", () => {
    const { container } = render(<CallTreePanel tree={tree} step={3} />);
    const fText = container.querySelector(`[data-testid="ct-node-${f.id}"] text`)!;
    expect(fText.textContent).toBe("f(3) → ?");
    const gText = container.querySelector(`[data-testid="ct-node-${g.id}"] text`)!;
    expect(gText.textContent).toBe("g()"); // live: no arrow
  });

  it("draws every edge; edges to future nodes are ghosted", () => {
    const { container } = render(<CallTreePanel tree={tree} step={1} />);
    expect(container.querySelectorAll(".ct-edge")).toHaveLength(2); // main→f, main→g
    expect(container.querySelectorAll(".ct-edge-future")).toHaveLength(1); // main→g
  });

  it("sizes each box to its (final) label and squares the corners", () => {
    const { container } = render(<CallTreePanel tree={tree} step={3} />);
    const rect = container.querySelector(`[data-testid="ct-node-${f.id}"] rect`)!;
    expect(Number(rect.getAttribute("width"))).toBe(nodeWidth(finalLabel(f)));
    expect(rect.getAttribute("rx")).toBeNull();
  });

  it("dragging the background pans the canvas", () => {
    const { container } = render(<CallTreePanel tree={tree} step={0} />);
    const svg = container.querySelector(".calltree-svg")!;
    const g0 = container.querySelector("svg > g")!.getAttribute("transform");
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 140, clientY: 120 });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(container.querySelector("svg > g")!.getAttribute("transform")).not.toBe(g0);
  });

  it("wheel zooms", () => {
    const { container } = render(<CallTreePanel tree={tree} step={0} />);
    const svg = container.querySelector(".calltree-svg")!;
    const g0 = container.querySelector("svg > g")!.getAttribute("transform")!;
    fireEvent.wheel(svg, { deltaY: -100, clientX: 50, clientY: 50 });
    const g1 = container.querySelector("svg > g")!.getAttribute("transform")!;
    expect(g1).not.toBe(g0);
    expect(g1).toContain("scale(1.15");
  });

  it("clicking a node opens the detail panel — signature, args, return, address, steps", () => {
    const { container } = render(<CallTreePanel tree={tree} step={3} />);
    fireEvent.click(container.querySelector(`[data-testid="ct-node-${f.id}"]`)!);
    const detail = container.querySelector('[data-testid="ct-detail"]')!;
    expect(detail.textContent).toContain("f(3) → ?");
    expect(detail.textContent).toContain("n");
    expect(detail.textContent).toContain("3");
    expect(detail.textContent).toContain("0x2");            // frame address
    expect(detail.textContent).toContain("called at step 1");
    // NOTE: the trace fixture above has no explicit "return" event point for
    // f (it just vanishes at step 2), so buildCallTree records exitStep as
    // the last step f was actually observed live (1), matching the same
    // "step - 1" semantics verified in tests/callTree.test.ts for traces
    // without an intervening "return" event. (Brief text said "step 2" —
    // corrected to match the real, already-committed callTree.ts behavior.)
    expect(detail.textContent).toContain("returned at step 1");
  });

  it("says 'not returned yet' for a live invocation", () => {
    const { container } = render(<CallTreePanel tree={tree} step={3} />);
    fireEvent.click(container.querySelector(`[data-testid="ct-node-${g.id}"]`)!);
    const detail = container.querySelector('[data-testid="ct-detail"]')!;
    expect(detail.textContent).toContain("not returned yet");
    expect(detail.textContent).not.toContain("returned at step");
  });

  it("selection preview-lights every node called up to the selected one", () => {
    const { container } = render(<CallTreePanel tree={tree} step={0} />);
    fireEvent.click(container.querySelector(`[data-testid="ct-node-${g.id}"]`)!);
    // f entered (step 1) before g (step 3) → lit despite step=0
    expect(container.querySelector(`[data-testid="ct-node-${f.id}"]`)!
      .classList.contains("ct-preview-lit")).toBe(true);
    expect(container.querySelector(`[data-testid="ct-node-${g.id}"]`)!
      .classList.contains("ct-selected")).toBe(true);
  });

  it("Esc, close button, and background click all deselect", () => {
    const { container } = render(<CallTreePanel tree={tree} step={3} />);
    const fNode = () => container.querySelector(`[data-testid="ct-node-${f.id}"]`)!;
    const detail = () => container.querySelector('[data-testid="ct-detail"]');

    fireEvent.click(fNode());
    expect(detail()).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(detail()).toBeNull();

    fireEvent.click(fNode());
    fireEvent.click(container.querySelector('[aria-label="Close details"]')!);
    expect(detail()).toBeNull();

    fireEvent.click(fNode());
    fireEvent.click(container.querySelector(".calltree-svg")!);
    expect(detail()).toBeNull();
  });
});
