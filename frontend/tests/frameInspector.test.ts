import { describe, expect, it } from "vitest";
import { buildCallTree, type CallTreeNode } from "../src/viz/callTree";
import { inspectVariable, settledEntryStep } from "../src/viz/frameInspector";
import type { Trace } from "../src/types/trace";
import subsetsVec from "./fixtures/recursion/subsets-vec.json";

const trace = (subsetsVec as unknown as Trace).trace;
const tree = buildCallTree(trace);

// main → subsets → dfs(i=0) → dfs(i=1) → …
const subsetsNode = tree.roots[0].children[0];
const dfs0 = subsetsNode.children[0];

const leafOf = (n: CallTreeNode): CallTreeNode =>
  n.children.length === 0 ? n : leafOf(n.children[0]);

describe("settledEntryStep", () => {
  it("skips the <UNALLOCATED>/<UNINITIALIZED> beats after the call event", () => {
    // dfs(i=0) is pushed at step 8; params only hold real values at step 10.
    expect(dfs0.enterStep).toBe(8);
    expect(settledEntryStep(trace, dfs0)).toBe(10);
  });

  it("stays within the frame's live range for a leaf (childless) node", () => {
    const leaf = leafOf(dfs0);
    const s = settledEntryStep(trace, leaf);
    expect(s).toBeGreaterThanOrEqual(leaf.enterStep);
    expect(s).toBeLessThanOrEqual(leaf.exitStep ?? trace.length - 1);
  });
});

describe("inspectVariable", () => {
  it("auto-derefs a const vector<int>& param to the caller's vector elements", () => {
    const r = inspectVariable(trace, dfs0, "nums")!;
    expect(r).not.toBeNull();
    expect(r.deref).toBe(true);
    expect(r.step).toBe(10);
    expect(r.cell.containerKind).toBe("vector");
    expect(r.cell.children?.map((c) => c.displayValue)).toEqual(["1", "2", "3"]);
  });

  it("shows call-time values for a mutating vector<int>& (subset), not final ones", () => {
    // First grandchild dfs(i=1) was called right after subset.push_back(nums[0]),
    // so at ITS entry subset = [1]; by trace end subset is empty again.
    const dfs1 = dfs0.children[0];
    const r = inspectVariable(trace, dfs1, "subset")!;
    expect(r.deref).toBe(true);
    expect(r.cell.containerKind).toBe("vector");
    expect(r.cell.children?.map((c) => c.displayValue)).toEqual(["1"]);
  });

  it("derefs a vector<vector<int>>& (res) to a nested container tree", () => {
    const r = inspectVariable(trace, dfs0, "res")!;
    expect(r.deref).toBe(true);
    expect(r.cell.containerKind).toBe("vector");
    expect(r.cell.children).toEqual([]); // empty at first dfs entry
  });

  it("returns a scalar cell for an int param without dereffing", () => {
    const r = inspectVariable(trace, dfs0, "i")!;
    expect(r.deref).toBe(false);
    expect(r.cell.kind).toBe("scalar");
    expect(r.cell.displayValue).toBe("0");
  });

  it("works on a frame that has already returned", () => {
    const leaf = leafOf(dfs0);
    expect(leaf.exitStep).not.toBeNull();
    const r = inspectVariable(trace, leaf, "i")!;
    expect(r.cell.displayValue).toBe("3");
  });

  it("returns null for an unknown variable", () => {
    expect(inspectVariable(trace, dfs0, "nope")).toBeNull();
  });

  it("namespaces every returned cell id under ct-inspect", () => {
    const r = inspectVariable(trace, dfs0, "nums")!;
    const ids: string[] = [];
    const walk = (c: typeof r.cell) => {
      ids.push(c.id);
      c.children?.forEach(walk);
    };
    walk(r.cell);
    expect(ids.length).toBeGreaterThan(1);
    for (const id of ids) expect(id.startsWith(`ct-inspect-${dfs0.id}-`)).toBe(true);
  });
});
