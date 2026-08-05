# A3 — Heap-as-Tree Design

**Roadmap phase:** A3 (after A1 weighted, A2 edge-list — both shipped). Renders a
`priority_queue` backing array as a binary-heap tree (parent index `i` →
children `2i+1`, `2i+2`), introducing an array→tree layout that Family B (B1
trees) later reuses.

**Goal:** For pure-heap programs (top-k, kth-largest, heapsort-via-pq), draw the
`priority_queue`'s heap array as a binary tree so a learner can watch it reorder
across steps — instead of the current behavior (a bare `priority_queue`
container with no graph view, or, in a graph program, its existing role as a
frontier overlay).

## Scope

**In:**
- Detect `priority_queue<int>` and `priority_queue<pair<int,int>>` backing
  vectors as a heap array and render as a binary tree.
- Node label: `pq<int>` → the int; `pq<pair>` → `{a,b}` (both elements).
- Plain 1px parent→child edges (no arrowheads).
- Change highlight via the existing `bindFlash` (nodes whose value changed
  between steps flash — free sift feedback on push/pop).
- New `GraphScene.kind` `"tree"` + a reusable array/edge→tree layout.

**Out (deferred, each its own follow-up):**
- **Manual-map control** ("visualize as graph? map it yourself") — a
  cross-cutting GraphPanel control over ALL container types; its own spec→plan.
- Raw `vector<int>` heaps via `make_heap`/`push_heap` (ambiguous with any int
  vector — belongs to manual-map).
- Dedicated sift-path highlight (tracing the exact swap chain). `bindFlash`
  covers the changed-node feedback; a swap-path tracer is a richer follow-up.
- Min/max comparator inference — unnecessary. The tree mirrors array order
  top-down; the root is `array[0]` regardless of `less`/`greater`.
- B1 sparse tidy-tree layout — A3's heap is (near-)complete; B1's sparse
  `Node*{left,right}` trees may need a tidier algorithm. A3's layout derives
  structure generically from edges so B1 can extend rather than replace it.

## Architecture

Two pure functions in `frontend/src/viz/graph/graphModel.ts` (mirroring the
A1/A2 reader+scene pairs), one new layout branch in `graphLayout.ts`, and a
render branch in `GraphPanel.tsx`. `graphModel.ts` and `graphLayout.ts` stay
pure (no React/DOM) — the existing invariant.

### 1. Detection — `readHeap` + `heapScene` (graphModel.ts)

```ts
export interface HeapNode { label: string }

/** priority_queue backing vector as a heap array. pq<int> → int labels;
 *  pq<pair<int,int>> → "{a,b}" labels. Null for non-pq / empty / mixed. */
export function readHeap(cell: NormalizedCell): HeapNode[] | null;
```

- Gate: `(cell.containerKind ?? "").toLowerCase().includes("priority_queue")`.
- Skip if `cell.placeholders` (partial/old trace).
- Empty children → null.
- Each child either a scalar int (`isIntLabel`) → `label = displayValue`, OR a
  2-child pair whose two children are scalar ints → `label = "{a,b}"`. Any other
  child shape → null (the whole container is rejected — no partial heaps).

```ts
function heapScene(nodes: HeapNode[]): GraphScene;
```

- Node `i` → `{ id: String(i), label: nodes[i].label }`.
- Edge for every `i > 0`: `{ from: String(floor((i-1)/2)), to: String(i),
  directed: false }`.
- Returns `{ kind: "tree", nodes, edges, overlays: emptyOverlays() }`.

### 2. Ordering — `buildGraphScene`

Insert a new block **after** the `readMatrix` loop (the final, lowest-priority
detector). Heap-tree is primary only when no graph detector matched:

```ts
  // Heap-as-tree — lowest priority, after every graph detector. A dijkstra pq
  // sits inside a graph program, so a matrix/adjlist/edge-list scene already
  // returned above and the pq stays a frontier overlay (bindFrontier). Only a
  // pure-heap program (no graph container) reaches here.
  if (viewAs !== "grid") {
    for (const c of findContainers(mem)) {
      const h = readHeap(c);
      if (h && h.length > 0) return finish(heapScene(h));
    }
  }
```

`finish` runs all binders. For a `kind:"tree"` scene the graph-only binders are
no-ops or skipped (see §4); `bindFlash` applies.

### 3. Layout — `layoutScene` `"tree"` branch (graphLayout.ts)

Add `"tree"` to `GraphKind` (graphModel.ts) and `"tree"` to `Layout.mode`.

The `"tree"` branch derives tree structure from `scene.edges`
(parent→child) — NOT from heap array math — so B1 (pointer trees) reuses it
unchanged:

- Build a child-map from edges: `from` → `[to, ...]` (in edge order).
- Root = the single node id that never appears as any edge's `to`. (For a heap
  that is node `"0"`.)
- Assign depth by BFS/DFS from root. `y = depth / max(1, maxDepth)`.
- Within each depth level, spread nodes evenly across width by their
  left-to-right order: for the `k`-th of `m` nodes at that level,
  `x = m === 1 ? 0.5 : k / (m - 1)`. Handles a partial last level (heap not a
  full power-of-two) because it spreads the *actual* occupancy, not `2^depth`.
- Returns `{ placed, mode: "tree" }`.

Single-node heap (root only, no edges): root at `{0.5, 0.5}`.

### 4. Render — `GraphPanel.tsx` + `index.css`

- `scene.kind === "tree"`: render circle nodes (reuse the non-grid circle
  branch) with the `{a,b}`/int label centered in 12px mono.
- Edges: when `scene.kind === "tree"`, draw plain `<line>` with class
  `graph-edge` (existing 1px style), **no `markerEnd`, no trim** — parent→child
  is structural, direction implied top-down.
- Overlays for tree scenes: only `is-flashed` is meaningful. **`bindFrontier`
  matches `containerKind.includes("queue")` — `priority_queue` matches — so on a
  heap-tree scene it WOULD add the pq's own elements as a frontier overlay and
  wrongly tint heap nodes.** Gate it: `bindFrontier` returns early when
  `scene.kind === "tree"`. `bindVisited`/`bindCurrent`/`bindOrder`/`bindDist`
  are inert on pure-heap memory (no over-graph frontier, no dist vector), but
  gate any that a test shows firing. The heap integration test asserts a tree
  scene carries no frontier/visited ids.
- No new detail panel: the existing click-inspect line (`node {id} — inspected
  at step {step}`) covers reading a node; the `{a,b}` label already shows both
  pair elements.
- `index.css`: no new rule expected (reuses `.graph-edge` + `.graph-node`); add
  one only if the tree needs a spacing/label tweak found during implementation.

## Data Flow

`ExecPoint` → `normalizeMemory` → `buildGraphScene`: graph detectors run first
(unchanged); if none match, `readHeap` finds the pq container → `heapScene`
builds `{kind:"tree", nodes, edges}` → `finish` binds flash → `layoutScene`
tree branch places nodes from edges → `GraphPanel` draws circles + plain lines.

## Testing

`frontend/tests/graph/`:

- **`graphModel.heap.test.ts`** (new):
  - `readHeap` reads `pq<int>` children as int labels.
  - `readHeap` reads `pq<pair<int,int>>` as `{a,b}` labels.
  - `readHeap` returns null for: non-pq container, empty pq, mixed/other child
    shape, `placeholders` set.
  - `heapScene` builds parent→child edges (`i>0` → `floor((i-1)/2)`), node ids
    `0..n-1`, all `directed:false`, `kind:"tree"`.
  - `buildGraphScene` integration on the new fixture: heap is primary scene when
    no graph container present.
  - Regression: a memory with BOTH a graph (adjlist/matrix) and a pq still
    returns the graph scene with the pq as a frontier overlay (heap block never
    reached) — guards the ordering decision.
- **`graphLayout.test.ts`** (extend): tree layout — root at top (`y≈0`),
  children below their parent, complete tree spreads evenly, partial last level
  spreads by actual occupancy, single-node heap centered, no NaN.
- **`GraphPanel.test.tsx`** (extend): a `kind:"tree"` scene renders circles +
  plain `line.graph-edge` with NO `marker-end` attribute; label text present.
- **Fixture** (new, real backend trace — never hand-edited): a small `pq<int>`
  program (top-k or heapsort-via-pq) with several push/pop steps so the tree
  reorders and `bindFlash` has something to highlight. Regenerate via the
  backend, commit under `frontend/tests/fixtures/graph/`.

## Global Constraints

- No new frontend dependencies.
- `graphModel.ts` and `graphLayout.ts` stay pure (no React/DOM).
- TDD: failing test → watch it fail → minimal implementation → pass → commit.
  One logical change per commit. Run frontend commands from `frontend/`.
- Fixtures are real backend traces; regenerate, never hand-edit.
- Existing matrix/adjlist/edge-list/grid detection and overlay behavior stay
  unchanged (regression-guarded in the heap integration test).
