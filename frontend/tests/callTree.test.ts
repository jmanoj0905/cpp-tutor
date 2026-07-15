import { describe, expect, it } from "vitest";
import { buildCallTree, nodeState } from "../src/viz/callTree";
import type { ExecPoint } from "../src/types/trace";

// Synthetic trace builder. Each frame is [funcName, frameId, locals?].
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

describe("buildCallTree", () => {
  it("builds a tree from frame push/pop", () => {
    // main -> f -> (pop) -> g
    const trace = [
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["f", "0x2"]], "call"),
      pt([["main", "0x1"], ["f", "0x2"]], "return"),
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["g", "0x2"]], "call"),
      pt([["main", "0x1"]]),
    ];
    const tree = buildCallTree(trace);
    expect(tree.roots).toHaveLength(1);
    const main = tree.roots[0];
    expect(main.funcName).toBe("main");
    expect(main.children.map((c) => c.funcName)).toEqual(["f", "g"]);
    expect(main.children[0]).toMatchObject({ enterStep: 1, exitStep: 2, depth: 1 });
    expect(main.children[1]).toMatchObject({ enterStep: 4, exitStep: 4 });
    expect(main.exitStep).toBeNull(); // live at trace end
    expect(tree.hasRecursion).toBe(false);
  });

  it("separates sibling invocations that reuse the same frame address", () => {
    // f(1) pops and f(2) pushes between consecutive points at the SAME address
    // 0x2 => identical unique_hash. The "call" event must split them.
    const trace = [
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["f", "0x2"]], "call"),
      pt([["main", "0x1"], ["f", "0x2"]], "return"),
      pt([["main", "0x1"], ["f", "0x2"]], "call"), // new invocation, reused addr
      pt([["main", "0x1"]]),
    ];
    const tree = buildCallTree(trace);
    const main = tree.roots[0];
    expect(main.children).toHaveLength(2);
    expect(main.children[0]).toMatchObject({ enterStep: 1, exitStep: 2 });
    expect(main.children[1]).toMatchObject({ enterStep: 3, exitStep: 3 });
  });

  it("detects recursion including mutual recursion", () => {
    const direct = buildCallTree([
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["fib", "0x2"]], "call"),
      pt([["main", "0x1"], ["fib", "0x2"], ["fib", "0x3"]], "call"),
    ]);
    expect(direct.hasRecursion).toBe(true);

    const mutual = buildCallTree([
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["isEven", "0x2"]], "call"),
      pt([["main", "0x1"], ["isEven", "0x2"], ["isOdd", "0x3"]], "call"),
      pt([["main", "0x1"], ["isEven", "0x2"], ["isOdd", "0x3"], ["isEven", "0x4"]], "call"),
    ]);
    expect(mutual.hasRecursion).toBe(true);
  });

  it("ignores zombie frames", () => {
    const zombie = {
      ...pt([["main", "0x1"]]),
      stack_to_render: [
        { func_name: "main", frame_id: "0x1", unique_hash: "main_0x1", ordered_varnames: [], encoded_locals: {} },
        { func_name: "dead", frame_id: "0x9", unique_hash: "dead_0x9", ordered_varnames: [], encoded_locals: {}, is_zombie: true },
      ],
    } as unknown as ExecPoint;
    const tree = buildCallTree([zombie]);
    expect(tree.nodes.map((n) => n.funcName)).toEqual(["main"]);
  });

  it("assigns unique ids in pre-order", () => {
    const tree = buildCallTree([
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["f", "0x2"]], "call"),
    ]);
    expect(tree.nodes.map((n) => n.id)).toEqual([0, 1]);
    expect(new Set(tree.nodes.map((n) => n.id)).size).toBe(tree.nodes.length);
  });
});

describe("nodeState", () => {
  it("classifies current / on-stack / returned / not-yet-called", () => {
    const trace = [
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["f", "0x2"]], "call"),
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["g", "0x2"]], "call"),
    ];
    const { roots } = buildCallTree(trace);
    const main = roots[0];
    const [f, g] = main.children;
    // At step 1: f is current, main is on-stack, g not yet called.
    expect(nodeState(f, 1)).toBe("current");
    expect(nodeState(main, 1)).toBe("on-stack");
    expect(nodeState(g, 1)).toBeNull();
    // At step 2: f returned, main is current again.
    expect(nodeState(f, 2)).toBe("returned");
    expect(nodeState(main, 2)).toBe("current");
    // At step 3: g current.
    expect(nodeState(g, 3)).toBe("current");
    expect(nodeState(main, 3)).toBe("on-stack");
  });
});

describe("labels and return values", () => {
  const cd = (v: unknown, type = "int") => ["C_DATA", "0xA0", type, v];

  it("labels a node with initialized locals at its first step, in order", () => {
    const trace = [
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["fib", "0x2", {
        n: cd(3),
        result: cd("<UNINITIALIZED>"),   // local, not an argument — skipped
        __t0: cd(9),                      // compiler temp — skipped
      }]], "call"),
    ];
    const { roots } = buildCallTree(trace);
    expect(roots[0].children[0].label).toBe("fib(3)");
  });

  it("caps the label at 3 values plus ellipsis", () => {
    const trace = [
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["f", "0x2", {
        a: cd(1), b: cd(2), c: cd(3), d: cd(4),
      }]], "call"),
    ];
    const { roots } = buildCallTree(trace);
    expect(roots[0].children[0].label).toBe("f(1, 2, 3, …)");
  });

  it("abbreviates structs, arrays, and pointers", () => {
    const trace = [
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["f", "0x2", {
        v: ["C_STRUCT", "0xB0", "std::vector<int>"],
        arr: ["C_ARRAY", "0xC0", cd(1), cd(2)],
        p: cd("0x9000", "int*"),
      }]], "call"),
    ];
    const { roots } = buildCallTree(trace);
    expect(roots[0].children[0].label).toBe("f({…}, […], 0x9000)");
  });

  it("captures __return__ at a return event when present", () => {
    const trace = [
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["f", "0x2", { n: cd(2) }]], "call"),
      pt([["main", "0x1"], ["f", "0x2", { n: cd(2), __return__: cd(7) }]], "return"),
      pt([["main", "0x1"]]),
    ];
    const { roots } = buildCallTree(trace);
    expect(roots[0].children[0].returnValue).toBe("7");
  });

  it("holds the parent label through the post-return func_name glitch step", () => {
    // Real traces: the step_line right after a "return" shows one fewer
    // frame, mislabeled with the popped callee's func_name and leftover
    // locals but carrying the surviving parent's frame_id. The label
    // refresh must not read that bogus frame. The trace ends ON the glitch
    // step (step caps can truncate a trace anywhere), so a corrupted label
    // is final here — a later point's self-correction cannot mask the bug.
    const trace = [
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["f", "0x2", { m: cd(7) }]], "call"),
      pt([["main", "0x1"], ["f", "0x2", { m: cd(7) }]], "return"),
      pt([["f", "0x1", { m: cd(0) }]]), // glitch: parent's addr, callee's name + locals
    ];
    const { roots } = buildCallTree(trace);
    expect(roots).toHaveLength(1);
    const main = roots[0];
    expect(main.label).toBe("main()");
    expect(main.children).toHaveLength(1); // f popped cleanly, no spurious node
    expect(main.children[0]).toMatchObject({ funcName: "f", exitStep: 2 });
  });

  it("leaves returnValue null when the trace has no __return__ (C traces)", () => {
    const trace = [
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["f", "0x2", { n: cd(2) }]], "call"),
      pt([["main", "0x1"], ["f", "0x2", { n: cd(2) }]], "return"),
      pt([["main", "0x1"]]),
    ];
    const { roots } = buildCallTree(trace);
    expect(roots[0].children[0].returnValue).toBeNull();
  });
});

describe("args and address", () => {
  const cd = (v: unknown, type = "int") => ["C_DATA", "0xA0", type, v];

  it("snapshots args as name/value pairs, skipping uninitialized locals", () => {
    const trace = [
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["fib", "0x2", {
        n: cd(3),
        result: cd("<UNINITIALIZED>"),
      }]], "call"),
    ];
    const { roots } = buildCallTree(trace);
    expect(roots[0].children[0].args).toEqual([{ name: "n", value: "3" }]);
  });

  it("carries ALL args while the label stays capped at 3 + ellipsis", () => {
    const trace = [
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["f", "0x2", {
        a: cd(1), b: cd(2), c: cd(3), d: cd(4),
      }]], "call"),
    ];
    const { roots } = buildCallTree(trace);
    expect(roots[0].children[0].args.map((x) => x.name)).toEqual(["a", "b", "c", "d"]);
    expect(roots[0].children[0].label).toBe("f(1, 2, 3, …)");
  });

  it("records the frame address, following the one-step address-settle", () => {
    // third subtlety: freshly pushed frame's address is transient for one step
    const trace = [
      pt([["main", "0x1"]]),
      pt([["main", "0x1"], ["f", "0x2", { n: cd(5) }]], "call"),
      pt([["main", "0x1"], ["f", "0x2b", { n: cd(5) }]]),
    ];
    const { roots } = buildCallTree(trace);
    expect(roots[0].children[0].address).toBe("0x2b");
  });

  it("holds args through the post-return func_name glitch step", () => {
    const trace = [
      pt([["main", "0x1", { x: cd(1) }]]),
      pt([["main", "0x1", { x: cd(1) }], ["f", "0x2", { m: cd(7) }]], "call"),
      pt([["main", "0x1", { x: cd(1) }], ["f", "0x2", { m: cd(7) }]], "return"),
      pt([["f", "0x1", { m: cd(0) }]]), // glitch: parent's addr, callee's name + locals
    ];
    const { roots } = buildCallTree(trace);
    expect(roots[0].args).toEqual([{ name: "x", value: "1" }]);
  });
});
