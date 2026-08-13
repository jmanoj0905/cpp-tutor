import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { DpTablePanel } from "../src/viz/dp/DpTablePanel";
import type { DpTableView } from "../src/viz/dp/dpModel";
import type { DpCandidate } from "../src/viz/dp/detect";
import { projectKeys } from "../src/viz/dp/keyedTable";
import type { Provenance } from "../src/viz/dp/provenance";

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
  reads: [{ coord: [1], hit: true }, { coord: [0], hit: true }],
  maxWriteStep: 8,
  step: 8,
};

const keyedProjection = projectKeys(["2", "3", "6"]);

const keyedCand: DpCandidate = {
  cellId: "global-globals-memo", name: "memo", dims: keyedProjection.dims,
  mode: "top-down",
  writes: [{ step: 4, coord: [2] }, { step: 7, coord: [3] }, { step: 9, coord: [6] }],
  keyed: { projection: keyedProjection, keyOrder: ["2", "3", "6"] },
};

const keyedView: DpTableView = {
  candidate: keyedCand,
  cells: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
    coord: [i],
    id: `global-globals-memo#${i}`,
    value: i >= 2 ? String(i) : "",
    writeStep: i === 2 ? 4 : i === 3 ? 7 : i === 6 ? 9 : null,
    label: keyedProjection.labelAt.get(String(i)),
  })),
  currentWrite: null, reads: [], maxWriteStep: 9, step: 9, keyed: true,
};

const cand2d: DpCandidate = {
  cellId: "stack:main.dp", name: "dp", dims: [2, 3], mode: "bottom-up",
  writes: [{ step: 3, coord: [0, 0] }, { step: 5, coord: [1, 2] }],
};

const view2d: DpTableView = {
  candidate: cand2d,
  cells: [
    { coord: [0, 0], id: "a", value: "1", writeStep: 3 },
    { coord: [0, 1], id: "b", value: "1", writeStep: 3 },
    { coord: [0, 2], id: "c", value: "1", writeStep: 3 },
    { coord: [1, 0], id: "d", value: "1", writeStep: 5 },
    { coord: [1, 1], id: "e", value: "2", writeStep: 5 },
    { coord: [1, 2], id: "f", value: "3", writeStep: 5 },
  ],
  currentWrite: null, reads: [], maxWriteStep: 5, step: 5,
};

const keyed2dProjection = projectKeys(["(0,0)", "(1,1)"]);
const keyed2dView: DpTableView = {
  candidate: {
    cellId: "global-globals-memo", name: "memo", dims: keyed2dProjection.dims,
    mode: "top-down", writes: [{ step: 4, coord: [0, 0] }],
    keyed: { projection: keyed2dProjection, keyOrder: ["(0,0)", "(1,1)"] },
  },
  cells: [{ coord: [0, 0], id: "k0", value: "1", writeStep: 4, label: "(0,0)" }],
  currentWrite: null, reads: [], maxWriteStep: 4, step: 4, keyed: true,
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

  it("marks a missed read differently and draws it no arrow", () => {
    const missView: DpTableView = {
      ...view,
      reads: [{ coord: [1], hit: true }, { coord: [3], hit: false }],
    };
    const { container } = render(<DpTablePanel view={missView} onToggleGeneric={() => {}} />);
    expect(container.querySelector('[data-coord="1"]')!.className).toContain("dp-read");
    expect(container.querySelector('[data-coord="3"]')!.className).toContain("dp-read-miss");
    expect(container.querySelectorAll(".dp-arrows path")).toHaveLength(1);
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

  it("heat chip shades cells by read count, dimming the not-yet-read ones", () => {
    const readSteps = new Map<string, number[]>([["0", [4, 6]], ["1", [6]], ["3", [99]]]);
    const { container } = render(
      <DpTablePanel view={view} onToggleGeneric={() => {}} readSteps={readSteps} />,
    );
    fireEvent.click(container.querySelector(".dp-heat-toggle")!);
    const at = (coord: string) => container.querySelector(`[data-coord="${coord}"]`)!;
    expect(at("0").getAttribute("style")).toContain("--dp-heat: 1");
    expect(at("1").getAttribute("style")).toContain("--dp-heat: 0.5");
    // read only at step 99, beyond this view's step: not read yet
    expect(at("3").className).toContain("dp-ghost");
    expect(at("2").className).toContain("dp-ghost");
  });

  it("heat chip returns to write-recency shading on a second click", () => {
    const readSteps = new Map<string, number[]>([["0", [4]]]);
    const { container } = render(
      <DpTablePanel view={view} onToggleGeneric={() => {}} readSteps={readSteps} />,
    );
    const chip = container.querySelector(".dp-heat-toggle")!;
    fireEvent.click(chip);
    fireEvent.click(chip);
    expect(container.querySelectorAll(".dp-ghost")).toHaveLength(2); // unwritten 3 and 4
    expect(container.querySelector('[data-coord="2"]')!.getAttribute("style")).toContain("--dp-heat: 1");
  });

  it("tints the row and column header of the current write, and only those", () => {
    const writing: DpTableView = { ...view2d, currentWrite: [1, 2] };
    const { container } = render(<DpTablePanel view={writing} onToggleGeneric={() => {}} />);
    const cols = [...container.querySelectorAll(".dp-col-head span")];
    const rows = [...container.querySelectorAll(".dp-row-head span")];
    expect(cols[2].className).toContain("dp-head-active");
    expect(cols[0].className).not.toContain("dp-head-active");
    expect(rows[1].className).toContain("dp-head-active");
    expect(rows[0].className).not.toContain("dp-head-active");
  });

  it("tints no header when no write lands this step", () => {
    const { container } = render(<DpTablePanel view={view2d} onToggleGeneric={() => {}} />);
    expect(container.querySelectorAll(".dp-head-active")).toHaveLength(0);
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

  it("labels keyed cells with their key and ghosts the unwritten slots", () => {
    const { container } = render(<DpTablePanel view={keyedView} onToggleGeneric={() => {}} />);
    expect(container.querySelectorAll(".dp-cell")).toHaveLength(7);
    expect(container.querySelectorAll(".dp-ghost")).toHaveLength(4);   // 0,1,4,5
    const labels = [...container.querySelectorAll(".dp-key-label")].map((e) => e.textContent);
    expect(labels).toContain("6");
  });

  it("keyed detail box header shows the real key, not the grid coord", () => {
    const { container } = render(<DpTablePanel view={keyed2dView} onToggleGeneric={() => {}} />);
    fireEvent.click(container.querySelector('[data-coord="0,0"]')!);
    const detail = container.querySelector(".dp-detail")!;
    // The pair key "(0,0)" happens to look like the coord textually, so also
    // check with a fixture whose key and coord diverge — the single-key case
    // below would false-pass if the header still used the raw coord.
    expect(detail.textContent).toContain("memo[(0,0)]");
  });

  it("keyed detail box header uses the key even when it does not match the coord", () => {
    const projection = projectKeys(["(2,5)"]);
    const divergingView: DpTableView = {
      candidate: {
        cellId: "global-globals-memo", name: "memo", dims: projection.dims,
        mode: "top-down", writes: [{ step: 4, coord: [0, 0] }],
        keyed: { projection, keyOrder: ["(2,5)"] },
      },
      cells: [{ coord: [0, 0], id: "k0", value: "9", writeStep: 4, label: "(2,5)" }],
      currentWrite: null, reads: [], maxWriteStep: 4, keyed: true,
    };
    const { container } = render(<DpTablePanel view={divergingView} onToggleGeneric={() => {}} />);
    fireEvent.click(container.querySelector('[data-coord="0,0"]')!);
    const detail = container.querySelector(".dp-detail")!;
    expect(detail.textContent).toContain("memo[(2,5)]");
    expect(detail.textContent).not.toContain("memo[0][0]");
  });

  it("2D tables get numeric column and row headers", () => {
    const { container } = render(<DpTablePanel view={view2d} onToggleGeneric={() => {}} />);
    const cols = [...container.querySelectorAll(".dp-col-head span")].map((e) => e.textContent);
    const rows = [...container.querySelectorAll(".dp-row-head span")].map((e) => e.textContent);
    expect(cols).toEqual(["0", "1", "2"]);
    expect(rows).toEqual(["0", "1"]);
  });

  it("1D tables keep the single index strip and grow no 2D headers", () => {
    const { container } = render(<DpTablePanel view={view} onToggleGeneric={() => {}} />);
    expect(container.querySelector(".dp-col-head")).toBeNull();
    expect(container.querySelector(".dp-row-head")).toBeNull();
    expect([...container.querySelectorAll(".dp-indices span")].map((e) => e.textContent))
      .toEqual(["0", "1", "2", "3", "4"]);
  });

  it("keyed 2D tables get no numeric headers (coords are a key projection, not keys)", () => {
    const { container } = render(<DpTablePanel view={keyed2dView} onToggleGeneric={() => {}} />);
    expect(container.querySelector(".dp-col-head")).toBeNull();
    expect(container.querySelector(".dp-row-head")).toBeNull();
  });

  const prov = (over: Partial<Provenance> = {}): Provenance => ({
    lhs: "dp[2]", assign: "=", rhs: "max(dp[1], dp[0] + 1)", op: "max",
    operands: [{ text: "dp[1]", value: 6 }, { text: "dp[0] + 1", value: 7 }],
    written: "7", winner: 1, baseCase: false, ...over,
  });

  it("detail box shows the statement, the branch values, and the winner", () => {
    const { container } = render(
      <DpTablePanel view={view} onToggleGeneric={() => {}} explain={() => prov()} />,
    );
    fireEvent.click(container.querySelector('[data-coord="2"]')!);
    const detail = container.querySelector(".dp-detail")!;
    expect(detail.textContent).toContain("dp[2] = max(dp[1], dp[0] + 1)");
    expect(detail.textContent).toContain("max(6, 7)");
    expect(detail.textContent).toContain("→ 7");
    expect(detail.textContent).toContain("won: dp[0] + 1");
  });

  it("renders an unevaluable operand as ? and omits the winner line", () => {
    const p = prov({
      rhs: "fib(1) + fib(0)", op: null, winner: null,
      operands: [{ text: "fib(1) + fib(0)", value: null }],
    });
    const { container } = render(
      <DpTablePanel view={view} onToggleGeneric={() => {}} explain={() => p} />,
    );
    fireEvent.click(container.querySelector('[data-coord="2"]')!);
    const detail = container.querySelector(".dp-detail")!;
    expect(detail.textContent).toContain("fib(1) + fib(0)");
    expect(detail.textContent).not.toContain("won:");
    expect(detail.querySelector(".dp-values")).toBeNull();
  });

  it("tags a base case", () => {
    const p = prov({ rhs: "1", op: null, winner: null, baseCase: true,
                     operands: [{ text: "1", value: 1 }] });
    const { container } = render(
      <DpTablePanel view={view} onToggleGeneric={() => {}} explain={() => p} />,
    );
    fireEvent.click(container.querySelector('[data-coord="2"]')!);
    expect(container.querySelector(".dp-detail")!.textContent).toContain("base case");
  });

  it("asks for no explanation of a never-written cell", () => {
    const explain = vi.fn(() => prov());
    const { container } = render(
      <DpTablePanel view={view} onToggleGeneric={() => {}} explain={explain} />,
    );
    fireEvent.click(container.querySelector('[data-coord="3"]')!);   // writeStep null
    expect(explain).not.toHaveBeenCalled();
  });
});
