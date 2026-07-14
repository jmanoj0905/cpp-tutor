import { describe, expect, it } from "vitest";
import { buildCallTree, nodeState, type CallTreeNode } from "../src/viz/callTree";
import type { Trace } from "../src/types/trace";
import fib from "./fixtures/recursion/fib.json";
import subsets from "./fixtures/recursion/subsets.json";
import nqueens from "./fixtures/recursion/nqueens.json";
import mutual from "./fixtures/recursion/mutual.json";
import graphDfs from "./fixtures/recursion/graph-dfs.json";

const tree = (t: unknown) => buildCallTree((t as Trace).trace);

const count = (n: CallTreeNode, name: string): number =>
  (n.funcName === name ? 1 : 0) + n.children.reduce((s, c) => s + count(c, name), 0);

describe("buildCallTree on real traces", () => {
  it("fib(4): 9 fib invocations under main, recursion detected", () => {
    const t = tree(fib);
    expect(t.hasRecursion).toBe(true);
    expect(t.roots).toHaveLength(1);
    expect(t.roots[0].funcName).toBe("main");
    // fib(4) → 9 calls total: fib(4,3,2,1,0,2,1,1,0) shape
    expect(count(t.roots[0], "fib")).toBe(9);
    // top-level fib(4) has exactly two children, labels carry the argument
    const fib4 = t.roots[0].children.find((c) => c.funcName === "fib")!;
    expect(fib4.label).toBe("fib(4)");
    expect(fib4.children.map((c) => c.label)).toEqual(["fib(3)", "fib(2)"]);
  });

  it("subsets: 2^3 leaves => 15 solve invocations", () => {
    const t = tree(subsets);
    expect(count(t.roots[0], "solve")).toBe(15);
    expect(t.hasRecursion).toBe(true);
  });

  it("nqueens: place recursion with ok() helper calls interleaved", () => {
    const t = tree(nqueens);
    expect(t.hasRecursion).toBe(true);
    expect(count(t.roots[0], "place")).toBeGreaterThan(1);
    expect(count(t.roots[0], "ok")).toBeGreaterThan(4);
  });

  it("nqueens: ok() and place() labels never leak a later-scoped local or a post-return glitch value", () => {
    // Regression guard for the tracer glitch where a "return" event point
    // reports the returning frame at a shifted address with garbage locals
    // (e.g. ok's `c` holding a stack address like 4196152 instead of the
    // real 0/1), and for the loop-local `c` in `place` leaking into its
    // label once it comes into scope while place is still top-of-stack.
    const t = tree(nqueens);
    const okNodes: CallTreeNode[] = [];
    const placeNodes: CallTreeNode[] = [];
    const collect = (n: CallTreeNode) => {
      if (n.funcName === "ok") okNodes.push(n);
      if (n.funcName === "place") placeNodes.push(n);
      n.children.forEach(collect);
    };
    t.roots.forEach(collect);

    expect(okNodes.length).toBeGreaterThan(4);
    for (const n of okNodes) {
      expect(n.label).toMatch(/^ok\(\d+, \d+\)$/);
    }
    expect(okNodes.some((n) => n.label === "ok(0, 0)")).toBe(true);

    expect(placeNodes.length).toBeGreaterThan(1);
    for (const n of placeNodes) {
      expect(n.label).toMatch(/^place\(\d+\)$/);
    }
  });

  it("mutual: isEven/isOdd alternate down the chain", () => {
    const t = tree(mutual);
    expect(t.hasRecursion).toBe(true);
    const even = t.roots[0].children.find((c) => c.funcName === "isEven")!;
    expect(even.label).toBe("isEven(3)");
    expect(even.children[0].funcName).toBe("isOdd");
    expect(even.children[0].children[0].funcName).toBe("isEven");
  });

  it("graph-dfs: dfs visits all 5 vertices", () => {
    const t = tree(graphDfs);
    expect(count(t.roots[0], "dfs")).toBe(5);
  });

  it("a parent's label never absorbs a popped callee's leftover locals", () => {
    // Regression guard: the step_line right after a "return" event mislabels
    // the surviving top frame with the popped callee's func_name and leftover
    // locals (fib.json step 67: fib(0)'s leftover n under main's frame_id).
    // The label refresh must skip that bogus frame so it can never become
    // main's final label, whatever point the trace happens to end on.
    const t = tree(fib);
    expect(t.roots[0].label).toBe("main()");
  });

  it("every step has exactly one current node", () => {
    const t = tree(fib);
    const steps = (fib as unknown as Trace).trace.length;
    for (let s = 0; s < steps; s++) {
      const current = t.nodes.filter((n) => nodeState(n, s) === "current");
      expect(current, `step ${s}`).toHaveLength(1);
    }
  });

  it("enter/exit steps nest properly (child within parent)", () => {
    const t = tree(nqueens);
    const check = (n: CallTreeNode) => {
      for (const c of n.children) {
        expect(c.enterStep).toBeGreaterThan(n.enterStep);
        if (n.exitStep !== null) {
          expect(c.exitStep).not.toBeNull();
          expect(c.exitStep!).toBeLessThanOrEqual(n.exitStep);
        }
        check(c);
      }
    };
    t.roots.forEach(check);
  });
});
