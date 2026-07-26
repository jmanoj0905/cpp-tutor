# priority_queue Heap-Tree Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the `std::priority_queue` binary-heap-tree view out of the inline stack cell body into a modal popup that opens from the pq header, updates live as you step, and closes on backdrop-click / × / Escape.

**Architecture:** A single `activeHeapCell: string \| null` lives in `App` (so the centralized keymap can treat Escape → close, mirroring the help overlay). `App` threads it through `Workspace` to `MemoryView`, which resolves the id against the current step's normalized memory each render (`findCellById`), renders a `HeapTreeOverlay` (mirrors `HelpOverlay`) that reuses the existing `HeapTreePanel` unchanged, and auto-closes when the pq leaves scope. The pq cell's inline tree body-branch is removed; the pq always renders its compact flat array in the stack.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react, plain CSS + inline SVG. No new dependencies.

## Global Constraints

- No new frontend dependencies (React + CodeMirror + plain CSS/SVG only).
- Keep `memoryModel.ts` and `keymap.ts` pure — no React, no DOM (`findCellById` and `resolveShortcut` are pure).
- Bauhaus theme: dotted boxes, square corners, 12px mono, colors only from CSS vars (`--blue`, `--yellow`, `--red`, `--ink`, `--ink-soft`, `--panel`, `--border-thin`, `--mono`, ...).
- Single popup at a time; live-update on step; no external pointer connectors routed into the modal (only `HeapTreePanel`'s own blue heap edges).
- Container highlight rule unchanged: node cells reuse the pq's existing logical child ids, so `changedIds`/`highlightedIds` tint only the changed node — pass the sets through, add no tinting logic.
- `HeapTreePanel.tsx`, `heapTree.ts`, `adaptor.ts`, `helpers.ts` are NOT modified — the popup re-hosts the existing tree.
- TDD: write the failing test, watch it fail, minimal implementation, one logical change per commit.
- Run frontend commands from `frontend/`. Typecheck gate is `npm run build`. Test one file: `npx vitest run tests/<path>`.

---

### Task 1: Keymap — `heapOpen` context + `closeHeap` action

Escape currently resolves to `"stop"` in trace mode (stops the trace). When a heap popup is open, Escape must close it instead — like it already closes the help overlay. Add a `heapOpen` context flag and a `closeHeap` action, checked after `helpOpen` in the Escape branch.

**Files:**
- Modify: `frontend/src/shortcuts/keymap.ts`
- Test: `frontend/tests/keymap.test.ts`

**Interfaces:**
- Produces:
  - `ShortcutContext` gains `heapOpen: boolean`.
  - `Action` union gains `"closeHeap"`.
  - `resolveShortcut`: Escape → `"closeHelp"` if `helpOpen`, else `"closeHeap"` if `heapOpen`, else `"stop"` in trace mode / `null` in edit.

- [ ] **Step 1: Write the failing test**

In `frontend/tests/keymap.test.ts`, update the `ctx` helper default to include `heapOpen: false` (add it to the object literal inside `ctx`, alongside `helpOpen: false`), then add this describe block at the end of the file:

```ts
describe("heap popup Escape", () => {
  it("closes the heap popup when heapOpen and help is closed", () => {
    expect(resolveShortcut(key({ key: "Escape" }), ctx({ heapOpen: true }))).toBe("closeHeap");
  });
  it("help close takes precedence over heap close", () => {
    expect(resolveShortcut(key({ key: "Escape" }), ctx({ helpOpen: true, heapOpen: true }))).toBe("closeHelp");
  });
  it("still stops the trace on Escape when no popup is open", () => {
    expect(resolveShortcut(key({ key: "Escape" }), ctx())).toBe("stop");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/keymap.test.ts -t "heap popup Escape"`
Expected: FAIL — `heapOpen` is not a valid `ShortcutContext` field (type error) / `resolveShortcut` returns `"stop"` not `"closeHeap"`.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/shortcuts/keymap.ts`:

Add `heapOpen` to `ShortcutContext` (after `helpOpen`):

```ts
export type ShortcutContext = {
  mode: "edit" | "trace";
  inEditable: boolean;
  helpOpen: boolean;
  heapOpen: boolean;
  loading: boolean;
};
```

Add `"closeHeap"` to the `Action` union:

```ts
export type Action =
  | "prev" | "next" | "first" | "last"
  | "visualize" | "stop" | "toggleHelp" | "closeHelp" | "closeHeap" | "toggleTree";
```

Update the Escape branch (currently lines 44-47):

```ts
  if (e.key === "Escape" && noMods && !e.repeat) {
    if (ctx.helpOpen) return "closeHelp";
    if (ctx.heapOpen) return "closeHeap";
    return ctx.mode === "trace" ? "stop" : null;
  }
```

Update the `SHORTCUT_TABLE` Esc row description so the cheat sheet does not drift:

```ts
  { keys: "Esc", description: "Stop trace (or close an open popup)", mode: "trace" },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/keymap.test.ts`
Expected: PASS (all keymap tests, including the new block).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shortcuts/keymap.ts frontend/tests/keymap.test.ts
git commit -m "feat(shortcuts): heapOpen context + closeHeap Escape action"
```

---

### Task 2: `findCellById` pure lookup helper

`MemoryView` must resolve `activeHeapCell` (an id) to the live cell each render so the popup tracks the current step. Add a pure recursive lookup that walks `children`.

**Files:**
- Modify: `frontend/src/viz/memoryModel.ts` (add exported helper)
- Test: `frontend/tests/memoryModel.test.ts` (create)

**Interfaces:**
- Produces: `export function findCellById(cells: NormalizedCell[], id: string): NormalizedCell | null` — depth-first search over each cell and its `children`; returns the first match or `null`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/memoryModel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findCellById } from "../src/viz/memoryModel";
import type { NormalizedCell } from "../src/viz/memoryModel";

const leaf = (id: string): NormalizedCell => ({
  id, name: id, source: "stack", kind: "scalar",
  address: null, type: "int", displayValue: "0", rawValue: 0,
});
function parent(id: string, kids: NormalizedCell[]): NormalizedCell {
  return { ...leaf(id), kind: "container", children: kids };
}

describe("findCellById", () => {
  it("finds a top-level cell", () => {
    const cells = [leaf("a"), leaf("b")];
    expect(findCellById(cells, "b")?.id).toBe("b");
  });
  it("finds a nested child", () => {
    const cells = [parent("pq", [leaf("pq-0"), leaf("pq-1")])];
    expect(findCellById(cells, "pq-1")?.id).toBe("pq-1");
  });
  it("finds a deeply nested child", () => {
    const cells = [parent("outer", [parent("mid", [leaf("deep")])])];
    expect(findCellById(cells, "deep")?.id).toBe("deep");
  });
  it("returns null when absent", () => {
    expect(findCellById([leaf("a")], "missing")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/memoryModel.test.ts`
Expected: FAIL with "findCellById is not a function" / import error.

- [ ] **Step 3: Write minimal implementation**

Append to `frontend/src/viz/memoryModel.ts` (after the `NormalizedCell`/`NormalizedMemory` declarations, top-level export):

```ts
/** Depth-first search for a cell by id, walking each cell's children.
 *  Pure — used to resolve a stable cell id against a fresh step's memory. */
export function findCellById(cells: NormalizedCell[], id: string): NormalizedCell | null {
  for (const c of cells) {
    if (c.id === id) return c;
    if (c.children) {
      const hit = findCellById(c.children, id);
      if (hit) return hit;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/memoryModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/memoryModel.ts frontend/tests/memoryModel.test.ts
git commit -m "feat(viz): findCellById pure recursive cell lookup"
```

---

### Task 3: `HeapTreeOverlay` modal component

A modal that mirrors `HelpOverlay` (backdrop click-close, panel `stopPropagation`, `×` close, `role="dialog"`) and hosts the existing `HeapTreePanel`. Escape is handled globally by the keymap (Task 1 + Task 4), so the overlay has no local key listener. Not mounted anywhere yet — Task 4 wires it in.

**Files:**
- Create: `frontend/src/viz/stl/HeapTreeOverlay.tsx`
- Modify: `frontend/src/index.css` (overlay styles)
- Test: `frontend/tests/stl/HeapTreeOverlay.test.tsx`

**Interfaces:**
- Consumes: `HeapTreePanel` (unchanged), `NormalizedCell`.
- Produces:
```ts
export function HeapTreeOverlay(props: {
  cell: NormalizedCell;
  step: number;
  onClose: () => void;
  highlightedIds?: Set<string>;
  changedIds?: Set<string>;
  onCharViewToggle?: (cellId: string) => void;
}): JSX.Element;
```
  - Backdrop `div.heap-overlay-backdrop` with `onClick={onClose}`.
  - Panel `div.heap-overlay-panel` with `role="dialog"`, `onClick` stopPropagation.
  - Header shows the cell name, the min/max/heap badge (`min`→`min-heap`, `max`→`max-heap`, else `heap`), a `step N` label, and a `×` close button.
  - Body renders `<HeapTreePanel cell={cell} .../>` (so the panel's `data-heap-tree` + `.heap-node`/`.heap-edges` appear).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/stl/HeapTreeOverlay.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { createElement } from "react";
import { HeapTreeOverlay } from "../../src/viz/stl/HeapTreeOverlay";
import type { NormalizedCell } from "../../src/viz/memoryModel";

const child = (i: number, v: string): NormalizedCell => ({
  id: `pq-${i}`, name: `[${i}]`, source: "stack", kind: "scalar",
  address: null, type: "int", displayValue: v, rawValue: null,
});
function pqCell(vals: string[]): NormalizedCell {
  return {
    id: "pq", name: "minHeap", source: "stack", kind: "container", address: null,
    type: "priority_queue<int, vector<int>, greater<int> >",
    displayValue: `priority_queue<int> · ${vals.length}`, rawValue: null,
    containerKind: "priority_queue", elementType: "int", heapKind: "min",
    length: vals.length, children: vals.map((v, i) => child(i, v)),
  };
}

describe("HeapTreeOverlay", () => {
  it("renders the heap tree for the cell", () => {
    const { container } = render(createElement(HeapTreeOverlay, {
      cell: pqCell(["1", "2", "4"]), step: 7, onClose: vi.fn(),
    }));
    expect(container.querySelector("[data-heap-tree]")).toBeTruthy();
    expect(container.querySelectorAll(".heap-node").length).toBe(3);
  });

  it("shows the cell name, min-heap badge, and step label", () => {
    render(createElement(HeapTreeOverlay, { cell: pqCell(["1"]), step: 7, onClose: vi.fn() }));
    expect(screen.getByText("minHeap")).toBeTruthy();
    expect(screen.getByText("min-heap")).toBeTruthy();
    expect(screen.getByText("step 7")).toBeTruthy();
  });

  it("fires onClose on backdrop click but not on panel click", () => {
    const onClose = vi.fn();
    const { container } = render(createElement(HeapTreeOverlay, {
      cell: pqCell(["1", "2"]), step: 1, onClose,
    }));
    fireEvent.click(container.querySelector(".heap-overlay-panel")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector(".heap-overlay-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onClose on the × button", () => {
    const onClose = vi.fn();
    render(createElement(HeapTreeOverlay, { cell: pqCell(["1"]), step: 1, onClose }));
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stl/HeapTreeOverlay.test.tsx`
Expected: FAIL with "Cannot find module '.../HeapTreeOverlay'".

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/viz/stl/HeapTreeOverlay.tsx`:

```tsx
import type { NormalizedCell } from "../memoryModel";
import { HeapTreePanel } from "./HeapTreePanel";

/** Modal host for a priority_queue's heap-tree view. Mirrors HelpOverlay:
 *  backdrop click and × close it; Escape is handled globally by the keymap. */
export function HeapTreeOverlay({ cell, step, onClose, highlightedIds, changedIds, onCharViewToggle }: {
  cell: NormalizedCell;
  step: number;
  onClose: () => void;
  highlightedIds?: Set<string>;
  changedIds?: Set<string>;
  onCharViewToggle?: (cellId: string) => void;
}) {
  const badge = cell.heapKind === "min" ? "min-heap" : cell.heapKind === "max" ? "max-heap" : "heap";
  return (
    <div className="heap-overlay-backdrop" onClick={onClose}>
      <div
        className="heap-overlay-panel"
        role="dialog"
        aria-label={`${cell.name} heap tree`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="heap-overlay-head">
          <span className="cell-name">{cell.name}</span>
          <span className="heap-badge">{badge}</span>
          <span className="heap-overlay-step">step {step}</span>
          <button className="help-close heap-overlay-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <HeapTreePanel
          cell={cell}
          highlightedIds={highlightedIds}
          changedIds={changedIds}
          onCharViewToggle={onCharViewToggle}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/stl/HeapTreeOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add styles**

Append to `frontend/src/index.css` (mirrors the `.help-*` block; reuses `.help-close` for the × plus a nudge to the right):

```css
/* ── priority_queue heap-tree popup ─────────────────────────── */
.heap-overlay-backdrop {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0, 0, 0, 0.35);
  display: flex; align-items: center; justify-content: center;
}
.heap-overlay-panel {
  background: var(--panel);
  border: var(--border-thin);
  max-width: 90vw; max-height: 85vh; overflow: auto;
  padding: 12px;
}
.heap-overlay-head {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px;
}
.heap-overlay-step { font: 12px var(--mono); color: var(--ink-soft); }
.heap-overlay-close { margin-left: auto; }
```

- [ ] **Step 6: Verify build passes**

Run: `npm run build`
Expected: PASS (tsc + vite; the component is standalone/unmounted so this only typechecks it).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/viz/stl/HeapTreeOverlay.tsx frontend/src/index.css frontend/tests/stl/HeapTreeOverlay.test.tsx
git commit -m "feat(viz): HeapTreeOverlay modal hosting the heap-tree view"
```

---

### Task 4: Wire the popup — replace inline tree end-to-end

Atomic re-host: the pq header button opens the popup instead of flipping an inline tree; the inline body-branch is removed; `activeHeapCell` state is lifted to `App` (for keymap Escape) and threaded `App → Workspace → MemoryView`; `MemoryView` resolves the id and mounts `HeapTreeOverlay`, auto-closing when the pq leaves scope. Done in one commit so the build never has a half-renamed prop.

**Files:**
- Modify: `frontend/src/viz/MemoryCell.tsx` (props: drop `heapViews`/`onHeapToggle`, add `onHeapOpen`; remove inline branch; header opens popup)
- Modify: `frontend/src/viz/MemoryView.tsx` (drop local `heapViews`/`toggleHeap`; accept `activeHeapCell`/`onHeapOpen`/`onHeapClose`; lookup + overlay + auto-close; update `FrameView`)
- Modify: `frontend/src/App.tsx` (`activeHeapCell` state, keymap ctx `heapOpen` + `closeHeap` handler, reset on stop/visualize, pass to `Workspace`)
- Test: `frontend/tests/stl/HeapTreePanel.test.tsx` (rewrite the inline-view cases)

**Interfaces:**
- Consumes: `findCellById` (Task 2), `HeapTreeOverlay` (Task 3), keymap `heapOpen`/`closeHeap` (Task 1).
- Produces: `MemoryCell`/`FrameView` prop `onHeapOpen?: (cellId: string) => void` (threaded like `onCharViewToggle`); `MemoryView` props `activeHeapCell: string | null`, `onHeapOpen: (id: string) => void`, `onHeapClose: () => void`; `Workspace` gains the same three props.

- [ ] **Step 1: Rewrite the failing tests in `HeapTreePanel.test.tsx`**

Replace the three inline-view cases inside the `describe("priority_queue header badge + tree toggle", ...)` block — the current test at approx lines 50-72: "shows a '⇄ tree' button that fires onHeapToggle...", "renders the tree body (and a '⇄ array' button) when the toggle is on", and "renders the flat array body when the toggle is off" — with these (keep the "shows a min-heap badge" case unchanged):

```ts
  it("shows a '⇄ tree' button that fires onHeapOpen with the cell id", () => {
    const onHeapOpen = vi.fn();
    render(createElement(MemoryCell, { cell: pqCell(["1", "2"]), onHeapOpen }));
    fireEvent.click(screen.getByRole("button", { name: /⇄ tree/ }));
    expect(onHeapOpen).toHaveBeenCalledWith("pq");
  });

  it("has no ⇄ array button and never inlines a tree body", () => {
    const { container } = render(createElement(MemoryCell, {
      cell: pqCell(["1", "2", "4"]), onHeapOpen: vi.fn(),
    }));
    expect(screen.queryByRole("button", { name: /⇄ array/ })).toBeNull();
    expect(container.querySelector("[data-heap-tree]")).toBeNull();
  });

  it("omits the tree button when no onHeapOpen is provided", () => {
    render(createElement(MemoryCell, { cell: pqCell(["1", "2"]) }));
    expect(screen.queryByRole("button", { name: /⇄ tree/ })).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/stl/HeapTreePanel.test.tsx -t "header badge"`
Expected: FAIL — `onHeapOpen` is not a `MemoryCell` prop yet; the `⇄ tree` button still fires `onHeapToggle`; a `[data-heap-tree]` inline body still renders when toggled.

- [ ] **Step 3: Update `MemoryCell.tsx`**

(a) Remove the now-unused import at the top:

```tsx
import { HeapTreePanel } from "./stl/HeapTreePanel";
```

(b) In `MemoryCellProps`, replace the `heapViews`/`onHeapToggle` pair (lines 32-35) with:

```ts
  /** Open the binary-tree popup for a priority_queue cell (see HeapTreeOverlay).
   *  Threaded through every recursive cell like onCharViewToggle. */
  onHeapOpen?: (cellId: string) => void;
```

(c) Update the `MemoryCell` destructure (line 38) — replace `heapViews, onHeapToggle` with `onHeapOpen`:

```tsx
export function MemoryCell({ cell, highlightedIds, changedIds, forceLinear = false, noPorts = false, dpViews, onDpToggle, onCharViewToggle, dpReadSteps, onHeapOpen }: MemoryCellProps) {
```

(d) Replace the header button block (current lines 75-83) with an open-popup button (always `⇄ tree`, no toggled `⇄ array` state):

```tsx
        {cell.containerKind === "priority_queue" && onHeapOpen && (
          <button
            className="heap-view-toggle"
            title="Show as heap tree"
            onClick={(e) => { e.stopPropagation(); onHeapOpen(cell.id); }}
          >
            ⇄ tree
          </button>
        )}
```

(e) Replace the body branch (current lines 85-89) with the plain children render (no inline tree):

```tsx
      {hasKids && <Children cell={cell} highlightedIds={highlightedIds} changedIds={changedIds} forceLinear={forceLinear} noPorts={noPorts} dpViews={dpViews} onDpToggle={onDpToggle} onCharViewToggle={onCharViewToggle} onHeapOpen={onHeapOpen} dpReadSteps={dpReadSteps} />}
```

(f) In the `Children` function: update its destructure (line 118) — replace `heapViews, onHeapToggle` with `onHeapOpen` — and at EVERY recursive `<MemoryCell .../>` call inside `Children` (the grid/matrix branch, the depth-3 slices, and the default list), replace `onHeapToggle={onHeapToggle} heapViews={heapViews}` with `onHeapOpen={onHeapOpen}`. Grep to confirm zero `heapViews`/`onHeapToggle` remain in the file:

```bash
grep -n "heapViews\|onHeapToggle" frontend/src/viz/MemoryCell.tsx   # expect no output
```

- [ ] **Step 4: Update `MemoryView.tsx`**

(a) Ensure `useEffect` and `findCellById` are imported. Line 1 already imports `useEffect`. Update the `memoryModel` import (line 3) to include `findCellById`:

```tsx
import { normalizeMemory, findCellById, type NormalizedFrame } from "./memoryModel";
```

Add the overlay import near the other stl imports (after line 6):

```tsx
import { HeapTreeOverlay } from "./stl/HeapTreeOverlay";
```

(b) Extend the `MemoryView` props (line 14) with the three popup props:

```tsx
export function MemoryView({ point, prevPoint, trace, code, activeHeapCell, onHeapOpen, onHeapClose }: {
  point: ExecPoint;
  prevPoint?: ExecPoint | null;
  trace: ExecPoint[];
  code: string;
  activeHeapCell: string | null;
  onHeapOpen: (id: string) => void;
  onHeapClose: () => void;
}) {
```

(c) Delete the local heap state (current lines 36-42):

```tsx
  const [heapViews, setHeapViews] = useState<Set<string>>(new Set());
  const toggleHeap = (cellId: string) =>
    setHeapViews((prev) => {
      const n = new Set(prev);
      if (n.has(cellId)) n.delete(cellId); else n.add(cellId);
      return n;
    });
```

(d) At the three `MemoryCell`/`FrameView` render sites that currently pass `heapViews={heapViews} onHeapToggle={toggleHeap}` (the globals map at line 104, the `FrameView` at lines 120-121, and the heap map at line 150), replace that pair with `onHeapOpen={onHeapOpen}`.

(e) In `FrameView` (lines 165-180): remove `heapViews, onHeapToggle` from the destructure and the prop type, add `onHeapOpen?: (cellId: string) => void;` to the type; and at both inner `<MemoryCell .../>` calls (visible cells line 187, internal cells line 194) replace `heapViews={heapViews} onHeapToggle={onHeapToggle}` with `onHeapOpen={onHeapOpen}`.

(f) Add the lookup + auto-close just after `step` is defined (after line 60), using `viewMemory` (char-view-applied; pq ids are stable across the transform):

```tsx
  const heapRoots = [...viewMemory.globals, ...viewMemory.frames.flatMap((f) => f.cells), ...viewMemory.heap];
  const rawHeapCell = activeHeapCell ? findCellById(heapRoots, activeHeapCell) : null;
  const heapCell = rawHeapCell?.containerKind === "priority_queue" ? rawHeapCell : null;
  const heapMissing = activeHeapCell !== null && heapCell === null;
  useEffect(() => {
    if (heapMissing) onHeapClose();
  }, [heapMissing, onHeapClose]);
```

(g) Mount the overlay just before the closing `</div>` of the `.memory` container — after the `<Connectors ... />` element (after line 160):

```tsx
      {heapCell && (
        <HeapTreeOverlay
          cell={heapCell}
          step={step}
          onClose={onHeapClose}
          highlightedIds={highlightedIds}
          changedIds={changedIds}
          onCharViewToggle={toggleCharView}
        />
      )}
```

Confirm no stale references remain:

```bash
grep -n "heapViews\|toggleHeap\|onHeapToggle" frontend/src/viz/MemoryView.tsx   # expect no output
```

- [ ] **Step 5: Update `App.tsx`**

(a) Add state next to `helpOpen` (after line 150):

```tsx
  const [activeHeapCell, setActiveHeapCell] = useState<string | null>(null);
```

(b) In `visualize()`, reset the popup at the top of the function body (after `setErr(null);` at line 161) — a new trace invalidates any open pq id:

```tsx
    setActiveHeapCell(null);
```

(c) In `stop()` (after line 177 `setTrace(null);`), reset it too:

```tsx
    setActiveHeapCell(null);
```

(d) Extend the `useShortcuts` context (line 185) and handlers (line 186-196):

```tsx
  useShortcuts(
    { mode: viewing ? "trace" : "edit", helpOpen, heapOpen: activeHeapCell !== null, loading },
    {
      prev: () => stepHandlers.current?.prev?.(),
      next: () => stepHandlers.current?.next?.(),
      first: () => stepHandlers.current?.first?.(),
      last: () => stepHandlers.current?.last?.(),
      toggleTree: () => stepHandlers.current?.toggleTree?.(),
      visualize,
      stop,
      toggleHelp: () => setHelpOpen((v) => !v),
      closeHelp: () => setHelpOpen(false),
      closeHeap: () => setActiveHeapCell(null),
    },
  );
```

(e) Pass the three props to `<Workspace>` (in the render, add to the props at lines 217-226):

```tsx
              activeHeapCell={activeHeapCell}
              onHeapOpen={setActiveHeapCell}
              onHeapClose={() => setActiveHeapCell(null)}
```

(f) Extend the `Workspace` component's props type and destructure (the function whose props type is declared around lines 20-44) with:

```ts
  activeHeapCell: string | null;
  onHeapOpen: (id: string) => void;
  onHeapClose: () => void;
```

and forward them to `<MemoryView>` (line 130):

```tsx
            <MemoryView point={player.point} prevPoint={player.prevPoint} trace={trace.trace} code={trace.code} activeHeapCell={activeHeapCell} onHeapOpen={onHeapOpen} onHeapClose={onHeapClose} />
```

- [ ] **Step 6: Run the component tests**

Run: `npx vitest run tests/stl/HeapTreePanel.test.tsx`
Expected: PASS — `⇄ tree` fires `onHeapOpen`; no `⇄ array`; no inline `[data-heap-tree]`; the unchanged `HeapTreePanel` rendering cases and the badge case still pass.

- [ ] **Step 7: Add a MemoryView integration test**

Create `frontend/tests/MemoryView.test.tsx`. This drives the real open/lookup/auto-close wiring. Build a minimal `ExecPoint` whose stack frame holds a priority_queue local so `normalizeMemory` produces a pq cell; assert against the overlay.

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { MemoryView } from "../src/viz/MemoryView";
import type { ExecPoint } from "../src/types/trace";

// A single-frame point with a priority_queue<int, vector<int>, greater<int>>
// local named "pq" holding {1,3,2}. Uses the C_STRUCT/C_ARRAY encoding the
// container decoder consumes; the heap buffer lives in `heap`.
function pqPoint(): ExecPoint {
  return {
    line: 1,
    event: "step_line",
    stdout: "",
    func_name: "main",
    stack_to_render: [
      {
        frame_id: 1,
        func_name: "main",
        is_highlighted: true,
        is_zombie: false,
        is_parent: false,
        unique_hash: "main_1",
        ordered_varnames: ["pq"],
        encoded_locals: {
          pq: [
            "C_STRUCT", "0x100", "std::priority_queue<int, std::vector<int, std::allocator<int> >, std::greater<int> >",
            ["c", ["C_STRUCT", "0x100", "std::vector<int, std::allocator<int> >",
              ["_M_start", ["C_ARRAY", "0x200", "1", "3", "2"]]]],
          ],
        },
      },
    ],
    heap: {},
    globals: {},
    ordered_globals: [],
  } as unknown as ExecPoint;
}

const trace = [pqPoint()];

function view(activeHeapCell: string | null, onHeapClose = vi.fn(), onHeapOpen = vi.fn()) {
  return render(createElement(MemoryView, {
    point: trace[0], prevPoint: null, trace, code: "int main(){}",
    activeHeapCell, onHeapOpen, onHeapClose,
  }));
}

describe("MemoryView heap popup wiring", () => {
  it("renders no overlay when activeHeapCell is null", () => {
    const { container } = view(null);
    expect(container.querySelector(".heap-overlay-backdrop")).toBeNull();
    // the pq cell body is a flat array, never an inline tree
    expect(container.querySelector("[data-heap-tree]")).toBeNull();
  });

  it("clicking ⇄ tree calls onHeapOpen with the pq cell id", () => {
    const onHeapOpen = vi.fn();
    view(null, vi.fn(), onHeapOpen);
    fireEvent.click(screen.getByRole("button", { name: /⇄ tree/ }));
    expect(onHeapOpen).toHaveBeenCalledTimes(1);
    expect(onHeapOpen.mock.calls[0][0]).toEqual(expect.any(String));
  });

  it("renders the overlay when activeHeapCell resolves to the pq", () => {
    // read the pq id from the open button's cell by opening first
    const onHeapOpen = vi.fn();
    const { unmount } = view(null, vi.fn(), onHeapOpen);
    fireEvent.click(screen.getByRole("button", { name: /⇄ tree/ }));
    const pqId = onHeapOpen.mock.calls[0][0] as string;
    unmount();
    const { container } = view(pqId);
    expect(container.querySelector(".heap-overlay-backdrop")).toBeTruthy();
    expect(container.querySelector("[data-heap-tree]")).toBeTruthy();
  });

  it("auto-closes when activeHeapCell is absent from the current memory", () => {
    const onHeapClose = vi.fn();
    view("no-such-id", onHeapClose);
    expect(onHeapClose).toHaveBeenCalledTimes(1);
  });
});
```

Note: if the exact `ExecPoint`/frame field names above do not match `frontend/src/types/trace.ts`, adjust the literal to satisfy the type (the shape is what matters: one frame, one `pq` local decoding to a `containerKind === "priority_queue"` cell). If constructing a valid `ExecPoint` by hand proves brittle, instead import an existing pq fixture from `frontend/tests/fixtures/` and find the point index where the pq has ≥3 children — check the fixtures directory for one before hand-authoring.

- [ ] **Step 8: Run the integration test**

Run: `npx vitest run tests/MemoryView.test.tsx`
Expected: PASS (overlay absent when null, `⇄ tree` fires open, overlay present when id resolves, auto-close when id missing).

- [ ] **Step 9: Verify build + full frontend test run**

Run: `npm run build && npm test`
Expected: PASS (typecheck clean; all tests green, including the rewritten HeapTreePanel cases and every other suite).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/viz/MemoryCell.tsx frontend/src/viz/MemoryView.tsx frontend/src/App.tsx frontend/tests/stl/HeapTreePanel.test.tsx frontend/tests/MemoryView.test.tsx
git commit -m "feat(viz): open priority_queue heap tree in a popup instead of inline"
```

---

### Task 5: End-to-end verification with a real trace

Confirm the popup works on a real backend trace (live-updates on step, closes three ways, auto-closes when the pq leaves scope), not just unit tests.

**Files:** none (manual/scripted verification).

- [ ] **Step 1: Run the stack and open the app**

Run: `./run.sh` (from repo root). Wait for backend `:8000` and frontend `:5173`. (If both are already serving, reuse them.)

- [ ] **Step 2: Trace the min-heap example**

Paste a `findKthLargest`-style program using `priority_queue<int, vector<int>, greater<int>> minHeap` (push several values across a loop) and run the trace.

- [ ] **Step 3: Verify the popup**

Step to a point where `minHeap` has ≥ 3 elements. Confirm:
- The `minHeap` cell in the stack stays a compact flat array (no inline tree bloating the box) and shows a `min-heap` badge and a `⇄ tree` button (dotted-box themed, matching the char-view button).
- Clicking `⇄ tree` opens a centered modal over a dimmed backdrop: the binary tree with blue edges, root tinted yellow, header showing `minHeap`, `min-heap`, and `step N`.
- With the popup open, pressing `→`/`←` steps the trace and the tree updates live (push/pop reshape it); the `step N` label tracks.
- The popup closes on: backdrop click, the `×` button, and the `Esc` key (and `Esc` does NOT also stop the trace while the popup is open).

- [ ] **Step 4: Verify auto-close on scope exit**

Open the popup while inside the function that owns the pq, then step until that function returns. Confirm the popup closes itself when `minHeap` leaves scope. Also confirm re-tracing (Visualize again) with the popup open starts cleanly with no popup.

- [ ] **Step 5: Spot-check a nested payload**

Trace a `priority_queue<pair<int,int>>` example, open its popup, and confirm each node renders the nested pair and nodes don't overlap (panel scrolls if wide).

- [ ] **Step 6: Commit any fixups**

If Steps 3–5 surfaced CSS/layout fixes, apply them, re-run `npm run build && npm test`, and commit:

```bash
git add -A
git commit -m "fix(viz): heap popup polish from end-to-end check"
```

---

## Self-Review Notes

- **Spec coverage:** Decision 1 (replace inline) → Task 4 (removes body-branch, header opens popup). Decision 2 (live update + auto-close) → Task 4 Step 4f/4g (per-render `findCellById` + auto-close effect) + Task 5 Steps 3-4. Decision 3 (no external connectors) → satisfied by construction (overlay hosts only `HeapTreePanel`; `Connectors` stays in the flat view, untouched). Keymap/Escape integration → Task 1 + Task 4 Step 5d. State lifted to App → Task 4 Step 5. `findCellById` → Task 2. Overlay component + CSS → Task 3. Test rewrites of the Task-5-inline cases → Task 4 Step 1. All spec sections mapped.
- **Type consistency:** `onHeapOpen: (cellId: string) => void`, `activeHeapCell: string | null`, `onHeapClose: () => void`, `heapOpen: boolean`, `"closeHeap"`, `findCellById(cells, id)`, `HeapTreeOverlay({cell, step, onClose, ...})` used identically across tasks. Old `heapViews`/`onHeapToggle`/`toggleHeap` fully removed in Task 4 (grep gates in Steps 3f and 4).
- **Green at every commit:** Tasks 1-3 are additive/standalone (build stays green — the overlay is unmounted until Task 4). Task 4 renames the prop across `MemoryCell`, `MemoryView`, and `App` in one commit, so there is no intermediate build with a half-renamed prop.
- **Diff rule:** node cells reuse the pq's existing logical child ids, so `changedIds`/`highlightedIds` passed into the overlay tint only the changed node — no new logic.
