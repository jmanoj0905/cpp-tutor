import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../../src/App";
import dfsList from "../fixtures/graph/dfs_list.json";
import vectorTrace from "../fixtures/vector-trace.json";
import treeInsert from "../fixtures/shapes/tree-insert.json";
import lcs2d from "../fixtures/dp/lcs-2d.json";
import listCycle from "../fixtures/shapes/list-cycle.json";
import trie from "../fixtures/trie.json";
import { fetchTrace } from "../../src/api/client";
import type { Trace } from "../../src/types/trace";

// Approach (B) from the task-12 brief: mirror tests/App.test.tsx and drive the
// whole app through its public UI (mock fetchTrace, click Visualize, then move
// the real VCR step slider) rather than exporting Workspace and hand-assembling
// its ~10 required props. Workspace has more required props than the plan's
// literal example test passes, and reaching a "graph built" step requires
// driving player state anyway -- so going through the actual App + Vcr slider
// is both simpler and less brittle than a partial Workspace render.

vi.mock("../../src/api/client", () => ({
  fetchTrace: vi.fn(),
}));

describe("App graph tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers a Graph tab for a graph program and renders the panel when opened", async () => {
    (fetchTrace as any).mockResolvedValue(dfsList as unknown as Trace);
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });

    // Graph is a peer tab next to Memory / Call Tree, not a stacked region.
    const graphTab = screen.getByRole("tab", { name: /^graph$/i });
    // Panel is not mounted while another tab is active.
    expect(container.querySelector(".graph-panel")).toBeNull();

    fireEvent.click(graphTab);
    // Step to a point where the dfs_list graph is actually built, then the
    // panel is present.
    const slider = screen.getByLabelText("Execution step");
    const total = (dfsList as any).trace.length;
    let found = false;
    for (let s = 0; s < total; s++) {
      fireEvent.change(slider, { target: { value: String(s) } });
      if (container.querySelector(".graph-panel")) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("offers a Graph tab for a pointer-tree program", async () => {
    // tree-insert has no matrix/edge-list/heap container at all — only
    // TreeNode heap structs — so the tab must come from shape confirmation.
    (fetchTrace as any).mockResolvedValue(treeInsert as unknown as Trace);
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });

    fireEvent.click(screen.getByRole("tab", { name: /^graph$/i }));

    const slider = screen.getByLabelText("Execution step");
    const total = (treeInsert as any).trace.length;
    let found = false;
    for (let s = 0; s < total; s++) {
      fireEvent.change(slider, { target: { value: String(s) } });
      if (container.querySelector(".graph-panel")) { found = true; break; }
    }
    expect(found).toBe(true);
  });

  it("offers no Graph tab for a non-graph trace", async () => {
    (fetchTrace as any).mockResolvedValue(vectorTrace as unknown as Trace);
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });

    expect(screen.queryByRole("tab", { name: /^graph$/i })).toBeNull();

    const slider = screen.getByLabelText("Execution step");
    const total = (vectorTrace as any).trace.length;
    for (let s = 0; s < total; s++) {
      fireEvent.change(slider, { target: { value: String(s) } });
      expect(container.querySelector(".graph-panel")).toBeNull();
    }
  });

  it("offers a Graph tab for a pointer-list program", async () => {
    // list-cycle.cpp has no container a structural detector could read and no
    // graph vocabulary in its source — it reaches the tab purely on its
    // confirmed `list` shape, the same way a pointer tree does.
    (fetchTrace as any).mockResolvedValue(listCycle as unknown as Trace);
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });

    fireEvent.click(screen.getByRole("tab", { name: /^graph$/i }));
    const slider = screen.getByLabelText("Execution step");
    const total = (listCycle as any).trace.length;
    let found = false;
    for (let s = 0; s < total && !found; s++) {
      fireEvent.change(slider, { target: { value: String(s) } });
      found = container.querySelectorAll(".graph-node").length > 0;
    }
    expect(found).toBe(true);
  });

  it("offers a Graph tab for a trie program", async () => {
    // A struct holding an array of pointers to its own type is not something a
    // non-trie program produces by accident, so like trees and lists this skips
    // the hasGraphCode vocabulary gate.
    (fetchTrace as any).mockResolvedValue(trie as unknown as Trace);
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });

    fireEvent.click(screen.getByRole("tab", { name: /^graph$/i }));
    const slider = screen.getByLabelText("Execution step");
    const total = (trie as any).trace.length;
    let chars = 0;
    for (let s = 0; s < total && chars === 0; s++) {
      fireEvent.change(slider, { target: { value: String(s) } });
      chars = container.querySelectorAll(".graph-edge-label").length;
    }
    expect(chars).toBeGreaterThan(0);
  });

  it("offers no Graph tab for a 2-D DP table", async () => {
    // lcs-2d's dp is a vector<vector<int>> — structurally an adjacency matrix,
    // so only the source vocabulary keeps the tab away (see graph/detect.ts).
    (fetchTrace as any).mockResolvedValue(lcs2d as unknown as Trace);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });

    expect(screen.queryByRole("tab", { name: /^graph$/i })).toBeNull();
  });
});
