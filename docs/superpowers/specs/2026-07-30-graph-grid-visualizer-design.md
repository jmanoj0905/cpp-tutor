# Graph & Grid Visualizer Panel — Design

Date: 2026-07-30

## Goal

Help students visualize graph algorithms (DFS, BFS, flood fill, islands, rotting
oranges) by drawing the graph/grid they wrote as a node-link diagram or colored
grid, and painting live algorithm state onto it as they step through the trace.

Today cpp-tutor draws raw memory cells + pointer lines. Students think in
node-link diagrams and colored grids, not nested `vector<vector<int>>` boxes.
This panel closes that gap.

## Source material

Real student code shapes (from `Leet-Code/Placement_prep/11-graphs`):

- **Adjacency list**: `vector<vector<int>> graph`, index = node, values =
  neighbors. `vector<bool> visited` + recursion (DFS) or `queue<int>` (BFS).
  (`dfs_list.cpp`, `graphDFS_LIST.cpp`)
- **Adjacency matrix**: `vector<vector<int>>` N×N of 0/1. (`graphs.cpp`)
- **Grid / 2D**: `vector<vector<char|int>>`, in-place marking + `queue<pair<int,int>>`.
  (`noOfIslands.cpp`, `rottingOrangeSolved.cpp`, `floodFill.cpp`)

## Architecture

Pure / geometry / render split, mirroring the existing memory pipeline
(`memoryModel.ts` / `connectorGeometry.ts` / `MemoryView.tsx`):

- `viz/graph/graphModel.ts` — **pure**, no React/DOM.
  `buildGraphScene(mem, prevMem, trace, index) -> GraphScene | null`.
  Input is the already-decoded `NormalizedMemory` from `normalizeMemory`.
- `viz/graph/graphLayout.ts` — **pure**. Circular coords (adjacency) or row/col
  coords (grid).
- `viz/graph/GraphPanel.tsx` — always-on side pane; self-hides when scene is null.

`GraphScene`:

```
GraphScene = {
  kind: "adjlist" | "matrix" | "grid",
  nodes: GraphNode[],            // id, label, x, y (or row/col for grid)
  edges: GraphEdge[],            // from, to, directed, dangling?
  overlays: {
    visited: Set<nodeId>,
    current: nodeId[],           // top frame first; full recursion path
    frontier: Set<nodeId>,       // queue / stack contents
    order: Map<nodeId, number>,  // visit-order badge number
    flashed: Set<nodeId>,        // grid cells changed this step
  }
}
```

Panel inputs match `CallLogPanel`: `point`, `prevPoint`, `index`, `trace.trace`
(see `App.tsx`). Pure files get unit tests (TDD), per repo convention.

## Detection (auto, shape + name bias)

Priority order, per step:

1. **Grid** if `vector<vector<char>>`, OR rectangular int matrix that fails the
   adjacency test / is name-hinted `grid|board|matrix`.
2. **Adjacency matrix** if square N×N, all entries 0/1, and no grid signal.
3. **Adjacency list** = any other `vector<vector<int>>`; edges = `graph[i]` values.
4. **visited** = `vector<bool|int>` with length == node count (or grid dims).
   Name bias `visited|seen|vis`.
5. **frontier** = live `queue<int>` / `queue<pair>` / `stack<int>`. Name bias
   `q|queue|st|frontier`.
6. **current** = int scalar arg(s) of top user frame (`node|curr|n`; pair
   `i,j`/`r,c` for grid).

Best-effort heuristic. Mis-guess degrades gracefully (draw graph, drop overlay);
never crashes.

## Overlays

Theme vars only (`--yellow` current, `--blue` frontier, `--red` error, dimming
for not-yet-visited):

- **Visited** — dim → solid when `visited[i]` true.
- **Current** — `--yellow` fill on current node/cell.
- **Frontier** — `--blue` ring on nodes/cells in the queue/stack.
- **Visit-order badge** — small mono number in corner, assigned the step a node
  first goes visited.
- **Mutation flash (grid)** — cell recolors the step its value flips.
- **Recursion path** — bold edges through every node arg on the frame stack
  (free: `mem.frames` is an array).

## Layout

- Adjacency: circular ring, nodes ordered by index. Straight edges; undirected
  (symmetric) drawn once, no arrowhead; directed with arrowhead. N ≤ 30.
- Grid: literal cells, square, 12px mono labels. Same Bauhaus dotted-box language.

## Robustness / fixes

**Detection**

- **Grid vs adjacency-list collide** (`vector<vector<int>>` is shape-identical):
  deterministic tiebreak = char elem OR `queue<pair>` present OR in-place
  mutation OR `grid` name → grid; else list. Plus a small header toggle
  **"view as: Graph | Grid"** (reuses existing per-container toggle idiom),
  **in v1**, as insurance against mis-guess.
- **Matrix vs 0/1 grid collide**: matrix is lowest priority; a `visited` /
  `queue<pair>` / mutation signal forces grid.
- Ragged rows → always list, never grid.
- Undirected dedup: symmetric edges drawn once; self-loops rendered as a small
  loop, not dropped.
- Empty / single / disconnected / isolated nodes → still lay out, no crash.
- visited length ≠ node count, or placeholder `"?"` frontier → drop that overlay,
  still draw graph.

**Overlay correctness**

- **Visit-order seek-safe**: no mutable accumulator. Recompute order map from
  trace prefix `[0..index]`, memoized on `index`; backward/jump stepping stays
  correct.
- **Out-of-range edge target** (bad adjacency value) → dashed `--red` dangling
  edge, never throw.
- **Mutation flash** = decode `prevMem` too (App already passes `prevPoint`);
  diff cell `displayValue` at `[i][j]`; one-step tint.
- Frontier ids read from already-decoded adaptor children; unknown → skip.

**Render / UX**

- N > 30 nodes → compact index-grid fallback (no force layout, ever). Big grid →
  `overflow:auto` scroll container; page never scrolls sideways.
- Clicking a node **inspects only** — never jumps the player (repo rule).
- Panel self-hides on null scene; non-graph programs unaffected.

## Testing

Real regenerated backend fixtures (regenerate, do not hand-edit — repo rule):

- `dfs_list.cpp` — list, DFS recursion + BFS queue.
- `graphs.cpp` — adjacency matrix.
- `noOfIslands.cpp` — char grid + in-place mutation.
- `rottingOrangeSolved.cpp` — int grid, `queue<pair>`, BFS levels.

Unit tests: each detector; the 3 disambiguation tiebreaks (list/grid/matrix);
visited-length bind + degrade; visit-order prefix recompute (incl. backward
step); edge dedup; out-of-range guard; circular + grid coordinate math.

## Scope

**v1**: both shapes + matrix; 4 overlays + recursion path; auto-detect + manual
Graph/Grid toggle; always-on self-hiding panel; all fixes above.

**Later**: weighted / edge-list graphs; dist[] / parent[] overlays; edge
classification (tree/back/cross); DFS-vs-BFS compare; force / layered layout;
CallLog ↔ graph-node hover-link.
