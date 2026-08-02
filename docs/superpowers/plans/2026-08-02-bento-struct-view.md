# Bento Struct View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render any nested struct-like value (`pair`, `tuple`, plain `struct`) as a horizontal row of bento tiles, where nested struct children become their own bordered compartments.

**Architecture:** A pure predicate `isBentoCell(cell)` in `memoryModel.ts` decides struct-likeness. `MemoryCell`'s `Children` renderer adds one `.bento` branch that lays children out horizontally; nesting is handled by the same recursive `MemoryCell`. Layout-only — no changes to decode, diff, connectors, or the array/grid/linear paths. CSS in `index.css`.

**Tech Stack:** React + TypeScript, Vite, Vitest + @testing-library/react, plain CSS (Bauhaus theme variables). No new dependencies.

## Global Constraints

- No new frontend dependencies (React + CodeMirror + plain CSS only).
- Bauhaus theme only: dotted 1px borders, square corners (no radius), 12px mono for data text; accents only from CSS vars `--ink --ink-soft --border --blue --yellow --red`.
- Keep `memoryModel.ts` pure — no React/DOM imports.
- TDD: write the failing test, watch it fail, implement minimally. One logical change per commit.
- Diff/highlight rule unchanged: a changed leaf gets `cell-changed`; a struct whose own summary changes tints only its header.
- Typecheck gate: `npm run build` (`tsc -b && vite build`). All commands run from `frontend/`.

## Design refinement vs spec

The spec described a stored `bento: true` marker on cells. This plan uses an exported **pure predicate** `isBentoCell(cell)` instead of a stored field. Rationale: struct-likeness is fully derived from `kind` / `containerKind`, so a predicate cannot be dropped by one of the many `{...cell}` spreads in the pipeline and can never go stale. Same purity and unit-testability the spec asked for; strictly more robust ("never break for any code").

---

## File Structure

- `frontend/src/viz/memoryModel.ts` — add exported `isBentoCell(cell: NormalizedCell): boolean`. Pure.
- `frontend/src/viz/MemoryCell.tsx` — add a `.bento` branch in `Children`.
- `frontend/src/index.css` — `.bento` layout + compartment + caption styles.
- `frontend/tests/bento.test.ts` — unit tests for `isBentoCell`.
- `frontend/tests/bento.render.test.tsx` — render tests for the `.bento` branch.

---

## Task 1: `isBentoCell` predicate

**Files:**
- Modify: `frontend/src/viz/memoryModel.ts`
- Test: `frontend/tests/bento.test.ts` (create)

**Interfaces:**
- Consumes: `NormalizedCell` (existing export).
- Produces: `export function isBentoCell(cell: NormalizedCell): boolean` — returns `true` iff the cell is struct-like: `kind === "struct"`, OR (`kind === "container"` AND `containerKind` is `"pair"` or `"tuple"`). Everything else (arrays, maps/sets, strings, scalars, references, summaries) returns `false`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/bento.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isBentoCell } from "../src/viz/memoryModel";
import type { NormalizedCell } from "../src/viz/memoryModel";

const base = (over: Partial<NormalizedCell>): NormalizedCell => ({
  id: "x", name: "x", source: "stack", kind: "scalar", address: null,
  type: null, displayValue: "", rawValue: null, ...over,
});

describe("isBentoCell", () => {
  it("is true for a plain struct", () => {
    expect(isBentoCell(base({ kind: "struct" }))).toBe(true);
  });
  it("is true for a pair container", () => {
    expect(isBentoCell(base({ kind: "container", containerKind: "pair" }))).toBe(true);
  });
  it("is true for a tuple container", () => {
    expect(isBentoCell(base({ kind: "container", containerKind: "tuple" }))).toBe(true);
  });
  it("is false for a vector/array container", () => {
    expect(isBentoCell(base({ kind: "container", containerKind: "vector" }))).toBe(false);
    expect(isBentoCell(base({ kind: "array" }))).toBe(false);
  });
  it("is false for a map container", () => {
    expect(isBentoCell(base({ kind: "container", containerKind: "map" }))).toBe(false);
  });
  it("is false for scalars, references, summaries", () => {
    expect(isBentoCell(base({ kind: "scalar" }))).toBe(false);
    expect(isBentoCell(base({ kind: "reference" }))).toBe(false);
    expect(isBentoCell(base({ kind: "summary" }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bento.test.ts`
Expected: FAIL — `isBentoCell` is not exported / not a function.

- [ ] **Step 3: Write minimal implementation**

Add to `frontend/src/viz/memoryModel.ts` (near the other exported pure helpers such as `collectionDepth` / `gridShape`):

```ts
/** True for struct-like cells that should render in the horizontal bento tile
 *  layout: plain structs and pair/tuple containers. Pure predicate derived from
 *  kind/containerKind — never stored on the cell, so no pipeline spread can drop
 *  or stale it. Arrays, maps/sets, strings, scalars, references stay false. */
export function isBentoCell(cell: NormalizedCell): boolean {
  if (cell.kind === "struct") return true;
  return cell.kind === "container"
    && (cell.containerKind === "pair" || cell.containerKind === "tuple");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bento.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/viz/memoryModel.ts frontend/tests/bento.test.ts
git commit -m "feat(bento): isBentoCell predicate for struct-like cells"
```

---

## Task 2: Bento render branch + CSS

**Files:**
- Modify: `frontend/src/viz/MemoryCell.tsx` (the `Children` function)
- Modify: `frontend/src/index.css`
- Test: `frontend/tests/bento.render.test.tsx` (create)

**Interfaces:**
- Consumes: `isBentoCell` from Task 1; existing `MemoryCell` recursion and `data-cell-id` / `cell-changed` conventions.
- Produces: when `isBentoCell(cell)`, `Children` renders `<div className="cell-children bento">` containing one `MemoryCell` per child. No new props.

**Placement note:** In `Children`, the bento check goes near the top — after the `dpView` short-circuit is not relevant here (that's in `MemoryCell`, not `Children`), but it MUST come **before** the `gridShape`/`shape` block and the `depth === 3` slices block, and it must respect the existing deep-nest fallback: if `forceLinear || depth >= 4` is already true, do NOT take the bento branch (let the linear fallback win). Struct-like cells are never arrays, so the `gridShape` path never applies to them anyway; the bento branch simply replaces what would otherwise be the trailing generic `cell-children` stack for struct-like cells.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/bento.render.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { MemoryCell } from "../src/viz/MemoryCell";
import type { NormalizedCell } from "../src/viz/memoryModel";

const leaf = (id: string, name: string, val: string): NormalizedCell => ({
  id, name, source: "stack", kind: "scalar", address: null, type: "int",
  displayValue: val, rawValue: null,
});

// pair<int, pair<int,int>>  { 60, { 60, 10 } }
function nestedPair(): NormalizedCell {
  const inner: NormalizedCell = {
    id: "p.second", name: "second", source: "stack", kind: "container",
    address: null, type: "pair<int, int>", displayValue: "(60, 10)", rawValue: null,
    containerKind: "pair",
    children: [leaf("p.second.first", "first", "60"), leaf("p.second.second", "second", "10")],
  };
  return {
    id: "p", name: "p", source: "stack", kind: "container",
    address: null, type: "pair<int, pair<int, int>>", displayValue: "(60, (60, 10))",
    rawValue: null, containerKind: "pair",
    children: [leaf("p.first", "first", "60"), inner],
  };
}

function vectorCell(): NormalizedCell {
  return {
    id: "v", name: "v", source: "stack", kind: "container", address: null,
    type: "vector<int>", displayValue: "[10, 20]", rawValue: null,
    containerKind: "vector",
    children: [leaf("v.0", "[0]", "10"), leaf("v.1", "[1]", "20")],
  };
}

describe("bento render branch", () => {
  it("renders a .bento container for a struct-like cell", () => {
    const { container } = render(createElement(MemoryCell, { cell: nestedPair() }));
    expect(container.querySelector(".cell-children.bento")).toBeTruthy();
  });

  it("nests a .bento compartment for a nested pair child", () => {
    const { container } = render(createElement(MemoryCell, { cell: nestedPair() }));
    // outer + inner pair each produce a .bento children container
    expect(container.querySelectorAll(".cell-children.bento").length).toBe(2);
  });

  it("does NOT render .bento for a vector", () => {
    const { container } = render(createElement(MemoryCell, { cell: vectorCell() }));
    expect(container.querySelector(".cell-children.bento")).toBeNull();
  });

  it("keeps data-cell-id on bento tiles so connectors resolve", () => {
    const { container } = render(createElement(MemoryCell, { cell: nestedPair() }));
    expect(container.querySelector('[data-cell-id="p.first"]')).toBeTruthy();
    expect(container.querySelector('[data-cell-id="p.second.second"]')).toBeTruthy();
  });

  it("marks a changed leaf tile with cell-changed", () => {
    const changed = new Set(["p.second.second"]);
    const { container } = render(
      createElement(MemoryCell, { cell: nestedPair(), changedIds: changed }),
    );
    const tile = container.querySelector('[data-cell-id="p.second.second"]');
    expect(tile?.className).toContain("cell-changed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bento.render.test.tsx`
Expected: FAIL — no `.cell-children.bento` element exists yet (first two tests fail; the vector/data-cell-id/changed tests may pass incidentally).

- [ ] **Step 3: Add the bento branch to `Children`**

In `frontend/src/viz/MemoryCell.tsx`, import the predicate at the top with the existing model import:

```tsx
import { collectionDepth, gridShape, isBentoCell } from "./memoryModel";
```

Then in `Children`, immediately after the `const linear = forceLinear || depth >= 4;` line (so the deep-nest fallback still wins), add:

```tsx
  if (isBentoCell(cell) && !linear) {
    return (
      <div className="cell-children bento">
        {all.map((child) => (
          <MemoryCell
            key={child.id}
            cell={child}
            highlightedIds={highlightedIds}
            changedIds={changedIds}
            noPorts={noPorts}
            dpViews={dpViews}
            onDpToggle={onDpToggle}
            onCharViewToggle={onCharViewToggle}
            onHeapOpen={onHeapOpen}
            dpReadSteps={dpReadSteps}
          />
        ))}
      </div>
    );
  }
```

(This sits above the `const shape = ...` / `if (shape)` block. Struct-like cells never satisfy `gridShape`, so ordering is safe; placing it first keeps the branch obvious.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bento.render.test.tsx`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Add CSS**

In `frontend/src/index.css`, add (near the existing `.cell-children`, `.matrix`, `.grid` rules — match their style):

```css
/* Bento: struct-like value as a horizontal row of tiles; a nested struct child
   is itself a .bento compartment. Layout only — borders/mono/square inherited
   from the base .cell rules. */
.cell-children.bento {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 4px;
}
.cell-children.bento > .cell {
  min-width: 0;
}
/* member caption (first/second/[0]/field name) sits dimmed above its value */
.cell-children.bento > .cell > .cell-head > .cell-name {
  color: var(--ink-soft);
  font-size: 10px;
}
```

- [ ] **Step 6: Full test + typecheck**

Run: `npx vitest run tests/bento.test.ts tests/bento.render.test.tsx`
Expected: PASS.

Run: `npm run build`
Expected: build succeeds.

Run: `npm test`
Expected: full suite green (no regression in MemoryView / MemoryCell / connector tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/viz/MemoryCell.tsx frontend/src/index.css frontend/tests/bento.render.test.tsx
git commit -m "feat(bento): horizontal tile layout for struct-like cells"
```

---

## Task 3: Verify in the real app

**Files:** none (manual verification).

- [ ] **Step 1: Run the app and trace the user's snippet**

Run the stack (`./run.sh`), paste the fractional-knapsack snippet from the brainstorm (a `vector<pair<int, pair<int,int>>> table`), step to where `table` is populated, open the Memory tab.

- [ ] **Step 2: Confirm the visual**

Expected: each `table[i]` renders as a bento row — a tile `first` beside a compartment holding `first`/`second` — instead of the old lopsided vertical nest. Deep/other structs unaffected; vectors/maps unchanged. Pointer lines (if any) still land on member tiles.

- [ ] **Step 3: Note any polish follow-ups**

If tile sizing or caption placement reads poorly, record it — but per the spec this is layout-only and always-on; no toggle. Only fix within the CSS added in Task 2.

---

## Self-Review

**Spec coverage:**
- "Which cells render bento (struct / pair / tuple)" → Task 1 `isBentoCell`.
- "Recursive per-cell, nested compartments" → Task 2 branch recurses via `MemoryCell`; render test asserts 2 nested `.bento`.
- "Independent tiles, no sibling coordination" → branch uses `flex-wrap`, no grid tracks / measurement.
- "Orthogonal to arrays; array grid outside, bento inside" → vector test asserts no `.bento`; branch gated by `isBentoCell`.
- "Depth-safety fallback" → `!linear` guard preserves `depth >= 4` linear fallback.
- "Diff unchanged / free" → changed-leaf render test; no highlight logic touched.
- "Connectors keep resolving" → `data-cell-id` render test; same recursive `MemoryCell`.
- "CSS Bauhaus, no deps" → Task 2 Step 5 uses theme vars only, no imports.
- "Tests: model flag + render + build gate" → Tasks 1 & 2.

**Placeholder scan:** none — every code step has literal content.

**Type consistency:** `isBentoCell(cell: NormalizedCell): boolean` used identically in Task 1 (definition) and Task 2 (import + call). CSS class `cell-children bento` matches the render branch and all render-test selectors.
