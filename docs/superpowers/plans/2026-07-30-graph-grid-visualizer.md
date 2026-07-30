# Graph & Grid Visualizer Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-on side panel that draws a student's graph/grid as a node-link diagram or colored grid and paints live DFS/BFS state onto it as they step through the trace.

**Architecture:** Pure model (`graphModel.ts`) turns one already-decoded `NormalizedMemory` into a `GraphScene`; pure layout (`graphLayout.ts`) assigns coordinates; `GraphPanel.tsx` renders SVG and self-hides when no graph is detected. This mirrors the existing `memoryModel.ts` / `connectorGeometry.ts` / `MemoryView.tsx` split.

**Tech Stack:** React + Vite + TypeScript, plain SVG/CSS, Vitest. No new dependencies.

## Global Constraints

- No new frontend dependencies. React + CodeMirror + plain CSS/SVG only (verbatim from CLAUDE.md: "No new frontend dependencies").
- `graphModel.ts` and `graphLayout.ts` MUST stay pure — no React, no DOM imports. (Same rule the repo enforces on `memoryModel.ts` and `connectorGeometry.ts`.)
- Colors come ONLY from theme CSS variables in `index.css`: `--yellow` (current), `--blue` (frontier/resolved), `--red` (error/unresolved/dangling), `--ink`/`--ink-soft`, dimming for not-yet-visited. Dotted boxes (`--border-dotted`), square corners, 12px mono for data text.
- Nothing in the panel jumps the player. Clicking a node inspects only. (verbatim rule: "Nothing in the visualization jumps the player implicitly".)
- Test fixtures are REAL backend traces. Regenerate them; never hand-edit. (CLAUDE.md rule.)
- TDD: write the failing test, watch it fail, implement minimally, one logical change per commit.
- Frontend commands run from `frontend/`. Typecheck gate = `npm run build`. Lint = `npm run lint`. One test file = `npx vitest run tests/Foo.test.ts`.
- Work directly on `main` (repo workflow rule).

---

### Task 1: Generate real trace fixtures

Produce the four real backend traces the later pure-model tests load. Requires the tracer Docker image + backend running (see repo `./install.sh`). Copy the four sample programs into the fixtures dir as inputs, trace each, save JSON.

**Files:**
- Create: `frontend/tests/fixtures/graph/dfs_list.json` (from `Leet-Code/Placement_prep/11-graphs/dfs_list.cpp`)
- Create: `frontend/tests/fixtures/graph/graphs.json` (from `.../graphs.cpp`, adjacency matrix)
- Create: `frontend/tests/fixtures/graph/islands.json` (from `.../noOfIslands.cpp`, char grid)
- Create: `frontend/tests/fixtures/graph/rotting.json` (from `.../rottingOrangeSolved.cpp`, int grid + queue<pair>)
- Test: `frontend/tests/graph/fixtures.smoke.test.ts`

**Interfaces:**
- Produces: four JSON files each shaped `{ code: string, trace: ExecPoint[] }` (the standard OPT trace, validated by `parse_trace`). Later tasks import them and call `normalizeMemory(fixture.trace[step])`.

- [ ] **Step 1: Start the stack and confirm the tracer image exists**

Run (from repo root):
```bash
./install.sh
cd backend && .venv/bin/uvicorn app.api:app --port 8000 &
```
Expected: backend listening on :8000. (If Docker image missing, `install.sh` builds it.)

- [ ] **Step 2: Trace each sample program and save the JSON fixture**

Run (from repo root; repeat for each file/name pair):
```bash
mkdir -p frontend/tests/fixtures/graph
for pair in "dfs_list:dfs_list" "graphs:graphs" "noOfIslands:islands" "rottingOrangeSolved:rotting"; do
  src="${pair%%:*}"; out="${pair##*:}"
  code=$(python3 -c "import json,sys;print(json.dumps(open(sys.argv[1]).read()))" \
    "$HOME/Documents/CSE-Projects/Leet-Code/Placement_prep/11-graphs/$src.cpp")
  curl -s -X POST http://localhost:8000/api/trace \
    -H 'Content-Type: application/json' \
    -d "{\"code\": $code}" > "frontend/tests/fixtures/graph/$out.json"
done
```
Expected: four non-empty JSON files, each with a `trace` array.

- [ ] **Step 3: Write the smoke test**

```ts
// frontend/tests/graph/fixtures.smoke.test.ts
import { describe, it, expect } from "vitest";
import dfsList from "../fixtures/graph/dfs_list.json";
import graphs from "../fixtures/graph/graphs.json";
import islands from "../fixtures/graph/islands.json";
import rotting from "../fixtures/graph/rotting.json";

describe("graph fixtures", () => {
  it.each([
    ["dfs_list", dfsList],
    ["graphs", graphs],
    ["islands", islands],
    ["rotting", rotting],
  ])("%s parses with a non-empty trace", (_name, fx: any) => {
    expect(typeof fx.code).toBe("string");
    expect(Array.isArray(fx.trace)).toBe(true);
    expect(fx.trace.length).toBeGreaterThan(0);
    expect(fx.trace[0]).toHaveProperty("line");
  });
});
```

- [ ] **Step 4: Run and verify it passes**

Run: `cd frontend && npx vitest run tests/graph/fixtures.smoke.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add -f frontend/tests/fixtures/graph frontend/tests/graph/fixtures.smoke.test.ts
git commit -m "test(graph): real backend trace fixtures for graph/grid samples"
```

---

### Task 2: graphModel types + matrix reader + adjacency-list detector

**Files:**
- Create: `frontend/src/viz/graph/graphModel.ts`
- Test: `frontend/tests/graph/graphModel.adjlist.test.ts`

**Interfaces:**
- Consumes: `NormalizedMemory`, `NormalizedCell` from `../memoryModel`; `ExecPoint` from `../../types/trace`.
- Produces (relied on by every later task):
```ts
export type GraphKind = "adjlist" | "matrix" | "grid";
export type ViewAs = "auto" | "graph" | "grid";
export interface GraphNode { id: string; label: string; row?: number; col?: number; }
export interface GraphEdge { from: string; to: string; directed: boolean; dangling?: boolean; }
export interface GraphOverlays {
  visited: Set<string>;
  current: string[];        // recursion path, top frame first
  frontier: Set<string>;
  order: Map<string, number>;
  flashed: Set<string>;     // grid cells changed this step
}
export interface GraphScene {
  kind: GraphKind;
  nodes: GraphNode[];
  edges: GraphEdge[];
  overlays: GraphOverlays;
  rows?: number; cols?: number;
}
export function buildGraphScene(
  mem: NormalizedMemory, prevMem: NormalizedMemory | null,
  trace: ExecPoint[], index: number, viewAs?: ViewAs,
): GraphScene | null;
// helpers (exported for unit tests):
export function readMatrix(cell: NormalizedCell): string[][] | null; // rows of displayValues, null if not vector<vector<scalar>>
export function findContainers(mem: NormalizedMemory): NormalizedCell[]; // all container/array cells in globals+frames
```

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/graph/graphModel.adjlist.test.ts
import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import dfsList from "../fixtures/graph/dfs_list.json";

// Pick a step where `graph` is fully populated (after main builds it).
// dfs_list builds a 7-node directed graph: 0->1,0->2,1->3,1->4,2->5,4->5,5->6.
function sceneAt(step: number) {
  const mem = normalizeMemory((dfsList as any).trace[step]);
  return buildGraphScene(mem, null, (dfsList as any).trace, step);
}

describe("adjacency-list detection", () => {
  it("detects an adjlist scene with 7 nodes and the expected edges", () => {
    // Find the first step that yields an adjlist scene with 7 nodes.
    let scene = null;
    for (let s = 0; s < (dfsList as any).trace.length; s++) {
      const sc = sceneAt(s);
      if (sc && sc.kind === "adjlist" && sc.nodes.length === 7) { scene = sc; break; }
    }
    expect(scene).not.toBeNull();
    expect(scene!.nodes.map((n) => n.id).sort()).toEqual(["0","1","2","3","4","5","6"]);
    const edgeSet = new Set(scene!.edges.map((e) => `${e.from}->${e.to}`));
    expect(edgeSet.has("0->1")).toBe(true);
    expect(edgeSet.has("1->4")).toBe(true);
    expect(edgeSet.has("5->6")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/graph/graphModel.adjlist.test.ts`
Expected: FAIL — `buildGraphScene` not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/viz/graph/graphModel.ts
import type { NormalizedMemory, NormalizedCell } from "../memoryModel";
import type { ExecPoint } from "../../types/trace";

export type GraphKind = "adjlist" | "matrix" | "grid";
export type ViewAs = "auto" | "graph" | "grid";
export interface GraphNode { id: string; label: string; row?: number; col?: number; }
export interface GraphEdge { from: string; to: string; directed: boolean; dangling?: boolean; }
export interface GraphOverlays {
  visited: Set<string>; current: string[]; frontier: Set<string>;
  order: Map<string, number>; flashed: Set<string>;
}
export interface GraphScene {
  kind: GraphKind; nodes: GraphNode[]; edges: GraphEdge[];
  overlays: GraphOverlays; rows?: number; cols?: number;
}

const emptyOverlays = (): GraphOverlays => ({
  visited: new Set(), current: [], frontier: new Set(),
  order: new Map(), flashed: new Set(),
});

/** Depth-first collect every container/array cell in globals + all frames. */
export function findContainers(mem: NormalizedMemory): NormalizedCell[] {
  const out: NormalizedCell[] = [];
  const walk = (c: NormalizedCell) => {
    if (c.kind === "container" || c.kind === "array") out.push(c);
    c.children?.forEach(walk);
  };
  mem.globals.forEach(walk);
  mem.frames.forEach((f) => f.cells.forEach(walk));
  return out;
}

/** A vector<vector<scalar>> reads as rows of scalar displayValues. Null otherwise. */
export function readMatrix(cell: NormalizedCell): string[][] | null {
  if (!(cell.kind === "container" || cell.kind === "array")) return null;
  const rows = cell.children ?? [];
  if (rows.length === 0) return null;
  const out: string[][] = [];
  for (const row of rows) {
    if (!(row.kind === "container" || row.kind === "array") || !row.children) return null;
    if (row.children.some((x) => x.kind !== "scalar")) return null;
    out.push(row.children.map((x) => x.displayValue));
  }
  return out;
}

function isIntLabel(s: string): boolean { return /^-?\d+$/.test(s); }

/** Build an adjacency-list scene from a vector<vector<int>> matrix. */
function adjlistScene(matrix: string[][]): GraphScene {
  const n = matrix.length;
  const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({
    id: String(i), label: String(i),
  }));
  const edges: GraphEdge[] = [];
  matrix.forEach((row, i) => {
    row.forEach((v) => {
      if (!isIntLabel(v)) return;
      const to = Number(v);
      edges.push({ from: String(i), to: String(to), directed: true,
        dangling: to < 0 || to >= n });
    });
  });
  return { kind: "adjlist", nodes, edges, overlays: emptyOverlays() };
}

export function buildGraphScene(
  mem: NormalizedMemory, _prevMem: NormalizedMemory | null,
  _trace: ExecPoint[], _index: number, _viewAs: ViewAs = "auto",
): GraphScene | null {
  const containers = findContainers(mem);
  for (const c of containers) {
    const m = readMatrix(c);
    if (m && m.length > 0 && m.every((r) => r.every(isIntLabel))) {
      return adjlistScene(m);
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/graph/graphModel.adjlist.test.ts`
Expected: PASS. (If node count differs, inspect the fixture to confirm the step where `graph` is fully built and adjust the loop — the fixture is the source of truth.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/graph/graphModel.ts frontend/tests/graph/graphModel.adjlist.test.ts
git commit -m "feat(graph): adjacency-list detector + GraphScene types"
```

---

### Task 3: Adjacency-matrix detector

Distinguish an N×N 0/1 matrix (edge = `m[i][j] == 1`) from a plain adjacency list.

**Files:**
- Modify: `frontend/src/viz/graph/graphModel.ts`
- Test: `frontend/tests/graph/graphModel.matrix.test.ts`

**Interfaces:**
- Consumes: `readMatrix`, `GraphScene` from Task 2.
- Produces: internal `matrixScene(matrix): GraphScene` (kind `"matrix"`), and a `isBinarySquare(matrix)` predicate used by the detector precedence in Task 5.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/graph/graphModel.matrix.test.ts
import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import graphs from "../fixtures/graph/graphs.json";

describe("adjacency-matrix detection", () => {
  it("detects a 5-node undirected matrix graph with edge 0-1", () => {
    let scene = null;
    for (let s = 0; s < (graphs as any).trace.length; s++) {
      const mem = normalizeMemory((graphs as any).trace[s]);
      const sc = buildGraphScene(mem, null, (graphs as any).trace, s);
      if (sc && sc.kind === "matrix" && sc.nodes.length === 5) { scene = sc; break; }
    }
    expect(scene).not.toBeNull();
    const edgeSet = new Set(scene!.edges.map((e) => `${e.from}-${e.to}`));
    // undirected: stored once, unordered pair
    const has = (a: string, b: string) => edgeSet.has(`${a}-${b}`) || edgeSet.has(`${b}-${a}`);
    expect(has("0", "1")).toBe(true);
    expect(has("3", "4")).toBe(true);
    expect(scene!.edges.every((e) => e.directed === false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/graph/graphModel.matrix.test.ts`
Expected: FAIL — scene comes back as `adjlist` (wrong kind), so `scene` stays null.

- [ ] **Step 3: Write minimal implementation**

Add to `graphModel.ts`:
```ts
export function isBinarySquare(matrix: string[][]): boolean {
  const n = matrix.length;
  if (n === 0) return false;
  return matrix.every((r) => r.length === n && r.every((v) => v === "0" || v === "1"));
}

function matrixScene(matrix: string[][]): GraphScene {
  const n = matrix.length;
  const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({ id: String(i), label: String(i) }));
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (matrix[i][j] !== "1") continue;
      const directed = matrix[j]?.[i] !== "1";      // asymmetric => directed
      const key = directed ? `${i}>${j}` : [i, j].sort((a, b) => a - b).join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: String(i), to: String(j), directed });
    }
  }
  return { kind: "matrix", nodes, edges, overlays: emptyOverlays() };
}
```
Then in `buildGraphScene`, before the adjlist branch, prefer a binary-square matrix:
```ts
    if (m && m.length > 0 && m.every((r) => r.every(isIntLabel))) {
      if (isBinarySquare(m)) return matrixScene(m);
      return adjlistScene(m);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/graph/graphModel.matrix.test.ts`
Expected: PASS. Re-run Task 2's test too — dfs_list is not binary-square, so it still returns `adjlist`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/graph/graphModel.ts frontend/tests/graph/graphModel.matrix.test.ts
git commit -m "feat(graph): adjacency-matrix detector with undirected edge dedup"
```

---

### Task 4: Grid detector (char and int grids)

**Files:**
- Modify: `frontend/src/viz/graph/graphModel.ts`
- Test: `frontend/tests/graph/graphModel.grid.test.ts`

**Interfaces:**
- Consumes: `readMatrix`, `GraphScene`.
- Produces: internal `gridScene(matrix): GraphScene` (kind `"grid"`, nodes keyed `"r,c"` with `row`/`col`, `rows`/`cols` set, no edges), and predicate `isCharMatrix(cell)` (elementType/type contains `char`).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/graph/graphModel.grid.test.ts
import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import islands from "../fixtures/graph/islands.json";

describe("grid detection", () => {
  it("detects the char grid as kind grid with r,c node ids", () => {
    // islands grid is 4 rows x 5 cols of '0'/'1'.
    let scene = null;
    for (let s = 0; s < (islands as any).trace.length; s++) {
      const mem = normalizeMemory((islands as any).trace[s]);
      const sc = buildGraphScene(mem, null, (islands as any).trace, s);
      if (sc && sc.kind === "grid") { scene = sc; break; }
    }
    expect(scene).not.toBeNull();
    expect(scene!.rows).toBe(4);
    expect(scene!.cols).toBe(5);
    expect(scene!.nodes.length).toBe(20);
    const n00 = scene!.nodes.find((n) => n.id === "0,0")!;
    expect(n00.row).toBe(0); expect(n00.col).toBe(0);
    expect(scene!.edges.length).toBe(0); // grids draw no node-link edges
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/graph/graphModel.grid.test.ts`
Expected: FAIL — char grid currently returns null (values like `'0'` are not int labels) or wrong kind.

- [ ] **Step 3: Write minimal implementation**

Add:
```ts
export function isCharMatrix(cell: NormalizedCell): boolean {
  const t = `${cell.elementType ?? ""} ${cell.type ?? ""}`.toLowerCase();
  return t.includes("char");
}

function gridScene(matrix: string[][]): GraphScene {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const nodes: GraphNode[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      nodes.push({ id: `${r},${c}`, label: matrix[r][c], row: r, col: c });
  return { kind: "grid", nodes, edges: [], overlays: emptyOverlays(), rows, cols };
}

function isRectangular(matrix: string[][]): boolean {
  const w = matrix[0]?.length ?? 0;
  return w > 0 && matrix.every((r) => r.length === w);
}
```
In `buildGraphScene`, before the int-matrix branch, detect char grids:
```ts
  for (const c of containers) {
    const m = readMatrix(c);
    if (!m || m.length === 0) continue;
    if (isCharMatrix(c) && isRectangular(m)) return gridScene(m);
    if (m.every((r) => r.every(isIntLabel))) {
      if (isBinarySquare(m)) return matrixScene(m);
      return adjlistScene(m);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/graph/graphModel.grid.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/graph/graphModel.ts frontend/tests/graph/graphModel.grid.test.ts
git commit -m "feat(graph): char-grid detector"
```

---

### Task 5: Int-grid disambiguation + viewAs override

An int `vector<vector<int>>` can be a grid (rotting oranges) or an adjacency list. Disambiguate deterministically, and honor the manual `viewAs` override.

**Files:**
- Modify: `frontend/src/viz/graph/graphModel.ts`
- Test: `frontend/tests/graph/graphModel.disambig.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: internal `hasPairQueue(mem)` (true if any live `queue`/`stack` container holds pair/2-tuple children) and `looksLikeGrid(matrix, mem, cellName)` predicate. `buildGraphScene`'s `viewAs` param now forces `"grid"` or `"graph"`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/graph/graphModel.disambig.test.ts
import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import rotting from "../fixtures/graph/rotting.json";
import dfsList from "../fixtures/graph/dfs_list.json";

const firstScene = (fx: any, viewAs?: any) => {
  for (let s = 0; s < fx.trace.length; s++) {
    const sc = buildGraphScene(normalizeMemory(fx.trace[s]), null, fx.trace, s, viewAs);
    if (sc) return sc;
  }
  return null;
};

describe("int grid vs adjacency list disambiguation", () => {
  it("treats rotting-oranges int matrix as a grid (has queue<pair>)", () => {
    // step through until the queue<pair> exists; grab a scene then.
    let kind = null;
    for (let s = 0; s < (rotting as any).trace.length; s++) {
      const sc = buildGraphScene(normalizeMemory((rotting as any).trace[s]), null, (rotting as any).trace, s);
      if (sc) { kind = sc.kind; if (kind === "grid") break; }
    }
    expect(kind).toBe("grid");
  });

  it("viewAs override forces adjacency list to render as grid and back", () => {
    expect(firstScene(dfsList, "grid")!.kind).toBe("grid");
    expect(firstScene(dfsList, "graph")!.kind).toBe("adjlist");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/graph/graphModel.disambig.test.ts`
Expected: FAIL — rotting matrix returns `adjlist`; `viewAs` is ignored.

- [ ] **Step 3: Write minimal implementation**

Add:
```ts
function hasPairQueue(mem: NormalizedMemory): boolean {
  return findContainers(mem).some((c) => {
    const k = (c.containerKind ?? "").toLowerCase();
    if (!(k.includes("queue") || k.includes("stack"))) return false;
    return (c.children ?? []).some((child) =>
      (child.children?.length ?? 0) === 2 ||
      (child.type ?? "").toLowerCase().includes("pair"));
  });
}

function looksLikeGrid(matrix: string[][], mem: NormalizedMemory, name: string): boolean {
  if (/grid|board|maze|image|matrix/i.test(name)) return true;
  if (hasPairQueue(mem)) return true;                 // BFS over cells
  // small value alphabet not usable as node indices (e.g. only 0/1/2) over a
  // rectangular non-square shape is grid-ish; square binary already handled as matrix.
  if (isRectangular(matrix) && matrix.length !== (matrix[0]?.length ?? 0)) {
    const vals = new Set(matrix.flat());
    if ([...vals].every((v) => Number(v) >= 0 && Number(v) <= 2)) return true;
  }
  return false;
}
```
Rework the `buildGraphScene` loop:
```ts
export function buildGraphScene(
  mem, prevMem, trace, index, viewAs: ViewAs = "auto",
): GraphScene | null {
  for (const c of findContainers(mem)) {
    const m = readMatrix(c);
    if (!m || m.length === 0) continue;
    const rectangular = isRectangular(m);
    const allInt = m.every((r) => r.every(isIntLabel));
    const isChar = isCharMatrix(c);
    if (!isChar && !allInt) continue;               // not a graph/grid container

    if (viewAs === "grid") return gridScene(m);
    if (viewAs === "graph" && allInt)
      return isBinarySquare(m) ? matrixScene(m) : adjlistScene(m);

    // auto
    if (isChar && rectangular) return gridScene(m);
    if (allInt) {
      if (looksLikeGrid(m, mem, c.name)) return gridScene(m);
      if (isBinarySquare(m)) return matrixScene(m);
      return adjlistScene(m);
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/graph/graphModel.disambig.test.ts`
Then run all graph tests: `npx vitest run tests/graph/`
Expected: PASS, and Tasks 2–4 still green (graphs.cpp is square-binary → still `matrix`; dfs_list has no pair-queue and is square? dfs_list is 7×ragged → not rectangular → stays `adjlist`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/graph/graphModel.ts frontend/tests/graph/graphModel.disambig.test.ts
git commit -m "feat(graph): int-grid disambiguation + viewAs override"
```

---

### Task 6: visited overlay + graceful degrade

**Files:**
- Modify: `frontend/src/viz/graph/graphModel.ts`
- Test: `frontend/tests/graph/graphModel.visited.test.ts`

**Interfaces:**
- Consumes: `GraphScene`, `findContainers`.
- Produces: internal `bindVisited(mem, scene)` that fills `scene.overlays.visited` when a bool/int vector matches node count (adjlist/matrix) or grid dims; leaves it empty otherwise.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/graph/graphModel.visited.test.ts
import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import dfsList from "../fixtures/graph/dfs_list.json";

describe("visited overlay", () => {
  it("marks node 0 visited during dfs once visited[0] is true", () => {
    // find a step where an adjlist scene has node 0 visited
    let found = false;
    for (let s = 0; s < (dfsList as any).trace.length; s++) {
      const sc = buildGraphScene(normalizeMemory((dfsList as any).trace[s]), null, (dfsList as any).trace, s);
      if (sc?.kind === "adjlist" && sc.overlays.visited.has("0")) { found = true; break; }
    }
    expect(found).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/graph/graphModel.visited.test.ts`
Expected: FAIL — `visited` set is always empty.

- [ ] **Step 3: Write minimal implementation**

```ts
function truthyScalar(v: string): boolean {
  return v === "true" || v === "1" || (isIntLabel(v) && Number(v) !== 0);
}

function bindVisited(mem: NormalizedMemory, scene: GraphScene): void {
  const nodeCount = scene.kind === "grid"
    ? (scene.rows ?? 0) * (scene.cols ?? 0)
    : scene.nodes.length;
  for (const c of findContainers(mem)) {
    if (!/visit|seen|vis|rott/i.test(c.name) && scene.kind !== "grid") {
      // name-agnostic fallback still allowed below; prefer named vectors first
    }
    // grid: a same-dims bool/int matrix
    if (scene.kind === "grid") {
      const m = readMatrix(c);
      if (m && m.length === scene.rows && m[0]?.length === scene.cols && m !== null) {
        if (/visit|seen|vis/i.test(c.name)) {
          m.forEach((row, r) => row.forEach((v, col) => {
            if (truthyScalar(v)) scene.overlays.visited.add(`${r},${col}`);
          }));
          return;
        }
      }
      continue;
    }
    // adjlist/matrix: a flat vector<bool|int> of length nodeCount
    const flat = c.children;
    if (!flat || flat.length !== nodeCount) continue;
    if (flat.some((x) => x.kind !== "scalar")) continue;
    if (!/visit|seen|vis/i.test(c.name)) continue;
    flat.forEach((x, i) => { if (truthyScalar(x.displayValue)) scene.overlays.visited.add(String(i)); });
    return;
  }
}
```
Call `bindVisited(mem, scene)` on the scene right before returning it from `buildGraphScene` (wrap the returns: build `scene`, then `bindVisited`, then `return scene`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/graph/graphModel.visited.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/graph/graphModel.ts frontend/tests/graph/graphModel.visited.test.ts
git commit -m "feat(graph): visited overlay with length-matched binding + degrade"
```

---

### Task 7: frontier overlay (queue / stack / queue<pair>)

**Files:**
- Modify: `frontend/src/viz/graph/graphModel.ts`
- Test: `frontend/tests/graph/graphModel.frontier.test.ts`

**Interfaces:**
- Consumes: `GraphScene`, `findContainers`.
- Produces: internal `bindFrontier(mem, scene)` filling `scene.overlays.frontier` from a live `queue`/`stack`; ids are `"i"` for scalar elements, `"r,c"` for pair elements. Placeholder `"?"` children are skipped.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/graph/graphModel.frontier.test.ts
import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import rotting from "../fixtures/graph/rotting.json";

describe("frontier overlay", () => {
  it("marks queued cells as frontier in the rotting-oranges grid", () => {
    let found = false;
    for (let s = 0; s < (rotting as any).trace.length; s++) {
      const sc = buildGraphScene(normalizeMemory((rotting as any).trace[s]), null, (rotting as any).trace, s);
      if (sc?.kind === "grid" && sc.overlays.frontier.size > 0) { found = true; break; }
    }
    expect(found).toBe(true);
  });
});
```
(Note: the default `rottingOrangeSolved.cpp` `main` uses `{{0}}` which never enqueues. Before generating the fixture in Task 1, uncomment the richer grid `{{1,1,0},{0,1,1},{0,1,2}}` in that file's `main` so the queue is exercised; regenerate `rotting.json`. Record this in the commit.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/graph/graphModel.frontier.test.ts`
Expected: FAIL — frontier always empty.

- [ ] **Step 3: Write minimal implementation**

```ts
function pairId(cell: NormalizedCell): string | null {
  const kids = cell.children;
  if (kids && kids.length === 2 && kids.every((k) => k.kind === "scalar" && isIntLabel(k.displayValue)))
    return `${kids[0].displayValue},${kids[1].displayValue}`;
  return null;
}

function bindFrontier(mem: NormalizedMemory, scene: GraphScene): void {
  for (const c of findContainers(mem)) {
    const k = (c.containerKind ?? "").toLowerCase();
    if (!(k.includes("queue") || k.includes("stack"))) continue;
    if (c.placeholders) continue;
    for (const el of c.children ?? []) {
      if (scene.kind === "grid") {
        const id = pairId(el);
        if (id) scene.overlays.frontier.add(id);
      } else if (el.kind === "scalar" && isIntLabel(el.displayValue)) {
        scene.overlays.frontier.add(el.displayValue);
      }
    }
    if (scene.overlays.frontier.size > 0) return;
  }
}
```
Call `bindFrontier(mem, scene)` alongside `bindVisited` before returning.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/graph/graphModel.frontier.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/graph/graphModel.ts frontend/tests/graph/graphModel.frontier.test.ts frontend/tests/fixtures/graph/rotting.json
git commit -m "feat(graph): frontier overlay from live queue/stack (scalar + pair)"
```

---

### Task 8: current node + recursion path overlay

**Files:**
- Modify: `frontend/src/viz/graph/graphModel.ts`
- Test: `frontend/tests/graph/graphModel.current.test.ts`

**Interfaces:**
- Consumes: `NormalizedMemory.frames`, `GraphScene`.
- Produces: internal `bindCurrent(mem, scene)` filling `scene.overlays.current` — one id per user frame (top frame first). For grid, reads a pair of int args (`i,j` / `r,c`); for graph, a single int arg (`node`/`curr`/`n`).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/graph/graphModel.current.test.ts
import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import dfsList from "../fixtures/graph/dfs_list.json";

describe("current + recursion path", () => {
  it("during nested dfs, current holds >1 node id (recursion path)", () => {
    let maxPath = 0;
    for (let s = 0; s < (dfsList as any).trace.length; s++) {
      const sc = buildGraphScene(normalizeMemory((dfsList as any).trace[s]), null, (dfsList as any).trace, s);
      if (sc?.kind === "adjlist") maxPath = Math.max(maxPath, sc.overlays.current.length);
    }
    expect(maxPath).toBeGreaterThan(1); // dfs recurses several levels deep
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/graph/graphModel.current.test.ts`
Expected: FAIL — `current` always empty.

- [ ] **Step 3: Write minimal implementation**

```ts
function frameNodeId(frame: { cells: NormalizedCell[] }, kind: GraphKind): string | null {
  const ints = frame.cells.filter((c) => c.kind === "scalar" && isIntLabel(c.displayValue));
  if (kind === "grid") {
    const rc = frame.cells.filter((c) => /^(i|j|r|c|row|col|x|y)$/i.test(c.name) && isIntLabel(c.displayValue));
    if (rc.length >= 2) return `${rc[0].displayValue},${rc[1].displayValue}`;
    return null;
  }
  const named = frame.cells.find((c) => /^(node|curr|cur|n|u|v|src|start)$/i.test(c.name) && isIntLabel(c.displayValue));
  return (named ?? ints[0])?.displayValue ?? null;
}

function bindCurrent(mem: NormalizedMemory, scene: GraphScene): void {
  // frames are outermost-first in NormalizedMemory; reverse for top-first path.
  const frames = [...mem.frames].reverse();
  for (const f of frames) {
    const id = frameNodeId(f, scene.kind);
    if (id && scene.nodes.some((n) => n.id === id)) scene.overlays.current.push(id);
  }
}
```
Call `bindCurrent(mem, scene)` before returning.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/graph/graphModel.current.test.ts`
Expected: PASS. (If frame ordering is innermost-first in this codebase, drop the `.reverse()` — verify against the fixture.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/graph/graphModel.ts frontend/tests/graph/graphModel.current.test.ts
git commit -m "feat(graph): current node + DFS recursion-path overlay from frames"
```

---

### Task 9: visit-order (seek-safe) + grid mutation flash

**Files:**
- Modify: `frontend/src/viz/graph/graphModel.ts`
- Test: `frontend/tests/graph/graphModel.order.test.ts`

**Interfaces:**
- Consumes: `trace`, `index`, `prevMem`, `GraphScene`.
- Produces: internal `bindOrder(trace, index, scene)` (recompute from prefix `[0..index]`, first step each node becomes visited → sequential number) and `bindFlash(prevMem, mem, scene)` (grid cells whose displayValue changed vs prev step).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/graph/graphModel.order.test.ts
import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { buildGraphScene } from "../../src/viz/graph/graphModel";
import dfsList from "../fixtures/graph/dfs_list.json";
import islands from "../fixtures/graph/islands.json";

const at = (fx: any, s: number, prev: number | null) =>
  buildGraphScene(
    normalizeMemory(fx.trace[s]),
    prev == null ? null : normalizeMemory(fx.trace[prev]),
    fx.trace, s);

describe("visit-order + mutation flash", () => {
  it("visit-order is seek-safe: same step gives same numbering forwards or backwards", () => {
    const tr = (dfsList as any).trace;
    // find a late adjlist step with several ordered nodes
    let step = -1;
    for (let s = tr.length - 1; s >= 0; s--) {
      const sc = buildGraphScene(normalizeMemory(tr[s]), null, tr, s);
      if (sc?.kind === "adjlist" && sc.overlays.order.size >= 3) { step = s; break; }
    }
    expect(step).toBeGreaterThan(0);
    const a = buildGraphScene(normalizeMemory(tr[step]), null, tr, step)!.overlays.order;
    const b = buildGraphScene(normalizeMemory(tr[step]), null, tr, step)!.overlays.order;
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it("mutation flash marks a grid cell the step it flips", () => {
    const tr = (islands as any).trace;
    let flashed = false;
    for (let s = 1; s < tr.length; s++) {
      const sc = at(islands, s, s - 1);
      if (sc?.kind === "grid" && sc.overlays.flashed.size > 0) { flashed = true; break; }
    }
    expect(flashed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/graph/graphModel.order.test.ts`
Expected: FAIL — `order` and `flashed` empty.

- [ ] **Step 3: Write minimal implementation**

```ts
function visitedIdsAt(point: ExecPoint, kindHint: GraphScene): Set<string> {
  // reuse detection on a point's memory to read its visited set
  const mem = normalizeMemory(point);
  const scene = { ...kindHint, overlays: {
    visited: new Set<string>(), current: [], frontier: new Set<string>(),
    order: new Map<string, number>(), flashed: new Set<string>() } };
  bindVisited(mem, scene);
  return scene.overlays.visited;
}

function bindOrder(trace: ExecPoint[], index: number, scene: GraphScene): void {
  let counter = 0;
  const prev = new Set<string>();
  for (let s = 0; s <= index; s++) {
    const now = visitedIdsAt(trace[s], scene);
    for (const id of now) if (!prev.has(id)) { prev.add(id); scene.overlays.order.set(id, ++counter); }
  }
}

function bindFlash(prevMem: NormalizedMemory | null, mem: NormalizedMemory, scene: GraphScene): void {
  if (scene.kind !== "grid" || !prevMem) return;
  const cur = readGridMatrix(mem, scene);
  const old = readGridMatrix(prevMem, scene);
  if (!cur || !old) return;
  for (let r = 0; r < scene.rows!; r++)
    for (let c = 0; c < scene.cols!; c++)
      if (cur[r]?.[c] !== old[r]?.[c]) scene.overlays.flashed.add(`${r},${c}`);
}

/** Re-read the grid's value matrix from a memory snapshot (same detector shape). */
function readGridMatrix(mem: NormalizedMemory, scene: GraphScene): string[][] | null {
  for (const c of findContainers(mem)) {
    const m = readMatrix(c);
    if (m && m.length === scene.rows && (m[0]?.length ?? 0) === scene.cols) return m;
  }
  return null;
}
```
Call `bindOrder(trace, index, scene)` and `bindFlash(prevMem, mem, scene)` before returning. (`bindOrder` is O(steps × containers); fine for capped traces. The panel memoizes on `index` so it only recomputes on step change.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/graph/graphModel.order.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/graph/graphModel.ts frontend/tests/graph/graphModel.order.test.ts
git commit -m "feat(graph): seek-safe visit-order + grid mutation flash"
```

---

### Task 10: graphLayout — circular, grid, and large-N fallback

**Files:**
- Create: `frontend/src/viz/graph/graphLayout.ts`
- Test: `frontend/tests/graph/graphLayout.test.ts`

**Interfaces:**
- Consumes: `GraphScene`, `GraphNode`.
- Produces:
```ts
export interface Placed { id: string; x: number; y: number; }   // x,y in [0,1]
export interface Layout { placed: Placed[]; mode: "circle" | "compact" | "grid"; }
export function layoutScene(scene: GraphScene): Layout;
export const CIRCLE_MAX = 30;
```

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/graph/graphLayout.test.ts
import { describe, it, expect } from "vitest";
import { layoutScene } from "../../src/viz/graph/graphLayout";
import type { GraphScene } from "../../src/viz/graph/graphModel";

const bare = (over: Partial<GraphScene>): GraphScene => ({
  kind: "adjlist", nodes: [], edges: [],
  overlays: { visited: new Set(), current: [], frontier: new Set(), order: new Map(), flashed: new Set() },
  ...over,
});

describe("layoutScene", () => {
  it("places adjacency nodes on a unit circle", () => {
    const scene = bare({ nodes: [
      { id: "0", label: "0" }, { id: "1", label: "1" }, { id: "2", label: "2" }, { id: "3", label: "3" }] });
    const { placed, mode } = layoutScene(scene);
    expect(mode).toBe("circle");
    expect(placed.length).toBe(4);
    placed.forEach((p) => {
      const dx = p.x - 0.5, dy = p.y - 0.5;
      expect(Math.hypot(dx, dy)).toBeCloseTo(0.4, 5); // radius 0.4 around center
    });
  });

  it("uses grid mode with row/col coords for grids", () => {
    const scene = bare({ kind: "grid", rows: 2, cols: 3,
      nodes: [
        { id: "0,0", label: "a", row: 0, col: 0 }, { id: "0,1", label: "b", row: 0, col: 1 },
        { id: "0,2", label: "c", row: 0, col: 2 }, { id: "1,0", label: "d", row: 1, col: 0 },
        { id: "1,1", label: "e", row: 1, col: 1 }, { id: "1,2", label: "f", row: 1, col: 2 }] });
    const { placed, mode } = layoutScene(scene);
    expect(mode).toBe("grid");
    const p = placed.find((q) => q.id === "1,2")!;
    expect(p.x).toBeGreaterThan(placed.find((q) => q.id === "1,0")!.x);
    expect(p.y).toBeGreaterThan(placed.find((q) => q.id === "0,2")!.y);
  });

  it("falls back to compact mode past CIRCLE_MAX nodes", () => {
    const nodes = Array.from({ length: 40 }, (_, i) => ({ id: String(i), label: String(i) }));
    expect(layoutScene(bare({ nodes })).mode).toBe("compact");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/graph/graphLayout.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/viz/graph/graphLayout.ts
import type { GraphScene } from "./graphModel";

export interface Placed { id: string; x: number; y: number; }
export interface Layout { placed: Placed[]; mode: "circle" | "compact" | "grid"; }
export const CIRCLE_MAX = 30;

export function layoutScene(scene: GraphScene): Layout {
  if (scene.kind === "grid") {
    const rows = scene.rows ?? 1, cols = scene.cols ?? 1;
    const placed = scene.nodes.map((n) => ({
      id: n.id,
      x: cols === 1 ? 0.5 : (n.col ?? 0) / (cols - 1),
      y: rows === 1 ? 0.5 : (n.row ?? 0) / (rows - 1),
    }));
    return { placed, mode: "grid" };
  }
  const n = scene.nodes.length;
  if (n > CIRCLE_MAX) {
    const cols = Math.ceil(Math.sqrt(n));
    const placed = scene.nodes.map((node, i) => ({
      id: node.id,
      x: (i % cols) / Math.max(1, cols - 1),
      y: Math.floor(i / cols) / Math.max(1, Math.ceil(n / cols) - 1),
    }));
    return { placed, mode: "compact" };
  }
  const R = 0.4;
  const placed = scene.nodes.map((node, i) => {
    const t = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
    return { id: node.id, x: 0.5 + R * Math.cos(t), y: 0.5 + R * Math.sin(t) };
  });
  return { placed, mode: "circle" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/graph/graphLayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/graph/graphLayout.ts frontend/tests/graph/graphLayout.test.ts
git commit -m "feat(graph): pure circular/grid/compact layout"
```

---

### Task 11: GraphPanel render + toggle + click-inspect

**Files:**
- Create: `frontend/src/viz/graph/GraphPanel.tsx`
- Create: `frontend/src/viz/graph/graphPanel.css` (or append to `index.css` — match repo convention; repo uses `index.css`, so append there and skip the separate file)
- Test: `frontend/tests/graph/GraphPanel.test.tsx`

**Interfaces:**
- Consumes: `buildGraphScene`, `ViewAs`, `GraphScene` (graphModel); `layoutScene` (graphLayout); `normalizeMemory` (memoryModel); `ExecPoint` (trace types).
- Produces:
```ts
export function GraphPanel(props: {
  point: ExecPoint; prevPoint: ExecPoint | null;
  trace: ExecPoint[]; step: number;
}): JSX.Element | null;
```
Renders an SVG. Nodes carry `data-node-id`; overlay state expressed via classes `is-visited`, `is-current`, `is-frontier`, `is-flashed`. A `role="tablist"` header offers `auto/graph/grid`. Selecting a node sets local `selected` state only (no player callback).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/graph/GraphPanel.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { GraphPanel } from "../../src/viz/graph/GraphPanel";
import dfsList from "../fixtures/graph/dfs_list.json";
import trie from "../fixtures/trie.json"; // a non-graph fixture

const tr = (dfsList as any).trace;

describe("GraphPanel", () => {
  it("renders 7 nodes for the dfs_list graph", () => {
    // pick a step where the graph is built
    let step = 0;
    for (let s = 0; s < tr.length; s++) {
      // cheap: render and count
      const { container, unmount } = render(
        <GraphPanel point={tr[s]} prevPoint={null} trace={tr} step={s} />);
      const count = container.querySelectorAll("[data-node-id]").length;
      unmount();
      if (count === 7) { step = s; break; }
    }
    const { container } = render(
      <GraphPanel point={tr[step]} prevPoint={null} trace={tr} step={step} />);
    expect(container.querySelectorAll("[data-node-id]").length).toBe(7);
  });

  it("renders nothing (null) for a non-graph program", () => {
    const t = (trie as any).trace ?? (trie as any);
    const point = Array.isArray(t) ? t[t.length - 1] : t.trace[t.trace.length - 1];
    const { container } = render(
      <GraphPanel point={point} prevPoint={null} trace={Array.isArray(t) ? t : t.trace} step={0} />);
    expect(container.querySelector("[data-node-id]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/graph/GraphPanel.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/viz/graph/GraphPanel.tsx
import { useMemo, useState } from "react";
import type { ExecPoint } from "../../types/trace";
import { normalizeMemory } from "../memoryModel";
import { buildGraphScene, type ViewAs } from "./graphModel";
import { layoutScene } from "./graphLayout";

const W = 320, H = 320, PAD = 24, NODE_R = 14;

export function GraphPanel({ point, prevPoint, trace, step }: {
  point: ExecPoint; prevPoint: ExecPoint | null; trace: ExecPoint[]; step: number;
}) {
  const [viewAs, setViewAs] = useState<ViewAs>("auto");
  const [selected, setSelected] = useState<string | null>(null);

  const scene = useMemo(() => {
    const mem = normalizeMemory(point);
    const prev = prevPoint ? normalizeMemory(prevPoint) : null;
    return buildGraphScene(mem, prev, trace, step, viewAs);
  }, [point, prevPoint, trace, step, viewAs]);

  const layout = useMemo(() => (scene ? layoutScene(scene) : null), [scene]);
  if (!scene || !layout) return null;

  const pos = new Map(layout.placed.map((p) => [p.id, p]));
  const px = (x: number) => PAD + x * (W - 2 * PAD);
  const py = (y: number) => PAD + y * (H - 2 * PAD);
  const cls = (id: string) => [
    scene.overlays.visited.has(id) && "is-visited",
    scene.overlays.current.includes(id) && "is-current",
    scene.overlays.frontier.has(id) && "is-frontier",
    scene.overlays.flashed.has(id) && "is-flashed",
    selected === id && "is-selected",
  ].filter(Boolean).join(" ");

  return (
    <div className="graph-panel">
      <div className="graph-view-toggle" role="tablist">
        {(["auto", "graph", "grid"] as ViewAs[]).map((v) => (
          <button key={v} role="tab" aria-selected={viewAs === v}
            onClick={() => setViewAs(v)}>{v}</button>
        ))}
      </div>
      <svg className="graph-svg" viewBox={`0 0 ${W} ${H}`} width="100%">
        {scene.edges.map((e, i) => {
          const a = pos.get(e.from), b = pos.get(e.to);
          if (!a || !b) return null;
          return <line key={i} x1={px(a.x)} y1={py(a.y)} x2={px(b.x)} y2={py(b.y)}
            className={`graph-edge${e.dangling ? " is-dangling" : ""}${e.directed ? " is-directed" : ""}`} />;
        })}
        {scene.nodes.map((n) => {
          const p = pos.get(n.id); if (!p) return null;
          const order = scene.overlays.order.get(n.id);
          return (
            <g key={n.id} data-node-id={n.id} className={`graph-node ${cls(n.id)}`}
               onClick={() => setSelected(n.id)}>
              {scene.kind === "grid"
                ? <rect x={px(p.x) - NODE_R} y={py(p.y) - NODE_R} width={NODE_R * 2} height={NODE_R * 2} />
                : <circle cx={px(p.x)} cy={py(p.y)} r={NODE_R} />}
              <text x={px(p.x)} y={py(p.y)} textAnchor="middle" dominantBaseline="central">{n.label}</text>
              {order != null && <text className="graph-order" x={px(p.x) + NODE_R} y={py(p.y) - NODE_R}>{order}</text>}
            </g>
          );
        })}
      </svg>
      {selected && <div className="graph-detail">node {selected} — inspected at step {step}</div>}
    </div>
  );
}
```
Append to `index.css` (theme-var colors only):
```css
.graph-panel { border: var(--border-dotted); background: var(--panel); padding: 8px; }
.graph-view-toggle button[aria-selected="true"] { background: var(--yellow); }
.graph-svg text { font: 12px var(--mono); fill: var(--ink); }
.graph-node circle, .graph-node rect { fill: var(--panel); stroke: var(--ink); stroke-dasharray: 1 1; opacity: 0.4; }
.graph-node.is-visited circle, .graph-node.is-visited rect { opacity: 1; }
.graph-node.is-current circle, .graph-node.is-current rect { fill: var(--yellow); opacity: 1; }
.graph-node.is-frontier circle, .graph-node.is-frontier rect { stroke: var(--blue); stroke-width: 2; opacity: 1; }
.graph-node.is-flashed rect { fill: var(--yellow); }
.graph-node.is-selected circle, .graph-node.is-selected rect { stroke: var(--blue-deep); stroke-width: 2; }
.graph-edge { stroke: var(--blue); stroke-width: 1; }
.graph-edge.is-dangling { stroke: var(--red); stroke-dasharray: 3 2; }
.graph-order { font-size: 9px; fill: var(--ink-soft); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/graph/GraphPanel.test.tsx`
Expected: PASS. (If `@testing-library/react` import path differs, match how existing `*.test.tsx` files import render — copy from `tests/CallLogPanel.test.tsx`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/graph/GraphPanel.tsx frontend/src/index.css frontend/tests/graph/GraphPanel.test.tsx
git commit -m "feat(graph): GraphPanel SVG render, overlays, view toggle, click-inspect"
```

---

### Task 12: Wire GraphPanel into App as an always-on region + gate

**Files:**
- Modify: `frontend/src/App.tsx` (the `right-col` section, around lines 91–150)
- Test: `frontend/tests/App.test.tsx` (extend existing) or new `frontend/tests/graph/AppGraph.test.tsx`

**Interfaces:**
- Consumes: `GraphPanel` from `./viz/graph/GraphPanel`; existing `player.point`, `player.prevPoint`, `player.index`, `trace.trace`.
- Produces: an always-on graph region in `right-col`; it self-hides (renders null) when no graph is detected, so non-graph programs are unaffected.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/tests/graph/AppGraph.test.tsx
import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Workspace } from "../../src/App"; // export Workspace if not already exported
import dfsList from "../fixtures/graph/dfs_list.json";

describe("App graph region", () => {
  it("shows the graph region when a graph trace is loaded", async () => {
    const { container } = render(
      <Workspace trace={dfsList as any} code={(dfsList as any).code}
        breakpoints={new Set()} onToggleBreakpoint={() => {}}
        onClearBreakpoints={() => {}} onResize={() => {}} />);
    // step to the end where the graph exists
    await waitFor(() => {
      expect(container.querySelector(".graph-panel")).not.toBeNull();
    });
  });
});
```
(If the inner component is not named `Workspace` or not exported, export it, or drive the panel through the existing App-level test harness the repo already uses in `tests/App.test.tsx` — reuse that pattern.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/graph/AppGraph.test.tsx`
Expected: FAIL — no `.graph-panel` in the tree.

- [ ] **Step 3: Write minimal implementation**

In `App.tsx`, add the import and render `GraphPanel` as its own region inside `right-col`, above the `mem-region` div (so it is always visible when detected):
```tsx
import { GraphPanel } from "./viz/graph/GraphPanel";
// ...
        <div className="graph-region">
          <GraphPanel point={player.point} prevPoint={player.prevPoint}
            trace={trace.trace} step={player.index} />
        </div>
        <div className="mem-region">
```
Append CSS to `index.css`:
```css
.graph-region { overflow: auto; max-height: 40%; }
.graph-region:empty { display: none; }
```
(`GraphPanel` returns null → the `graph-region` div is empty → `:empty` hides it, so layout is untouched for non-graph programs.)

- [ ] **Step 4: Run test + full suite + gates**

Run:
```bash
cd frontend
npx vitest run tests/graph/AppGraph.test.tsx
npm test
npm run build
npm run lint
```
Expected: new test PASS; full suite PASS; build (typecheck) clean; lint clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/index.css frontend/tests/graph/AppGraph.test.tsx
git commit -m "feat(graph): wire always-on self-hiding GraphPanel region into App"
```

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- Architecture (pure model/layout/panel split): Tasks 2, 10, 11.
- Detection (grid/matrix/adjlist, visited, frontier, current + name bias): Tasks 2–8.
- Overlays (visited, current, frontier, order, mutation flash, recursion path): Tasks 6, 7, 8, 9.
- Layout (circular, grid, N>30 fallback): Task 10.
- Robustness/fixes: grid-vs-list tiebreak + viewAs toggle (Tasks 5, 11); matrix-vs-0/1-grid (Task 5); ragged rows (Task 4/`isRectangular`); undirected dedup + self-loops (Task 3); degrade on length mismatch / placeholder (Tasks 6, 7); seek-safe order (Task 9); out-of-range dangling edge (Task 2 `dangling`, rendered Task 11); mutation flash via prevMem (Task 9); N>30 + grid scroll (Tasks 10, 12); click inspects only (Task 11); self-hide (Tasks 11, 12).
- Testing (4 real fixtures + unit tests): Task 1 + per-task tests.
- Scope: v1 items all covered; "Later" items intentionally excluded.

**Placeholder scan:** no TBD/TODO; every code step has real code. Note two honesty flags for the implementer, both handled by TDD-against-fixtures: (a) exact decoded cell shape of `queue<pair>` / frames is confirmed by the Task 1 fixtures — adjust field reads if the fixture reveals a different `containerKind`/frame order; (b) `rottingOrangeSolved.cpp` `main` must use the non-trivial grid before tracing (called out in Task 7).

**Type consistency:** `GraphScene`/`GraphNode`/`GraphEdge`/`GraphOverlays`/`ViewAs` defined once in Task 2 and reused verbatim. `buildGraphScene` signature stable from Task 2; `viewAs` param used from Task 5. `layoutScene`/`Layout`/`Placed`/`CIRCLE_MAX` defined in Task 10, consumed in Task 11. `GraphPanel` prop shape defined in Task 11, consumed in Task 12.
