import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import climbBottomup from "./fixtures/dp/climb-bottomup.json";
import inputFill from "./fixtures/dp/input-fill.json";
import climbTopdown from "./fixtures/dp/climb-topdown.json";
import gridPaths from "./fixtures/dp/grid-paths.json";
import type { Trace } from "../src/types/trace";
import { MemoryView } from "../src/viz/MemoryView";
import { detectDpTables } from "../src/viz/dp/detect";

const renderAt = (t: Trace, step: number) =>
  render(
    <MemoryView
      point={t.trace[step]}
      prevPoint={step > 0 ? t.trace[step - 1] : null}
      trace={t.trace}
      code={t.code}
    />,
  );

// The true last trace index is a "return" event: `dp` has already gone out of
// scope (main's encoded_locals collapses to just `__return__`), so no
// MemoryCell for it is even rendered there. Use the last step where the DP
// local named `name` is still in scope, which is where the fully-computed
// table is actually observable — matches the same fixture quirk documented
// in tests/dpModel.test.ts.
function lastStepInScope(t: Trace, name: string): number {
  for (let s = t.trace.length - 1; s >= 0; s--) {
    const top = t.trace[s].stack_to_render.at(-1) as
      | { encoded_locals?: Record<string, unknown> } | undefined;
    if (top?.encoded_locals && name in top.encoded_locals) return s;
  }
  return t.trace.length - 1;
}

describe("MemoryView DP integration", () => {
  it("climb-bottomup final in-scope step renders a dp panel, not a plain dp array cell", () => {
    const t = climbBottomup as Trace;
    const step = lastStepInScope(t, "dp");
    const { container } = renderAt(t, step);
    expect(container.querySelector(".dp-panel")).not.toBeNull();
    expect(container.querySelectorAll(".dp-cell")).toHaveLength(7);
  });

  it("raw toggle swaps back to the plain array cell and offers restore", () => {
    const t = climbBottomup as Trace;
    const step = lastStepInScope(t, "dp");
    const { container } = renderAt(t, step);
    fireEvent.click(container.querySelector(".dp-generic-toggle")!);
    expect(container.querySelector(".dp-panel")).toBeNull();
    expect(container.textContent).toContain("restore");
  });

  it("task-8b regression: at a write-landing step, .dp-arrows path elements actually render", () => {
    // Bug: DpTablePanel only draws `.dp-arrows` when `currentWrite && reads.length
    // > 0`, but buildDpView always resolved reads off the CURRENT point's line —
    // which, by the step a write lands, has already moved past the recurrence
    // line. So `.dp-arrows` never rendered for any fixture at any step. This is
    // the actual user-visible defect (verified live in the browser: `.dp-write`
    // and `.dp-read` cells lit up on separate steps, but arrows never appeared).
    const t = climbBottomup as Trace;
    const [c] = detectDpTables(t.trace, t.code);
    const w = c.writes.find((w) => w.coord[0] === 4)!;
    const { container } = renderAt(t, w.step);
    expect(container.querySelectorAll(".dp-write")).toHaveLength(1);
    const arrows = container.querySelectorAll(".dp-arrows path");
    expect(arrows.length).toBeGreaterThan(0);
  });

  it("input-fill never shows a dp panel", () => {
    const t = inputFill as Trace;
    const { container } = renderAt(t, t.trace.length - 1);
    expect(container.querySelector(".dp-panel")).toBeNull();
  });
});

describe("MemoryView DP — top-down and 2D", () => {
  it("climb-topdown: memo renders as a dp panel labeled top-down", () => {
    const t = climbTopdown as Trace;
    // The true last trace index is a "return" event: `memo` (a reference
    // parameter of `solve`) has already gone out of scope once `main`
    // resumes after the call, same fixture quirk as climb-bottomup's `dp`
    // (see lastStepInScope above / tests/dpModel.test.ts). Render at the
    // last step where `memo` is still an in-scope local.
    const step = lastStepInScope(t, "memo");
    const { container } = renderAt(t, step);
    expect(container.querySelector(".dp-panel")).not.toBeNull();
    expect(container.querySelector(".dp-mode")!.textContent).toBe("top-down");
  });

  it("climb-topdown mid-recursion: memo cells fill in recursion order (out-of-index-order)", () => {
    const t = climbTopdown as Trace;
    const [c] = detectDpTables(t.trace, t.code);
    const coords = c.writes.map((w) => w.coord[0]);
    // top-down fills small n first while descending from n=6: not monotonically increasing from index 0 upward in loop order
    expect(coords[0]).not.toBe(0);
  });

  it("grid-paths: 2D panel renders 12 cells; at an inner write, reads are up+left", () => {
    const t = gridPaths as Trace;
    const [c] = detectDpTables(t.trace, t.code);
    const w = c.writes.find((w) => w.coord.length === 2 && w.coord[0] >= 1 && w.coord[1] >= 1)!;
    // detect.ts records a write's coord as visible one step AFTER the
    // assignment line that produced it executes (the trace advances past
    // the recurrence line to the loop's re-entry by the time the write
    // shows up) — same off-by-one documented in dpModel.test.ts. Render at
    // `w.step - 1`, the step where the recurrence line itself is executing
    // and its read operands are computed, to observe the up+left reads.
    const { container } = renderAt(t, w.step - 1);
    expect(container.querySelectorAll(".dp-cell")).toHaveLength(12);
    const reads = [...container.querySelectorAll(".dp-read")].map((e) => e.getAttribute("data-coord"));
    const [i, j] = w.coord;
    expect(reads.sort()).toEqual([`${i - 1},${j}`, `${i},${j - 1}`].sort());
  });

  it("task-8b regression: grid-paths at a write-landing step, .dp-arrows path elements render", () => {
    const t = gridPaths as Trace;
    const [c] = detectDpTables(t.trace, t.code);
    const w = c.writes.find((w) => w.coord.length === 2 && w.coord[0] >= 1 && w.coord[1] >= 1)!;
    const { container } = renderAt(t, w.step);
    expect(container.querySelectorAll(".dp-write")).toHaveLength(1);
    const arrows = container.querySelectorAll(".dp-arrows path");
    expect(arrows.length).toBeGreaterThan(0);
  });
});
