// Every inspector panel is dismissable the same two ways: Escape, and a
// labelled × button. Before this was unified, the DP detail box had an
// unlabelled × and ignored Escape, and the graph detail had neither — once a
// graph node was clicked there was no way to deselect it.
import { describe, it, expect } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { GraphPanel } from "../src/viz/graph/GraphPanel";
import { DpTablePanel } from "../src/viz/dp/DpTablePanel";
import type { DpTableView } from "../src/viz/dp/dpModel";
import dfsList from "./fixtures/graph/dfs_list.json";

const trace = (dfsList as any).trace;

/** First step whose graph scene actually has nodes to click. */
function stepWithNodes(): number {
  for (let s = 0; s < trace.length; s++) {
    const { container, unmount } = render(
      <GraphPanel point={trace[s]} prevPoint={null} trace={trace} step={s} />);
    const n = container.querySelectorAll("[data-node-id]").length;
    unmount();
    if (n >= 2) return s;
  }
  throw new Error("fixture has no step with a graph scene");
}

const dpView: DpTableView = {
  candidate: {
    cellId: "dp", name: "dp", dims: [3], mode: "bottom-up",
    writes: [{ step: 1, coord: [0] }],
  },
  cells: [
    { id: "dp-0", coord: [0], value: "1", writeStep: 1 },
    { id: "dp-1", coord: [1], value: "2", writeStep: 2 },
  ],
  currentWrite: null,
  reads: [],
  maxWriteStep: 2,
} as unknown as DpTableView;

describe("inspector dismissal", () => {
  describe("GraphPanel", () => {
    it("closes the node detail with the × button", () => {
      const step = stepWithNodes();
      const { container } = render(
        <GraphPanel point={trace[step]} prevPoint={null} trace={trace} step={step} />);
      fireEvent.click(container.querySelector("[data-node-id]")!);
      expect(container.querySelector(".graph-detail")).not.toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Close details" }));
      expect(container.querySelector(".graph-detail")).toBeNull();
    });

    it("closes the node detail with Escape", () => {
      const step = stepWithNodes();
      const { container } = render(
        <GraphPanel point={trace[step]} prevPoint={null} trace={trace} step={step} />);
      fireEvent.click(container.querySelector("[data-node-id]")!);
      expect(container.querySelector(".graph-detail")).not.toBeNull();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(container.querySelector(".graph-detail")).toBeNull();
    });
  });

  describe("DpTablePanel", () => {
    it("closes the cell detail with Escape", () => {
      const { container } = render(
        <DpTablePanel view={dpView} onToggleGeneric={() => {}} />);
      fireEvent.click(container.querySelector(".dp-cell")!);
      expect(container.querySelector(".dp-detail")).not.toBeNull();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(container.querySelector(".dp-detail")).toBeNull();
    });

    it("gives its close button an accessible name", () => {
      const { container } = render(
        <DpTablePanel view={dpView} onToggleGeneric={() => {}} />);
      fireEvent.click(container.querySelector(".dp-cell")!);
      expect(screen.getByRole("button", { name: "Close details" })).toBeTruthy();
    });
  });
});
