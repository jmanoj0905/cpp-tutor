# A2 — Edge-List Detection (design)

Part of the graph-viz roadmap (`graph-viz-roadmap.md`). Follows A1 (weighted
graphs, shipped `b29a59a` on main). Adds detection + rendering for
**edge-list** graph inputs, which the current pipeline either ignores (flat
`vector<pair>`) or mis-renders as an adjacency list (`vector<vector<int>>`
where each row is one `{u,v}` / `{u,v,w}` edge).

## Problem

`buildGraphScene` reads a `vector<vector<int>>` as an adjacency list: row `i` =
neighbors of node `i`. An **edge list** has the same C++ type but different
meaning: each row is a single edge `{u, v}` (or `{u, v, w}` weighted), and the
outer length is the edge count, not the node count. Placement-prep samples use
this shape directly:

- `validTree(int n, vector<vector<int>>& edges)` — rows `{u,v}`, `n` separate.
- `networkDelayTime(vector<vector<int>>& times, int n, int k)` — rows `{u,v,w}`.
- `prerequisites` — rows `{course, dep}` (directed).

Flat `vector<pair<int,int>>` edge lists currently produce **no scene at all**
(`readMatrix` rejects pair rows).

## Approach

Inline readers in `graphModel.ts`, mirroring the A1 `readWeightedAdjList` /
`weightedAdjListScene` pair. Keeps all detection pure and in one file, reuses
A1 weight labels + overlays. No new module, no new dependency.

Rejected alternative: a separate `edgeList.ts` module — more files, no benefit
at this size.

## Design

### 1. Detection — `readEdgeList(cell, mem): Edge[] | null`

`Edge = { u: number; v: number; weight?: number }`.

Accepts these cell shapes, each row/element yielding one edge:

| Shape | Edge |
|---|---|
| `vector<vector<int>>`, every row length 2 or 3 | `{u,v}` / `{u,v,w}` |
| flat `vector<pair<int,int>>` | `{u,v}` |
| `vector<array<int,3>>` / `vector<tuple<int,int,int>>` | `{u,v,w}` |
| `vector<pair<int,pair<int,int>>>` (`{w,{u,v}}`) | reorder → `{u,v,w}` |

Guards (reject non-edges):

- The `vector<vector<int>>` form requires a **name match**
  `/edges?|edgelist|times|prerequisites|adj_?edges|^e$/i` on the container name.
  Without it the container stays an adjacency list (preserves current behavior
  for `adj`, `graph`, etc.).
- The flat forms (`pair` / `array` / `tuple` / nested pair): reject when the
  container name matches `/dir|delta|move|offset|step/i` **or** any endpoint
  `u`/`v` is negative. This kills `dirs` / `directions` movement-vector false
  positives (e.g. `{{0,1},{1,0},{-1,0},{0,-1}}`).
- All endpoints (`u`, `v`) must be non-negative integers. Weight may be
  negative (negative-weight edges are valid).
- Empty outer vector → `null`.

The `vector<vector<int>>` shape is the only one gated on name (it collides with
adjacency lists). The dedicated pair/array/tuple shapes are structurally
unambiguous, so they need only the movement-vector guard, not a positive name
match. As an unnamed fallback for `vector<vector<int>>` we may still treat it as
an edge list when an endpoint id exceeds the outer length (can't be an adjlist
index) — implement only if a real sample needs it; **not** required for A2.

### 2. Node set — `edgeListScene(edges, mem): GraphScene`

- `maxId = max over all edges of max(u, v)`.
- Base nodes: `0 .. maxId`.
- Scan globals + all frames for a scalar named `/^(n|v|numnodes|nodes|vertices)$/i`
  with an integer value `> maxId`; if found, extend the node range to that
  count so isolated nodes (no incident edge) appear. Matches samples that pass
  `n` separately.
- Nodes carry no `row`/`col` → force graph layout, never grid.

### 3. Scene + rendering

- One `GraphEdge { from, to, directed: true, weight? }` per edge; `weight` set
  only for the 3-field shapes. `dangling: true` if an endpoint falls outside the
  node range (defensive; normally unreachable since `maxId` derives from the
  edges).
- **Arrowheads (new):** `GraphPanel` SVG gains an `<marker>` arrowhead applied
  to every `directed: true` edge. This is the arrowhead work A1 deferred; it
  applies to edge-list edges **and** existing directed matrix/adjlist edges
  (they already carry `directed: true`).
- Weight labels + per-node dist badges: reuse A1 rendering unchanged.
- Overlays (`visited` / `frontier` / `current` / `order` / `dist`): reuse the
  existing binders unchanged — they key on node-id strings, which edge-list
  node ids already are.

### 4. Ordering in `buildGraphScene`

Insert the edge-list check **after** the weighted-adjacency-list check and
**before** the `readMatrix` matrix/adjlist block:

```
weighted adjlist (vector<vector<pair>>, 2 levels)   [A1, unchanged]
edge list        (readEdgeList over all containers) [A2, new]
readMatrix block (matrix / adjlist / grid)          [existing]
```

So `vector<vector<int>> edges` no longer falls through to `adjlistScene`. The
weighted-adjlist form (`vector<vector<pair>>`, two nesting levels) stays
distinct from a flat edge-pair list (`vector<pair>`, one level).

`viewAs === "grid"` still forces grid and skips edge-list detection (an
edge-list has no grid reading).

## Testing (TDD)

New `frontend/tests/graph/graphModel.edgelist.test.ts`:

- each accepted shape → correct `edges` (from/to, directed, weight).
- name guard: unnamed `vector<vector<int>>` with all-len-2 rows stays adjlist.
- movement-vector guard: `dirs` / negative-pair vector rejected.
- weighted `{u,v,w}` (and `{w,{u,v}}` reorder) carries the right weight.
- `n`-scalar extends the node set beyond `maxId` (isolated node appears).
- edge-list edges are `directed: true`.

`frontend/tests/graph/GraphPanel.test.tsx`: assert the arrowhead `<marker>` is
present and referenced by directed edges.

Regenerate any affected fixtures from real backend traces rather than
hand-editing (per repo convention).

## Out of scope (deferred)

- Undirected inference (collapsing symmetric `{u,v}`+`{v,u}` to one line) — A2
  renders all edge-list edges directed.
- Adjacency-matrix-with-weights and weighted-adjlist detection — shipped in A1.
- Heap-as-tree — A3.
- The unnamed `vector<vector<int>>` value-range fallback (endpoint id exceeds
  outer length) — implement only if a real sample demands it.
