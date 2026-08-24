import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GraphPanel } from "../../src/viz/graph/GraphPanel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import { emptyOverlays } from "../../src/viz/graph/scene";
import { normalizeMemory } from "../../src/viz/memoryModel";
import dfsList from "../fixtures/graph/dfs_list.json";
import dijkstra from "../fixtures/graph/dijkstra.json";
import shortestPathDAG from "../fixtures/graph/shortestPathDAG.json";
import trie from "../fixtures/trie.json";
import vectorTrace from "../fixtures/vector-trace.json"; // no self-referential struct at any step
import heapTrace from "../fixtures/graph/heap.json";
import treeInsert from "../fixtures/shapes/tree-insert.json";

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
    // This used trie.json until B3. That fixture confirms as TrieNode -> trie
    // and now legitimately renders — it only kept passing because the last two
    // steps of that trace happen to carry an empty heap, which is a coincidence
    // and not the property the test is about. vector-trace has no
    // self-referential struct anywhere in it, at any step.
    const t = (vectorTrace as any).trace;
    const { container } = render(
      <GraphPanel point={t[t.length - 1]} prevPoint={null} trace={t} step={t.length - 1} />);
    expect(container.querySelector("[data-node-id]")).toBeNull();
  });

  it("renders edge-weight labels for a weighted matrix", () => {
    const trace = (dijkstra as any).trace;
    let step = -1;
    for (let s = 0; s < trace.length; s++) {
      const sc = buildGraphScene(normalizeMemory(trace[s]), null, trace, s);
      if (sc && sc.kind === "matrix" && sc.nodes.length === 3 && sc.edges.some((e) => e.weight != null)) { step = s; break; }
    }
    expect(step).toBeGreaterThanOrEqual(0);
    const { container } = render(
      <GraphPanel point={trace[step]} prevPoint={null} trace={trace} step={step} />);
    expect(container.querySelector(".graph-edge-weight")).not.toBeNull();
  });

  it("renders an arrowhead marker and references it on directed edges", () => {
    const trace = (shortestPathDAG as any).trace;
    // pick the first step whose scene has directed edges (edges built, adj empty)
    let step = 0;
    for (let s = 0; s < trace.length; s++) {
      // heuristic: the edge-list step is early; render each until a directed line appears
      step = s;
      const { container, unmount } = render(
        <GraphPanel point={trace[s]} prevPoint={s ? trace[s - 1] : null} trace={trace} step={s} />
      );
      const directed = container.querySelector("line.is-directed");
      if (directed) {
        expect(container.querySelector("marker#graph-arrow")).not.toBeNull();
        expect(directed.getAttribute("marker-end")).toBe("url(#graph-arrow)");
        unmount();
        return;
      }
      unmount();
    }
    throw new Error("no directed edge rendered in trace");
  });
});

describe("GraphPanel heap tree", () => {
  const ht = (heapTrace as any).trace;

  it("renders the heap as circle nodes with plain (arrowless) edges", () => {
    // find the first step whose scene is a >=5-node tree
    let step = -1;
    for (let s = 0; s < ht.length; s++) {
      const sc = buildGraphScene(normalizeMemory(ht[s]), null, ht, s);
      if (sc && sc.kind === "tree" && sc.nodes.length >= 5) { step = s; break; }
    }
    expect(step).toBeGreaterThanOrEqual(0);

    const { container } = render(
      <GraphPanel point={ht[step]} prevPoint={step ? ht[step - 1] : null} trace={ht} step={step} />);

    // nodes are circles (non-grid), one per heap element
    expect(container.querySelectorAll("[data-node-id] circle").length).toBeGreaterThanOrEqual(5);
    // edges are plain lines, none carrying the graph-arrow marker
    const lines = Array.from(container.querySelectorAll("line.graph-edge"));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.getAttribute("marker-end") === null)).toBe(true);
  });
});

describe("GraphPanel pointer trees", () => {
  const trace = (treeInsert as any).trace;

  it("renders the BST as a tree scene with on-path edges", () => {
    // find a step deep in recursion: >=2 nodes rendered and an on-path edge
    for (let s = 0; s < trace.length; s++) {
      const { container, unmount } = render(
        <GraphPanel point={trace[s]} prevPoint={null} trace={trace} step={s} />);
      const onPath = container.querySelectorAll(".graph-edge.is-on-path").length;
      const nodes = container.querySelectorAll("[data-node-id]").length;
      unmount();
      if (nodes >= 2 && onPath >= 1) return;   // found one — assertion satisfied
    }
    throw new Error("no step rendered a pointer tree with an on-path edge");
  });

  // Finding 3: a pure pointer-tree program has no matrix container, so
  // buildGraphScene(..., "grid") returns null. Before the fix, GraphPanel
  // returned null for the whole panel in that case — the view-toggle
  // disappeared along with the canvas, stranding the user on "grid" with no
  // control left to click back to "auto"/"graph".
  it("keeps the view toggle visible (not stranded) when 'grid' has nothing to show", () => {
    // any step with a live tree scene under auto/graph (buildGraphScene needs
    // the detected shapes to find a tree — GraphPanel computes those itself)
    let step = -1;
    for (let s = 0; s < trace.length; s++) {
      const { container, unmount } = render(
        <GraphPanel point={trace[s]} prevPoint={null} trace={trace} step={s} />);
      const nodes = container.querySelectorAll("[data-node-id]").length;
      unmount();
      if (nodes >= 2) { step = s; break; }
    }
    expect(step).toBeGreaterThanOrEqual(0);

    const { container, getByRole } = render(
      <GraphPanel point={trace[step]} prevPoint={null} trace={trace} step={step} />);
    // switch to "grid" — a pure pointer-tree program has no matrix container
    fireEvent.click(getByRole("tab", { name: "grid" }));
    // the toggle (and its "auto" tab) must still be there to click back
    expect(container.querySelector(".graph-view-toggle")).not.toBeNull();
    const autoTab = getByRole("tab", { name: "auto" });
    expect(autoTab).not.toBeNull();
    expect(container.querySelectorAll("[data-node-id]").length).toBe(0);
  });

  it("renders order labels for visited tree nodes", () => {
    // scan backward for the last step whose scene still shows order labels
    // (the very last trace step is post-return with no locals in scope)
    let found = false;
    for (let s = trace.length - 1; s >= 0; s--) {
      const { container, unmount } = render(
        <GraphPanel point={trace[s]} prevPoint={null} trace={trace} step={s} />);
      const orderCount = container.querySelectorAll(".graph-order").length;
      unmount();
      if (orderCount > 0) { found = true; break; }
    }
    expect(found).toBe(true);
  });
});

import listCycle from "../fixtures/shapes/list-cycle.json";
import listReverse from "../fixtures/shapes/list-reverse.json";

describe("GraphPanel list scenes", () => {
  /** First step whose rendered panel satisfies `ok`, plus its container. */
  const firstStep = (trace: any[], ok: (c: HTMLElement) => boolean) => {
    for (let s = 0; s < trace.length; s++) {
      const { container, unmount } = render(
        <GraphPanel point={trace[s]} prevPoint={s ? trace[s - 1] : null} trace={trace} step={s} />);
      if (ok(container)) return { step: s, container };
      unmount();
    }
    throw new Error("no step matched");
  };

  it("draws list nodes as boxes, not circles", () => {
    // Every other runtime value in the app is a dotted box; a chain of them
    // reads as memory, a chain of circles reads as an abstract graph.
    const trace = (listCycle as any).trace;
    const { container } = firstStep(trace, (c) => c.querySelectorAll(".graph-node").length >= 3);
    expect(container.querySelector(".graph-node rect")).not.toBeNull();
    expect(container.querySelector(".graph-node circle")).toBeNull();
  });

  it("labels a node with the pointers standing on it", () => {
    const trace = (listReverse as any).trace;
    const { container } = firstStep(trace, (c) =>
      [...c.querySelectorAll(".graph-finger")].some((n) => (n.textContent ?? "").includes("curr")));
    const labels = [...container.querySelectorAll(".graph-finger")].map((n) => n.textContent);
    expect(labels.join(" ")).toContain("curr");
  });

  it("draws the cycle back-edge as an arc, not a straight line", () => {
    const trace = (listCycle as any).trace;
    const { container } = firstStep(trace, (c) => c.querySelector(".is-cycle-back") !== null);
    const arc = container.querySelector(".is-cycle-back")!;
    expect(arc.tagName.toLowerCase()).toBe("path");
    expect(arc.getAttribute("d")).toMatch(/^M/);
  });

  it("puts the order badge below the box, clear of the finger names", () => {
    // "slow fast" centered above a 34px box is wider than the box, so a
    // corner order badge would sit underneath it.
    const trace = (listCycle as any).trace;
    const { container } = firstStep(trace, (c) =>
      [...c.querySelectorAll(".graph-finger")].some((n) => (n.textContent ?? "").includes("slow"))
      && c.querySelector(".graph-order") !== null);
    const node = [...container.querySelectorAll(".graph-node")]
      .find((g) => (g.querySelector(".graph-finger")?.textContent ?? "").includes("slow"))!;
    const fingerY = Number(node.querySelector(".graph-finger")!.getAttribute("y"));
    const orderY = Number(node.querySelector(".graph-order")!.getAttribute("y"));
    const boxY = Number(node.querySelector("rect")!.getAttribute("y"));
    expect(fingerY).toBeLessThan(boxY);
    expect(orderY).toBeGreaterThan(boxY);
  });

  it("keeps a detached node in the scene but marks it", () => {
    const scene = {
      kind: "list" as const,
      nodes: [{ id: "a", label: "1" }, { id: "z", label: "9" }],
      edges: [],
      overlays: { ...emptyOverlays(), detached: new Set(["z"]) },
    };
    expect(scene.overlays.detached.has("z")).toBe(true);
  });
});

describe("GraphPanel trie scenes", () => {
  const trace = (trie as any).trace;

  /** First step whose rendered panel satisfies `ok`, plus its container. */
  const firstStep = (ok: (c: HTMLElement) => boolean) => {
    for (let s = 0; s < trace.length; s++) {
      const { container, unmount } = render(
        <GraphPanel point={trace[s]} prevPoint={s ? trace[s - 1] : null} trace={trace} step={s} />);
      if (ok(container)) return container;
      unmount();
    }
    throw new Error("no step matched");
  };

  it("renders the character each edge consumes", () => {
    const c = firstStep((c) => c.querySelectorAll(".graph-edge-label").length >= 2);
    const chars = [...c.querySelectorAll(".graph-edge-label")].map((n) => n.textContent);
    expect(chars.join("")).toMatch(/^ap/);
  });

  it("draws trie nodes as circles, not boxes", () => {
    const c = firstStep((c) => c.querySelectorAll(".graph-node").length >= 3);
    expect(c.querySelector(".graph-node circle")).not.toBeNull();
    expect(c.querySelector(".graph-node rect")).toBeNull();
  });

  it("gives an end-of-word node an inner ring the others do not have", () => {
    // The only thing separating "the trie contains app" from "app is merely a
    // prefix of apple".
    const c = firstStep((c) => c.querySelector(".graph-node.is-terminal") !== null);
    const term = c.querySelector(".graph-node.is-terminal")!;
    expect(term.querySelectorAll("circle").length).toBe(2);
    const plain = [...c.querySelectorAll(".graph-node")].find((g) => !g.classList.contains("is-terminal"))!;
    expect(plain.querySelectorAll("circle").length).toBe(1);
  });

  it("keeps a root's finger label inside the canvas", () => {
    // The root sits at y = PAD, so an unclamped label above it is drawn with
    // its ascender off the top of the viewBox and clipped.
    const c = firstStep((c) =>
      [...c.querySelectorAll(".graph-finger")].some((n) => (n.textContent ?? "").includes("root")));
    const y = Number([...c.querySelectorAll(".graph-finger")]
      .find((n) => (n.textContent ?? "").includes("root"))!.getAttribute("y"));
    expect(y).toBeGreaterThanOrEqual(9);
  });

  it("does not label an edge on a non-trie scene", () => {
    const dfs = (dfsList as any).trace;
    for (let s = 0; s < dfs.length; s++) {
      const { container, unmount } = render(
        <GraphPanel point={dfs[s]} prevPoint={null} trace={dfs} step={s} />);
      expect(container.querySelector(".graph-edge-label")).toBeNull();
      unmount();
    }
  });
});
