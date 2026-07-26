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
- Node horizontal position: **fixed per-row slot grid.** A node's slot within its
  row is `slot = index - (2^row - 1)`; its center is `col = (slot + 0.5) / 2^row`
  in `[0,1]`. For a complete binary tree this positions each parent exactly over
  the midpoint of its two children (provable: parent `(s+0.5)/2^r` equals the mean
  of children slots `2s,2s+1` at row `r+1`). No leaf-span computation, no DOM
  measurement — purely index math.
- Edges: for each index `i > 0`, edge `{ parent: floor((i-1)/2), child: i }`.

Empty input → `{ nodes: [], edges: [], rows: 0 }`.

### 3. Render — new component `viz/stl/HeapTreePanel.tsx`

Mirrors `dp/DpTablePanel.tsx`: an alternate render for one cell, with a toggle
back to the default view.

- Container is `position: relative`. Nodes are absolutely positioned:
  `left: col * gridWidth` (centered via `translateX(-50%)`), `top: row * rowHeight`.
  Each node renders via `<MemoryCell>` so any payload looks identical to the array
  view. `gridWidth = 2^(rows-1) * slotWidth` (slots in the widest row) so leaves
  never collide; `slotWidth` is a fixed mono-friendly width. Panel wraps in an
  `overflow-x: auto` box (repo rule) so a wide bottom row scrolls rather than
  pushing the page.
- **Payload variety.** Nodes carry whatever the element type decodes to: scalar,
  `pair`/`tuple`, `string`, `vector`, or a user struct/container. Because each
  node is a real `<MemoryCell>`, nested containers, the char-view toggle on a
  `string`/`vector<string>` node, and pointer ports all keep working inside the
  tree. A tall payload (multi-line struct) sets that row's height via
  `rowHeight = max node height`, measured once per render like the array grid —
  edges attach to the node box top/bottom centers, which stay on the slot `col`
  regardless of node width.
- Edges: one inline `<svg>` layer behind the nodes, sized to the panel. Horizontal
  endpoints come straight from the pure `col` math (no measurement); vertical
  endpoints use `row * rowHeight`, where `rowHeight` is the tallest node in the
  render (the only measured quantity — the horizontal layout never depends on node
  width). No global Connectors overlay / cross-cell ResizeObserver involved. Lines
  use `var(--blue)`, 1px, matching the connector look.
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
- **Nested placement.** `MemoryCell` is recursive and `heapViews`/`onHeapToggle`
  thread through every section and every child (exactly like `onCharViewToggle`),
  so the `⇄ tree` button and tree view work whether the pq is a global, a local,
  a heap object, or nested inside another container (`vector<priority_queue<…>>`,
  a `map` value, etc.). No special-casing per location.

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
- Payload variety: layout/render over pq elements of `int`, `pair<int,int>`,
  `pair<int,pair<int,int>>` (kClosest), `string`, and `vector<int>` — each node
  emits the element's normal decoded cell; slot `col` unaffected by node width.
- Empty pq (size 0) → empty layout, no edges, badge still shown.

## Aesthetic

Dotted-box nodes, 12px mono, square corners. Edges 1px `--blue`. Top node
`--yellow`. Badge is a small mono chip in the header. Default remains the flat
array — the tree is opt-in per container, consistent with the char-view and DP
toggles.
