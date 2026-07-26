# priority_queue heap-tree view

## Goal

Showcase `std::priority_queue` as an actual binary heap. Today it renders as the
flat backing array (`[0]…[n-1]`) with the note "heap; top = [0]". That is
correct but hides the structure that makes a heap a heap. Add an opt-in tree view
that draws the array as a binary tree by index, labels it min-heap vs max-heap
from the comparator, and highlights the top node.

Target code — LeetCode-style heap problems:

```cpp
priority_queue<int, vector<int>, greater<int>> minHeap;              // min-heap
priority_queue<int, vector<int>, less<int>>    maxHeap;              // max-heap
priority_queue<pair<int,pair<int,int>>, vector<...>, less<...>> pq;  // nested payload
```

## Non-goals

- No change to the tracer or trace format. This is a pure frontend decode/render
  feature over children that are already present.
- No animation of sift-up/sift-down. The tree re-lays-out per step like every
  other cell; the VCR drives time.
- No new dependencies (React + CodeMirror + plain CSS/SVG only).

## Design

### 1. Comparator parsing — `adaptor.ts`

`priorityQueueDecoder` already has the full type string, e.g.
`priority_queue<int, vector<int>, greater<int> >`. Parse the **third** template
argument:

- matches `std::greater<…>` → `heapKind: "min"` (top is the smallest element)
- matches `std::less<…>`, or no third arg (default is `less`) → `heapKind: "max"`
- anything else (custom comparator) → `heapKind: "custom"`

**Custom comparators** we cannot classify statically. These arrive as:
- a named functor type — `priority_queue<T, vector<T>, MyCmp>`
- a lambda captured via `decltype` — `priority_queue<T, vector<T>, decltype(cmp)>`
- `std::function<bool(T,T)>`

For `"custom"`: do NOT claim a direction. Badge reads `heap` (optionally
`heap · <CmpName>` when a short comparator type name is available), and the
invariant note omits the `parent ≤/≥ children` claim. Everything else still
works — the top node is `top()` regardless of comparator, so it stays tinted,
and the tree shape is unchanged (it is derived from array index, not from the
comparator).

Store `heapKind: "min" | "max" | "custom"` on the returned container cell. The
existing `note`/`displayValue` stay for min/max. This is a pure string parse;
guard against the comparator itself containing angle brackets (`greater<pair<…>>`,
`decltype([](…){})`) by scanning the **top-level** template args — extend the
`templateArg` helper in `helpers.ts` to split all top-level args rather than
just the first, respecting `<>` and `()` nesting depth.

Add `heapKind?: "min" | "max" | "custom"` to `NormalizedCell`.

### 2. Tree layout — new pure module `viz/stl/heapTree.ts`

No React, no DOM (sibling of `connectorGeometry.ts`). Unit tested.

```ts
export interface HeapNode { cell: NormalizedCell; index: number; row: number; col: number; }
export interface HeapEdge { parent: number; child: number; } // by array index
export interface HeapLayout { nodes: HeapNode[]; edges: HeapEdge[]; rows: number; }

export function buildHeapLayout(children: NormalizedCell[]): HeapLayout;
```

- `row = floor(log2(index + 1))`.
- Node horizontal position: assign each node a fractional slot so that a parent
  sits centered over its children. Compute leaf order left-to-right, then place
  internal nodes at the midpoint of their subtree span. Output normalized `col`
  in `[0,1]` per node so the renderer can position with percentages (resolution-
  independent, no measurement needed).
- Edges: for each index `i > 0`, edge `{ parent: floor((i-1)/2), child: i }`.

Empty input → `{ nodes: [], edges: [], rows: 0 }`.

### 3. Render — new component `viz/stl/HeapTreePanel.tsx`

Mirrors `dp/DpTablePanel.tsx`: an alternate render for one cell, with a toggle
back to the default view.

- Container is `position: relative`. Nodes are absolutely positioned by
  `left: col%`, `top: row * rowHeight`. Each node renders via `<MemoryCell>` so
  nested payloads (pairs, structs) look identical to the array view.
- Edges: one inline `<svg>` layer behind the nodes, sized to the panel. Because
  `col`/`row` are known up front, edge endpoints are computed from the same
  layout math — **no DOM measurement / ResizeObserver needed** (unlike the global
  Connectors overlay). Lines use `var(--blue)`, 1px, matching the connector look.
- The top node (`index 0`) is tinted `var(--yellow)` — it is the value the
  algorithm reads (`top()`), true for every comparator. Header badge shows
  `min-heap` / `max-heap` / `heap` per `heapKind`.
- Header carries the toggle button `⇄ array` to return to the flat view.

### 4. Toggle wiring

Follows the char-view toggle exactly (a `Set<cellId>`, not a per-cell view map):

- `MemoryView.tsx` holds `treeViews: Set<string>` + `toggleHeapView(id)`, threaded
  down beside `onCharViewToggle` as `heapViews`/`onHeapToggle`.
- `MemoryCell.tsx`: the `⇄ tree` / `⇄ array` header button appears only when
  `cell.containerKind === "priority_queue"`. When the cell id is in `heapViews`,
  render `<HeapTreePanel>` instead of the default `<Children>`; otherwise render
  as today (flat array, unchanged default).
- Badge (`min-heap`/`max-heap`/`heap`) shows in the header in BOTH views, driven
  by `cell.heapKind`.

### 5. Diff / highlight

Container highlight rule holds unchanged: node cells reuse the same logical child
IDs as the array view, so `changedIds` tints only the changed node box, and
`highlightedIds` works as-is. The top-node yellow tint is layered under the
current-value highlight (highlight wins). If the pq's own summary changes, tint
only the header, never the whole tree body.

## Files touched

- `viz/stl/helpers.ts` — top-level template-arg splitter (extend/keep `templateArg`).
- `viz/stl/adaptor.ts` — parse comparator → `heapKind` in `priorityQueueDecoder`.
- `viz/memoryModel.ts` — add `heapKind?` to `NormalizedCell`.
- `viz/stl/heapTree.ts` — NEW, pure layout.
- `viz/stl/HeapTreePanel.tsx` — NEW, render.
- `viz/MemoryCell.tsx` — toggle button + branch to panel.
- `viz/MemoryView.tsx` — `treeViews` state + threading.
- `index.css` — heap panel + badge + node positioning styles.

## Tests (TDD, one logical change per commit)

- `tests/stl/adaptor.test.ts` (or new) — comparator → `heapKind`: `greater` ⇒ min,
  `less` ⇒ max, default (2-arg) ⇒ max, custom functor / `decltype(lambda)` /
  `std::function` ⇒ custom; comparator with nested `<>` or `()` parsed correctly
  (top-level split respects nesting depth).
- `tests/stl/heapTree.test.ts` — NEW: index→row/edge math; parent centered over
  children; empty input; single node; full and partial last row.
- Render/toggle behavior covered by an existing component test pattern if present,
  else a focused test that `HeapTreePanel` emits N node cells + correct edge count.

## Aesthetic

Dotted-box nodes, 12px mono, square corners. Edges 1px `--blue`. Top node
`--yellow`. Badge is a small mono chip in the header. Default remains the flat
array — the tree is opt-in per container, consistent with the char-view and DP
toggles.
