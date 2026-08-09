import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import climbBottomup from "./fixtures/dp/climb-bottomup.json";
import inputFill from "./fixtures/dp/input-fill.json";
import climbTopdown from "./fixtures/dp/climb-topdown.json";
import gridPaths from "./fixtures/dp/grid-paths.json";
import type { ExecPoint, Trace } from "../src/types/trace";
import { MemoryView } from "../src/viz/MemoryView";
import { detectDpTables, collectTables, promoteToDp } from "../src/viz/dp/detect";
import { memoryAt } from "../src/viz/memoryModel";

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

describe("MemoryView DP — manual promote", () => {
  // The brief suggests house-robber-ii's `nums` (fallback: knapsack-stub's
  // `item`). Neither works: both are vectors filled once from an
  // initializer list and never mutated afterward, so collectWrites/
  // collectTables never sees a write for them at all (materialization,
  // not a write) — they come back untracked, not merely undetected, so
  // promoteToDp would return null and no chip would ever render. input-fill's
  // plain array `a` IS written (6 writes, one per loop iteration) but never
  // auto-detects (single write per index, no self-reference), which is
  // exactly the "tracked but undetected" shape this test needs.
  it("promotes an undetected array to a DP table when the dp chip is clicked", () => {
    const t = inputFill as Trace;
    const step = lastStepInScope(t, "a");
    const { container } = renderAt(t, step);
    expect(detectDpTables(t.trace, t.code)).toEqual([]); // nothing auto-detected
    expect(container.querySelector(".dp-panel")).toBeNull();

    const chip = container.querySelector<HTMLButtonElement>(".dp-promote-toggle");
    expect(chip).not.toBeNull();
    fireEvent.click(chip!);

    expect(container.querySelector(".dp-panel")).not.toBeNull();
  });

  it("keeps a promotion when the step changes", () => {
    const t = inputFill as Trace;
    const step = lastStepInScope(t, "a");
    const { container, rerender } = renderAt(t, step);
    fireEvent.click(container.querySelector<HTMLButtonElement>(".dp-promote-toggle")!);
    rerender(
      <MemoryView
        point={t.trace[step - 1]}
        prevPoint={t.trace[step - 2]}
        trace={t.trace}
        code={t.code}
      />,
    );
    expect(container.querySelector(".dp-panel")).not.toBeNull();
  });

  // Step 8's real concern: `promotedDp` is a `Set<string>` keyed by cell id.
  // input-fill's `a` never proved this because `main` never recurses — one
  // frame instance, so its id was trivially stable. This test targets a
  // genuinely recursive fixture instead — but NOT through MemoryView/the UI:
  // climb-topdown's `memo` auto-detects at every step it's in scope
  // (`dpCandidates` is whole-trace, independent of the current step), so
  // `activeCandidates`'s `if (byId.has(id)) continue;` guard means
  // `promoteToDp` is never actually invoked for it when driven through a
  // click sequence — any panel reappearing after a demote+promote round trip
  // in the UI is explained by `disabledDp` being cleared, not by the
  // manual-promotion union branch surviving a frame crossing. (No fixture in
  // the repo has a tracked-but-undetected array/map cell inside a recursive
  // frame — climb-topdown, memo-fib-vector, and map-memo are the only
  // recursive fixtures, and all three auto-detect their table, which is the
  // point of the detection plan. map-memo's `memo` isn't even trackable:
  // it's an unordered_map, and collectWrites/indexArrayLeaves only indexes
  // `kind === "array"` or `containerKind === "vector"` today — map support
  // is explicitly deferred, see TrackedTable.keyed's doc comment.)
  //
  // So this asserts the mechanism directly instead of routing it through the
  // UI: (1) the same underlying cell resolves to the same id across two
  // steps in DIFFERENT invocations of the recursive frame — the property
  // `promotedDp`'s `Set<string>` keying actually depends on — and (2)
  // `promoteToDp` returns a real candidate for that id, so the manual-
  // promotion branch is exercised for a recursive-frame cell, not skipped.
  //
  // Note on realism: a DP table can never be a local declared *inside* a
  // recursive frame — memoization requires the table to outlive a single
  // invocation, so real DP code always makes it a global, a by-reference
  // parameter, or something owned by a non-recursive caller. climb-topdown's
  // `memo` is exactly that shape (`vector<int>&` aliasing the vector `main`
  // owns), which is why its id is anchored to `main`'s storage rather than
  // to any one `solve` invocation. That's also the only shape a DP table can
  // legally have, so it's the only shape worth testing here.
  it("a recursive-frame table cell resolves to the same id across two different invocations, and promoteToDp accepts it (climb-topdown's memo, depth 2 -> depth 3)", () => {
    const t = climbTopdown as Trace;
    const shallowStep = 4; // stack_to_render depth 2 (main -> solve)
    const deepStep = 91; // stack_to_render depth 3 (main -> solve -> solve),
    // reached only after dozens of pushes/pops of solve's frame since step 4
    // — a genuinely different invocation, not the same one revisited.
    expect(t.trace[shallowStep].stack_to_render.length).toBe(2);
    expect(t.trace[deepStep].stack_to_render.length).toBe(3);

    const findMemo = (point: ExecPoint) =>
      memoryAt(point).frames.flatMap((f) => f.cells).find((c) => c.name === "memo");
    const shallowCell = findMemo(t.trace[shallowStep]);
    const deepCell = findMemo(t.trace[deepStep]);
    expect(shallowCell).toBeDefined();
    expect(deepCell).toBeDefined();
    // Load-bearing: this equality is exactly what makes a Set<string> of
    // promoted ids sound across a recursive trace.
    expect(deepCell!.id).toBe(shallowCell!.id);

    const tracked = collectTables(t.trace, t.code);
    const promoted = promoteToDp(tracked, shallowCell!.id);
    expect(promoted).not.toBeNull();
    expect(promoted!.cellId).toBe(shallowCell!.id);
  });
});
