import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { DpTablePanel } from "../src/viz/dp/DpTablePanel";
import type { DpTableView } from "../src/viz/dp/dpModel";
import type { DpCandidate } from "../src/viz/dp/detect";

const cand: DpCandidate = {
  cellId: "stack:main.dp", name: "dp", dims: [5], mode: "bottom-up",
  writes: [{ step: 3, coord: [0] }, { step: 5, coord: [1] }, { step: 8, coord: [2] }],
};

const view: DpTableView = {
  candidate: cand,
  cells: [
    { coord: [0], id: "c0", value: "1", writeStep: 3 },
    { coord: [1], id: "c1", value: "1", writeStep: 5 },
    { coord: [2], id: "c2", value: "2", writeStep: 8 },
    { coord: [3], id: "c3", value: "?", writeStep: null },
    { coord: [4], id: "c4", value: "?", writeStep: null },
  ],
  currentWrite: [2],
  reads: [[1], [0]],
  maxWriteStep: 8,
};

describe("DpTablePanel", () => {
  it("renders one cell per coord with index headers", () => {
    const { container } = render(<DpTablePanel view={view} onToggleGeneric={() => {}} />);
    expect(container.querySelectorAll(".dp-cell")).toHaveLength(5);
    expect(container.textContent).toContain("dp");
    expect(container.textContent).toContain("bottom-up");
  });

  it("marks ghosts, current write, and reads", () => {
    const { container } = render(<DpTablePanel view={view} onToggleGeneric={() => {}} />);
    expect(container.querySelectorAll(".dp-ghost")).toHaveLength(2);
    expect(container.querySelector('.dp-write')!.getAttribute("data-coord")).toBe("2");
    const reads = [...container.querySelectorAll(".dp-read")].map((e) => e.getAttribute("data-coord"));
    expect(reads.sort()).toEqual(["0", "1"]);
  });

  it("draws one arrow per read", () => {
    const { container } = render(<DpTablePanel view={view} onToggleGeneric={() => {}} />);
    expect(container.querySelectorAll(".dp-arrows path")).toHaveLength(2);
  });

  it("clicking a cell opens a detail box with value and write step; never a player jump", () => {
    const { container } = render(<DpTablePanel view={view} onToggleGeneric={() => {}} />);
    fireEvent.click(container.querySelector('[data-coord="2"]')!);
    const detail = container.querySelector(".dp-detail")!;
    expect(detail.textContent).toContain("dp[2]");
    expect(detail.textContent).toContain("step 8");
  });

  it("escape hatch calls onToggleGeneric", () => {
    const onToggle = vi.fn();
    const { container } = render(<DpTablePanel view={view} onToggleGeneric={onToggle} />);
    fireEvent.click(container.querySelector(".dp-generic-toggle")!);
    expect(onToggle).toHaveBeenCalled();
  });

  it("detail box shows \"read at\" steps when readSteps is provided", () => {
    const readSteps = new Map<string, number[]>([["2", [4, 6, 9]]]);
    const { container } = render(
      <DpTablePanel view={view} onToggleGeneric={() => {}} readSteps={readSteps} />,
    );
    fireEvent.click(container.querySelector('[data-coord="2"]')!);
    const detail = container.querySelector(".dp-detail")!;
    expect(detail.textContent).toContain("read at");
    expect(detail.textContent).toContain("4, 6, 9");
  });

  it("detail box omits \"read at\" when the cell has no read history", () => {
    const readSteps = new Map<string, number[]>([["2", [4, 6, 9]]]);
    const { container } = render(
      <DpTablePanel view={view} onToggleGeneric={() => {}} readSteps={readSteps} />,
    );
    fireEvent.click(container.querySelector('[data-coord="3"]')!);
    const detail = container.querySelector(".dp-detail")!;
    expect(detail.textContent).not.toContain("read at");
  });

  it("caps the read-step display at 8, then shows an ellipsis", () => {
    const readSteps = new Map<string, number[]>([["2", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]]);
    const { container } = render(
      <DpTablePanel view={view} onToggleGeneric={() => {}} readSteps={readSteps} />,
    );
    fireEvent.click(container.querySelector('[data-coord="2"]')!);
    const detail = container.querySelector(".dp-detail")!;
    expect(detail.textContent).toContain("1, 2, 3, 4, 5, 6, 7, 8");
    expect(detail.textContent).toContain("…");
    expect(detail.textContent).not.toContain("9");
  });
});
