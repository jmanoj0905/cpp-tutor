import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import climbBottomup from "./fixtures/dp/climb-bottomup.json";
import inputFill from "./fixtures/dp/input-fill.json";
import climbTopdown from "./fixtures/dp/climb-topdown.json";
import gridPaths from "./fixtures/dp/grid-paths.json";
import type { ExecPoint, Trace } from "../src/types/trace";
import { MemoryView } from "../src/viz/MemoryView";
import { detectDpTables, collectTables } from "../src/viz/dp/detect";
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

  it("clicking a written DP cell explains the recurrence that produced it", () => {
    const t = climbBottomup as Trace;
    const step = lastStepInScope(t, "dp");
    const { container } = renderAt(t, step);
    fireEvent.click(container.querySelector('.dp-cell[data-coord="2"]')!);
    const detail = container.querySelector(".dp-detail")!;
    expect(detail.textContent).toContain("dp[2] = dp[1] + dp[0]");
    expect(detail.textContent).toContain("= 2");
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
  // The prior two attempts at this test were both vacuous:
  //   - input-fill's `a` never recurses (one `main` frame), so its id was
  //     trivially stable — no frame boundary was ever crossed.
  //   - A version that drove climb-topdown's `memo` through the UI never
  //     exercised `promoteToDp`: `memo` auto-detects at every step it's in
  //     scope, so `activeCandidates`'s `if (byId.has(id)) continue;` guard
  //     skips the manual-promotion branch for it entirely — any panel
  //     reappearing after demote+promote was explained by the `disabledDp`
  //     clear alone.
  //   - A version using `.find(c => c.name === "memo")` over the flattened
  //     frame list always resolved `main`'s own `memo` (frame index 0, which
  //     never pops), never `solve`'s own per-invocation local — so it
  //     "proved" stability of a cell that was never at risk.
  //
  // What's actually true, checked directly with `memoryAt` against every
  // frame by index rather than by first name match: `solve`'s OWN `memo`
  // local (its own stack slot holding the reference, not the vector it
  // points at) genuinely IS per-invocation — a fresh, different cell id at
  // every call depth. That is the exact failure mode Step 8 exists to catch.
  //
  // The question that decides whether it's a real bug: can a cell with an
  // unstable, per-invocation id ever end up in `trackedTables` (and
  // therefore ever be promotable)? No. `solve`'s own `memo` local decodes to
  // `kind: "scalar"` with no children (it's just the reference/address
  // value, not a materialized array) — `collectWrites`'s `isArrayLike` check
  // (`cell.kind === "array" || cell.containerKind === "vector"`) rejects it
  // outright, so `indexArrayLeaves` never descends into it and it can never
  // become an `arrayId` in `tracked`. Only `main`'s ORIGINAL declaration
  // decodes as the full `container`/`vector` with real children, and that's
  // the only id `collectWrites` (and therefore `promoteToDp`/the `dp` chip,
  // since `MemoryCell`'s `isDpPromotable` also requires an array/map shape)
  // can ever see. So instability exists, but it's confined to a cell shape
  // the promotion mechanism structurally cannot reach.
  it("solve's own per-invocation memo alias has an unstable id, but is never a key in the tracked-table map", () => {
    const t = climbTopdown as Trace;
    const shallowStep = 4; // stack_to_render depth 2 (main -> solve)
    const deepStep = 91; // stack_to_render depth 3 (main -> solve -> solve),
    // reached only after dozens of pushes/pops of solve's frame since step 4
    // — genuinely different invocations, not the same one revisited.
    expect(t.trace[shallowStep].stack_to_render.length).toBe(2);
    expect(t.trace[deepStep].stack_to_render.length).toBe(3);

    // Locate `solve`'s OWN memo local at a given frame depth (not main's,
    // and not just the first "memo" match) by requiring the owning function
    // to be `solve`.
    const solveMemoAt = (point: ExecPoint, frameIndex: number) => {
      const mem = memoryAt(point);
      const frame = mem.frames[frameIndex];
      const func = point.stack_to_render[frameIndex]?.func_name ?? "";
      if (!func.startsWith("solve")) throw new Error(`frame ${frameIndex} is not solve (got ${func})`);
      return frame?.cells.find((c) => c.name === "memo");
    };

    const shallowSolveMemo = solveMemoAt(t.trace[shallowStep], 1);
    const deepSolveMemoOuter = solveMemoAt(t.trace[deepStep], 1);
    const deepSolveMemoInner = solveMemoAt(t.trace[deepStep], 2);
    expect(shallowSolveMemo).toBeDefined();
    expect(deepSolveMemoOuter).toBeDefined();
    expect(deepSolveMemoInner).toBeDefined();

    // Pin the instability: three different invocations, three different ids.
    expect(shallowSolveMemo!.id).not.toBe(deepSolveMemoOuter!.id);
    expect(deepSolveMemoOuter!.id).not.toBe(deepSolveMemoInner!.id);
    expect(shallowSolveMemo!.id).not.toBe(deepSolveMemoInner!.id);

    // solve's own local is a bare reference/scalar, not an array-like cell —
    // this is WHY it can never be tracked, not just an incidental fact.
    expect(shallowSolveMemo!.kind).toBe("scalar");

    // The actual gate: none of the unstable ids are keys in the tracked-
    // table map, so no promotable cell ever carries one of them.
    const tracked = collectTables(t.trace, t.code);
    expect(tracked.has(shallowSolveMemo!.id)).toBe(false);
    expect(tracked.has(deepSolveMemoOuter!.id)).toBe(false);
    expect(tracked.has(deepSolveMemoInner!.id)).toBe(false);

    // The one id that IS tracked is main's own declaration, and it's stable
    // for a structural reason, not a coincidence: a DP table can never be a
    // local declared *inside* the recursive frame itself (memoization
    // requires the table to outlive a single invocation), so real DP code
    // always makes it a global, a by-reference parameter's ORIGIN, or
    // something a non-recursive caller owns — all of which anchor the id to
    // storage that outlives any one invocation.
    const mainMemoShallow = memoryAt(t.trace[shallowStep]).frames[0].cells.find((c) => c.name === "memo");
    const mainMemoDeep = memoryAt(t.trace[deepStep]).frames[0].cells.find((c) => c.name === "memo");
    expect(mainMemoShallow!.id).toBe(mainMemoDeep!.id);
    expect(tracked.has(mainMemoShallow!.id)).toBe(true);
  });
});
