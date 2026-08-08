import { describe, it, expect } from "vitest";
import dfsList from "../fixtures/graph/dfs_list.json";
import graphs from "../fixtures/graph/graphs.json";
import islands from "../fixtures/graph/islands.json";
import rotting from "../fixtures/graph/rotting.json";

describe("graph fixtures", () => {
  it.each([
    ["dfs_list", dfsList],
    ["graphs", graphs],
    ["islands", islands],
    ["rotting", rotting],
  ])("%s parses with a non-empty trace", (_name, fx: any) => {
    expect(typeof fx.code).toBe("string");
    expect(Array.isArray(fx.trace)).toBe(true);
    expect(fx.trace.length).toBeGreaterThan(0);
    expect(fx.trace[0]).toHaveProperty("line");
  });
});

import traversal from "../fixtures/graph/tree-traversal.json";
import levelorder from "../fixtures/graph/tree-levelorder.json";
import same from "../fixtures/graph/tree-same.json";
import skewed from "../fixtures/graph/tree-skewed.json";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import { layoutScene } from "../../src/viz/graph/graphLayout";
import { applyShapes, shapeInfoFor } from "../../src/viz/shapes";
import { normalizeMemory } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";
import type { GraphScene } from "../../src/viz/graph/graphModel";

const sceneAt = (trace: ExecPoint[], s: number): GraphScene | null => {
  const mem = normalizeMemory(trace[s]);
  const info = shapeInfoFor(trace);
  const { shapes } = applyShapes(mem, info.confirmed, new Set(), info.selfNames);
  return buildGraphScene(mem, null, trace, s, "auto", shapes);
};

/** First step whose scene satisfies `ok`. */
const findScene = (trace: ExecPoint[], ok: (sc: GraphScene) => boolean): GraphScene => {
  for (let s = 0; s < trace.length; s++) {
    const sc = sceneAt(trace, s);
    if (sc && ok(sc)) return sc;
  }
  throw new Error("no matching scene in trace");
};

describe("pointer-tree fixtures", () => {
  it("tree-traversal: 5-node tree with a stack<TreeNode*> frontier", () => {
    const trace = (traversal as { trace: ExecPoint[] }).trace;
    const sc = findScene(trace, (s) => s.kind === "tree" && s.overlays.frontier.size > 0);
    expect(sc.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("tree-levelorder: the tree beats the vector<vector<int>> result", () => {
    const trace = (levelorder as { trace: ExecPoint[] }).trace;
    // pick a late step, where `res` is populated and would otherwise win
    const sc = findScene(trace.slice(Math.floor(trace.length * 0.6)) as ExecPoint[], (s) => s.kind === "tree");
    expect(sc.kind).toBe("tree");
    expect(sc.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("tree-same: two trees lay out in separate horizontal bands", () => {
    const trace = (same as { trace: ExecPoint[] }).trace;
    const sc = findScene(trace, (s) => {
      if (s.kind !== "tree") return false;
      const hasParent = new Set(s.edges.map((e) => e.to));
      return s.nodes.filter((n) => !hasParent.has(n.id)).length >= 2;
    });
    const { placed, mode } = layoutScene(sc);
    expect(mode).toBe("tree");
    expect(placed.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    const xs = placed.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.3); // bands spread apart
  });

  it("tree-skewed: a right spine leans right and a left spine leans left", () => {
    const trace = (skewed as { trace: ExecPoint[] }).trace;
    const sc = findScene(trace, (s) => s.kind === "tree" && s.nodes.length >= 6);
    const { placed } = layoutScene(sc);
    const byId = new Map(placed.map((p) => [p.id, p]));
    const labelX = (label: string) => {
      const n = sc.nodes.find((q) => q.label === label)!;
      return byId.get(n.id)!.x;
    };
    expect(labelX("2")).toBeGreaterThan(labelX("1"));  // right spine
    expect(labelX("3")).toBeGreaterThan(labelX("2"));
    expect(labelX("8")).toBeLessThan(labelX("9"));     // left spine
    expect(labelX("7")).toBeLessThan(labelX("8"));
  });
});
