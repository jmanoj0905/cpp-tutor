# priority_queue Heap-Tree Popup — Design

**Goal:** Move the `std::priority_queue` binary-heap-tree view out of the inline stack cell body and into a modal popup, so the pq cell stays a compact array in the stack and the tree gets its own focused, roomy inspection surface.

**Problem today:** The tree renders inline inside the pq cell body when `heapViews.has(cell.id)` (Task-5 body-branch in `MemoryCell.tsx`). A wide tree stuffed into a stack box distorts the memory layout.

## Decisions (locked in brainstorming)

1. **Replace, not coexist.** The inline tree view is removed. The `⇄ tree` header button opens a popup instead of flipping an inline body.
2. **Live update.** While the popup is open, stepping the VCR re-derives the tree from the current step; push/pop animate. The popup auto-closes if the pq leaves scope (its frame returns).
3. **No external connectors in the popup.** Only the internal blue heap edges (drawn by `HeapTreePanel`'s own SVG) show. External pointer lines from the memory-view `Connectors` overlay are not routed into the modal (pq-internal-buffer pointers are effectively never taken in real C++, and the overlay measures DOM rects in the flat memory view).

## Architecture

Single active popup at a time, keyed by the pq cell's stable id, re-resolved against the live normalized memory each step.

### State — lifted to `App.tsx`

Replace the `heapViews: Set<string>` model with a single-selection model:

- `const [activeHeapCell, setActiveHeapCell] = useState<string | null>(null)`.
- Passed down to `MemoryView` as: `activeHeapCell`, `onHeapOpen: (id) => setActiveHeapCell(id)`, `onHeapClose: () => setActiveHeapCell(null)`.

**Why App and not MemoryView:** the app routes all keyboard handling through the centralized `shortcuts/keymap.ts`, whose Escape branch is context-driven (`ctx.helpOpen → "closeHelp"`). To let Escape close the heap popup the same way, the keymap context needs `heapOpen`, which means the state lives at App level (mirroring `helpOpen`). The overlay itself still renders inside `MemoryView` (that is where the id→cell lookup lives — see Data flow).

### Keymap (`shortcuts/keymap.ts` + `App.tsx`)

Mirror the existing help wiring exactly:

- `KeymapContext` gains `heapOpen: boolean`.
- Action union gains `"closeHeap"`.
- Escape branch: when `ctx.heapOpen`, return `"closeHeap"` (order it consistently with `closeHelp` — help closes first if somehow both are open; only one modal is expected at a time).
- `App` passes `heapOpen: activeHeapCell !== null` into the keymap context and maps the `closeHeap` action to `onHeapClose`.

### Trigger (`MemoryCell.tsx`)

- The pq header `⇄ tree` button calls `onHeapOpen(cell.id)`. Label is always `⇄ tree` (the `⇄ array` toggled-state label is gone — the popup owns its own close).
- **Remove the inline body-branch entirely.** A pq cell always renders its compact flat-array `Children` in the stack box. There is no `heapViews.has(cell.id)` conditional in the body anymore.
- Props change: `heapViews?: Set<string>` + `onHeapToggle?` are replaced by a single `onHeapOpen?: (cellId: string) => void`. Only the pq header reads it; it is still threaded through the recursive `MemoryCell`/`Children` calls exactly like `onCharViewToggle`, but the threading surface shrinks (no `heapViews` set to carry).
- The min/max/heap badge in the header is unchanged.

### Overlay (new `frontend/src/viz/stl/HeapTreeOverlay.tsx`)

Mirrors `shortcuts/HelpOverlay.tsx`:

- Backdrop `div` (fixed, `inset: 0`, high z-index) with `onClick={onClose}`.
- Inner panel with `role="dialog"`, `aria-label`, and `onClick={(e) => e.stopPropagation()}` so clicks inside don't close it.
- Header row: the container's display name + the min/max/heap badge (same text logic as the cell header: `min`→`min-heap`, `max`→`max-heap`, else `heap`) + a `step N` label (matches the app convention that detail panels mention step numbers) + a `×` close button.
- Body: reuses **`HeapTreePanel` unchanged**, passing the live cell plus `highlightedIds` / `changedIds` / `onCharViewToggle` so per-node diff tint and the nested char-view toggle keep working.
- Escape is handled globally via the keymap (no local listener), keeping all keyboard handling in one module.

Props:

```ts
export function HeapTreeOverlay(props: {
  cell: NormalizedCell;         // the live pq cell for the current step
  step: number;                 // current step index, for the "step N" label
  onClose: () => void;
  highlightedIds?: Set<string>;
  changedIds?: Set<string>;
  onCharViewToggle?: (cellId: string) => void;
}): JSX.Element;
```

### Data flow (`MemoryView.tsx`)

`MemoryView` already computes the normalized memory for the current step and renders globals/frames/heap. Add:

1. A pure recursive helper `findCellById(cells, id): NormalizedCell | null` that walks each cell's `children` (containers nest). Search roots = globals ∪ all frame cells ∪ heap.
2. Each render, if `activeHeapCell` is set, look it up: `const heapCell = activeHeapCell ? findCellById(roots, activeHeapCell) : null`.
3. If `activeHeapCell` is set but `heapCell` is `null` (pq went out of scope), call `onHeapClose()` from a `useEffect` keyed on `[activeHeapCell, heapCell]`. Do not call during render.
4. When `heapCell` is non-null, render `<HeapTreeOverlay cell={heapCell} step={step} onClose={onHeapClose} ... />`. `MemoryView` must receive the current `step` index (add a prop if not already passed) for the label.

Stepping the VCR → App re-renders `MemoryView` with the new point → `findCellById` returns the pq at the new step → `HeapTreePanel` re-lays-out. Live update falls out of the render cycle; no snapshot, no manual sync.

**Guard:** if the resolved `heapCell` is not actually a priority_queue (`containerKind !== "priority_queue"`) — e.g. an id collision after a re-trace — treat it as not found and auto-close.

## Aesthetic

Bauhaus, reusing existing tokens: dotted boxes, square corners, 12px mono, colors only from CSS vars. Top node keeps its `--yellow` tint (via existing `.heap-node-top`). Add `.heap-overlay-*` classes mirroring the `.help-*` rules (`.help-backdrop`/`.help-panel`/`.help-head`/`.help-close`) — same backdrop dimming, same panel border/close-button treatment. The panel is sized to the tree with horizontal scroll for wide heaps (`HeapTreePanel` already scrolls via `.heap-tree-scroll`).

## Testing

TDD, one logical change per commit, per repo convention.

**New `frontend/tests/stl/HeapTreeOverlay.test.tsx`:**
- Renders the heap tree for a given pq cell (delegates to `HeapTreePanel` — assert nodes/edges present).
- Backdrop click fires `onClose`; clicking inside the panel does NOT.
- `×` button fires `onClose`.
- Header shows the correct badge text (`min-heap` for a `greater<>` cell) and a `step N` label.

**`MemoryView` integration (extend existing MemoryView tests or add a focused test):**
- Clicking a pq cell's `⇄ tree` button calls `onHeapOpen` with that cell's id.
- With `activeHeapCell` set to a live pq id, the overlay renders with the resolved cell.
- With `activeHeapCell` set to an id absent from the current memory, `onHeapClose` is called (auto-close) and no overlay renders.
- A pq cell body no longer contains an inline heap tree (`[data-heap-tree]` absent from the stack section).

**Keymap unit test (`shortcuts/keymap` test, if present):**
- Escape with `heapOpen: true` returns `"closeHeap"`.

**Rewrite in `frontend/tests/stl/HeapTreePanel.test.tsx`:**
- The Task-5 inline cases assert the removed body-branch: "renders the tree body (and a `⇄ array` button) when the toggle is on", "renders the flat array body when the toggle is off", and the `⇄ tree` fires-`onHeapToggle` case. Replace them: `⇄ tree` now fires `onHeapOpen`; there is no `⇄ array` state; the pq body is always the flat array. `HeapTreePanel`'s own rendering tests (node/edge counts, top-node marker) stay unchanged — the component is reused as-is.

## Out of scope

- No change to `HeapTreePanel.tsx`, `heapTree.ts`, `adaptor.ts` (`classifyHeap`/`heapKind`), or `helpers.ts` (`topLevelTemplateArgs`). The popup is a re-hosting of the existing tree, not a re-implementation.
- No external pointer connectors into the modal (Decision 3).
- No multi-popup / side-by-side heaps.
- No tracer or trace-format change.
