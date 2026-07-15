import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CallTreePanel } from "../src/viz/CallTreePanel";
import { buildCallTree, finalLabel } from "../src/viz/callTree";
import { nodeWidth, NODE_W } from "../src/viz/treeLayout";
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
    const { container } = render(<CallTreePanel tree={tree} step={1} onJump={() => {}} />);
    expect(container.querySelectorAll(".ct-node")).toHaveLength(3); // main, f, g
    const gNode = container.querySelector(`[data-testid="ct-node-${g.id}"]`)!;
    expect(gNode.classList.contains("ct-future")).toBe(true);
  });

  it("tags nodes with their state classes", () => {
    const { container } = render(<CallTreePanel tree={tree} step={3} onJump={() => {}} />);
    expect(container.querySelector(`[data-testid="ct-node-${g.id}"]`)!.classList.contains("ct-current")).toBe(true);
    expect(container.querySelector(`[data-testid="ct-node-${f.id}"]`)!.classList.contains("ct-returned")).toBe(true);
    expect(container.querySelector('[data-testid="ct-node-0"]')!.classList.contains("ct-on-stack")).toBe(true);
  });

  it("labels args and marks returned calls with → ?", () => {
    const { container } = render(<CallTreePanel tree={tree} step={3} onJump={() => {}} />);
    const fText = container.querySelector(`[data-testid="ct-node-${f.id}"] text`)!;
    expect(fText.textContent).toBe("f(3) → ?");
    const gText = container.querySelector(`[data-testid="ct-node-${g.id}"] text`)!;
    expect(gText.textContent).toBe("g()"); // live: no arrow
  });

  it("draws every edge; edges to future nodes are ghosted", () => {
    const { container } = render(<CallTreePanel tree={tree} step={1} onJump={() => {}} />);
    expect(container.querySelectorAll(".ct-edge")).toHaveLength(2); // main→f, main→g
    expect(container.querySelectorAll(".ct-edge-future")).toHaveLength(1); // main→g
  });

  it("sizes each box to its (final) label and squares the corners", () => {
    const { container } = render(<CallTreePanel tree={tree} step={3} onJump={() => {}} />);
    const rect = container.querySelector(`[data-testid="ct-node-${f.id}"] rect`)!;
    expect(Number(rect.getAttribute("width"))).toBe(nodeWidth(finalLabel(f)));
    expect(rect.getAttribute("rx")).toBeNull();
  });

  it("clicking a node jumps to its enterStep", () => {
    const onJump = vi.fn();
    const { container } = render(<CallTreePanel tree={tree} step={3} onJump={onJump} />);
    fireEvent.click(container.querySelector(`[data-testid="ct-node-${f.id}"]`)!);
    expect(onJump).toHaveBeenCalledWith(f.enterStep);
  });

  it("dragging the background pans the canvas", () => {
    const { container } = render(<CallTreePanel tree={tree} step={0} onJump={() => {}} />);
    const svg = container.querySelector(".calltree-svg")!;
    const g0 = container.querySelector("svg > g")!.getAttribute("transform");
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 140, clientY: 120 });
    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(container.querySelector("svg > g")!.getAttribute("transform")).not.toBe(g0);
  });

  it("wheel zooms", () => {
    const { container } = render(<CallTreePanel tree={tree} step={0} onJump={() => {}} />);
    const svg = container.querySelector(".calltree-svg")!;
    const g0 = container.querySelector("svg > g")!.getAttribute("transform")!;
    fireEvent.wheel(svg, { deltaY: -100, clientX: 50, clientY: 50 });
    const g1 = container.querySelector("svg > g")!.getAttribute("transform")!;
    expect(g1).not.toBe(g0);
    expect(g1).toContain("scale(1.15");
  });
});
