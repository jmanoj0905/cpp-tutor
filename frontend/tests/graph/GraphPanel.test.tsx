import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { GraphPanel } from "../../src/viz/graph/GraphPanel";
import dfsList from "../fixtures/graph/dfs_list.json";
import trie from "../fixtures/trie.json"; // a non-graph fixture

const tr = (dfsList as any).trace;

describe("GraphPanel", () => {
  it("renders 7 nodes for the dfs_list graph", () => {
    // pick a step where the graph is built
    let step = 0;
    for (let s = 0; s < tr.length; s++) {
      // cheap: render and count
      const { container, unmount } = render(
        <GraphPanel point={tr[s]} prevPoint={null} trace={tr} step={s} />);
      const count = container.querySelectorAll("[data-node-id]").length;
      unmount();
      if (count === 7) { step = s; break; }
    }
    const { container } = render(
      <GraphPanel point={tr[step]} prevPoint={null} trace={tr} step={step} />);
    expect(container.querySelectorAll("[data-node-id]").length).toBe(7);
  });

  it("renders nothing (null) for a non-graph program", () => {
    const t = (trie as any).trace ?? (trie as any);
    const point = Array.isArray(t) ? t[t.length - 1] : t.trace[t.trace.length - 1];
    const { container } = render(
      <GraphPanel point={point} prevPoint={null} trace={Array.isArray(t) ? t : t.trace} step={0} />);
    expect(container.querySelector("[data-node-id]")).toBeNull();
  });
});
