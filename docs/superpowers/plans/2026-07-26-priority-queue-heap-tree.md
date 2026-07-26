# priority_queue Heap-Tree View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in binary-tree view for `std::priority_queue` cells that draws the backing array as a heap, labels it min-heap / max-heap / heap from the comparator, and highlights the top node.

**Architecture:** A pure comparator classifier and a pure index-based tree-layout module feed a new `HeapTreePanel` render component. The panel is shown in place of a priority_queue cell's default array body when a per-cell toggle (a `Set<cellId>` in `MemoryView`, threaded like the existing char-view toggle) is on. No tracer or trace-format change — this works over children that `priorityQueueDecoder` already produces.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react, plain CSS + inline SVG. No new dependencies.

## Global Constraints

- No new frontend dependencies (React + CodeMirror + plain CSS/SVG only).
- Keep `memoryModel.ts`, `heapTree.ts`, and helper modules pure — no React, no DOM.
- Bauhaus theme: dotted boxes, square corners, 12px mono, colors only from CSS vars (`--blue`, `--yellow`, `--red`, `--ink`, `--border-thin`, ...).
- Default view is unchanged (flat array). The tree is opt-in per container.
- Container highlight rule: a changed element tints only its node cell, never the whole container.
- TDD: write failing test, watch it fail, minimal implementation, one logical change per commit.
- Run frontend commands from `frontend/`. Typecheck gate is `npm run build`.

---

### Task 1: Top-level template-arg splitter

The comparator is the 3rd template arg of `priority_queue<T, vector<T>, Cmp>`. `Cmp` may itself contain `<>`, `()`, `{}`, and commas (`greater<pair<int,int>>`, `decltype([](int a,int b){return a<b;})`). The existing `templateArg` in `helpers.ts` tracks only `<>` depth, so a lambda comparator's `(` / `,` would mis-split. Add a splitter that respects `<>`, `()`, and `{}` depth and returns all top-level args.

**Files:**
- Modify: `frontend/src/viz/stl/helpers.ts`
- Test: `frontend/tests/stl/helpers.test.ts`

**Interfaces:**
- Produces: `export function topLevelTemplateArgs(type: string): string[]` — the top-level template arguments of the outermost `<...>` in `type`, each trimmed. Returns `[]` when there is no `<...>`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/stl/helpers.test.ts`:

```ts
import { topLevelTemplateArgs } from "../../src/viz/stl/helpers";

describe("topLevelTemplateArgs", () => {
  it("splits simple args", () => {
    expect(topLevelTemplateArgs("priority_queue<int, vector<int>, greater<int> >"))
      .toEqual(["int", "vector<int>", "greater<int>"]);
  });
  it("keeps nested angle-bracket commas together", () => {
    expect(topLevelTemplateArgs("priority_queue<pair<int,int>, vector<pair<int,int>>, less<pair<int,int>> >"))
      .toEqual(["pair<int,int>", "vector<pair<int,int>>", "less<pair<int,int>>"]);
  });
  it("keeps lambda parens and braces together", () => {
    expect(topLevelTemplateArgs("priority_queue<int, vector<int>, decltype([](int a,int b){return a<b;})>"))
      .toEqual(["int", "vector<int>", "decltype([](int a,int b){return a<b;})"]);
  });
  it("returns [] when there is no template", () => {
    expect(topLevelTemplateArgs("int")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stl/helpers.test.ts -t "topLevelTemplateArgs"`
Expected: FAIL with "topLevelTemplateArgs is not a function".

- [ ] **Step 3: Write minimal implementation**

Add to `frontend/src/viz/stl/helpers.ts`:

```ts
/** Top-level template args of the outermost `<...>`, respecting `<> () {}`
 *  nesting so a comparator's nested commas/parens are not split. */
export function topLevelTemplateArgs(type: string): string[] {
  const open = type.indexOf("<");
  const close = type.lastIndexOf(">");
  if (open < 0 || close <= open) return [];
  const inner = type.slice(open + 1, close);
  const args: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "<" || c === "(" || c === "{") depth++;
    else if (c === ">" || c === ")" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = inner.slice(start).trim();
  if (tail) args.push(tail);
  return args;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/stl/helpers.test.ts -t "topLevelTemplateArgs"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/stl/helpers.ts frontend/tests/stl/helpers.test.ts
git commit -m "feat(stl): top-level template-arg splitter for comparator parsing"
```

---

### Task 2: Comparator classifier + heapKind on the pq cell

Classify the comparator into `"min" | "max" | "custom"` and attach it to the decoded priority_queue cell so the header badge and the panel can read it.

**Files:**
- Modify: `frontend/src/viz/memoryModel.ts` (add `heapKind?` to `NormalizedCell`)
- Modify: `frontend/src/viz/stl/adaptor.ts` (classify + set `heapKind`)
- Test: `frontend/tests/stl/adaptor.test.ts`

**Interfaces:**
- Consumes: `topLevelTemplateArgs` (Task 1).
- Produces:
  - `NormalizedCell.heapKind?: "min" | "max" | "custom"`.
  - `export function classifyHeap(type: string): "min" | "max" | "custom"` in `adaptor.ts` — `greater` ⇒ `"min"`, `less` or absent ⇒ `"max"`, anything else ⇒ `"custom"`.
  - `priorityQueueDecoder` output now carries `heapKind`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/stl/adaptor.test.ts` (top-level import + new describe block):

```ts
import { classifyHeap } from "../../src/viz/stl/adaptor";

describe("classifyHeap", () => {
  it("greater<> is a min-heap", () => {
    expect(classifyHeap("priority_queue<int, vector<int>, greater<int> >")).toBe("min");
  });
  it("less<> is a max-heap", () => {
    expect(classifyHeap("priority_queue<int, vector<int>, less<int> >")).toBe("max");
  });
  it("no comparator defaults to max-heap", () => {
    expect(classifyHeap("priority_queue<int, vector<int> >")).toBe("max");
  });
  it("bare priority_queue<int> defaults to max-heap", () => {
    expect(classifyHeap("priority_queue<int>")).toBe("max");
  });
  it("a custom functor is custom", () => {
    expect(classifyHeap("priority_queue<int, vector<int>, MyCmp>")).toBe("custom");
  });
  it("a lambda comparator is custom", () => {
    expect(classifyHeap("priority_queue<int, vector<int>, decltype([](int a,int b){return a<b;})>")).toBe("custom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stl/adaptor.test.ts -t "classifyHeap"`
Expected: FAIL with "classifyHeap is not a function".

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/viz/stl/adaptor.ts`, add the import and the classifier, and set `heapKind` in `priorityQueueDecoder`:

```ts
import { containerChildren, findMember, templateArg, topLevelTemplateArgs } from "./helpers";

/** min-heap for greater<>, max-heap for less<> or the default, else custom. */
export function classifyHeap(type: string): "min" | "max" | "custom" {
  const args = topLevelTemplateArgs(type);
  const cmp = args[2];
  if (!cmp) return "max"; // default comparator is std::less
  if (/(^|::|\b)greater\b/.test(cmp)) return "min";
  if (/(^|::|\b)less\b/.test(cmp)) return "max";
  return "custom";
}
```

In `priorityQueueDecoder.decode`, add `heapKind` to the returned object (place after `elementType`):

```ts
      heapKind: classifyHeap(cell.type ?? ""),
```

In `frontend/src/viz/memoryModel.ts`, add the field to `NormalizedCell` (after `containerKind`):

```ts
  /** Comparator classification for priority_queue cells: min-heap (greater<>),
   *  max-heap (less<> / default), or custom (unclassifiable comparator). */
  heapKind?: "min" | "max" | "custom";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/stl/adaptor.test.ts -t "classifyHeap"`
Expected: PASS.

- [ ] **Step 5: Add a fixture assertion and run the full adaptor test**

Add to the existing `"decodes std::priority_queue"` test body an assertion that the decoded cell is a max-heap (the adaptor fixture uses the default `less` comparator):

```ts
    expect(pq.heapKind).toBe("max");
```

Run: `npx vitest run tests/stl/adaptor.test.ts`
Expected: PASS (all adaptor tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/viz/stl/adaptor.ts frontend/src/viz/memoryModel.ts frontend/tests/stl/adaptor.test.ts
git commit -m "feat(stl): classify priority_queue comparator into heapKind"
```

---

### Task 3: Pure heap-tree layout module

Turn the ordered heap array into positioned tree nodes + parent→child edges by index math. Pure — no React, no DOM.

**Files:**
- Create: `frontend/src/viz/stl/heapTree.ts`
- Test: `frontend/tests/stl/heapTree.test.ts`

**Interfaces:**
- Produces:
```ts
export interface HeapNode { cell: NormalizedCell; index: number; row: number; col: number; }
export interface HeapEdge { parent: number; child: number; } // array indices
export interface HeapLayout { nodes: HeapNode[]; edges: HeapEdge[]; rows: number; }
export function buildHeapLayout(children: NormalizedCell[]): HeapLayout;
```
  - `row = floor(log2(index + 1))`.
  - `col = (index - (2^row - 1) + 0.5) / 2^row`, in `(0,1)`.
  - `edges` has one entry per index `> 0`: `{ parent: floor((index-1)/2), child: index }`.
  - `rows` = number of tree levels (0 for empty input).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/stl/heapTree.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildHeapLayout } from "../../src/viz/stl/heapTree";
import type { NormalizedCell } from "../../src/viz/memoryModel";

const node = (i: number): NormalizedCell => ({
  id: `n${i}`, name: `[${i}]`, source: "stack", kind: "scalar",
  address: null, type: "int", displayValue: String(i), rawValue: i,
});
const cells = (n: number) => Array.from({ length: n }, (_, i) => node(i));

describe("buildHeapLayout", () => {
  it("returns an empty layout for no children", () => {
    expect(buildHeapLayout([])).toEqual({ nodes: [], edges: [], rows: 0 });
  });

  it("places a single node at the root", () => {
    const { nodes, edges, rows } = buildHeapLayout(cells(1));
    expect(rows).toBe(1);
    expect(edges).toEqual([]);
    expect(nodes[0]).toMatchObject({ index: 0, row: 0, col: 0.5 });
  });

  it("assigns rows and centers a parent over its two children", () => {
    const { nodes, rows } = buildHeapLayout(cells(3));
    expect(rows).toBe(2);
    const by = (i: number) => nodes.find((n) => n.index === i)!;
    expect(by(0)).toMatchObject({ row: 0, col: 0.5 });
    expect(by(1)).toMatchObject({ row: 1, col: 0.25 });
    expect(by(2)).toMatchObject({ row: 1, col: 0.75 });
    // parent centered over children
    expect(by(0).col).toBeCloseTo((by(1).col + by(2).col) / 2);
  });

  it("emits heap parent edges", () => {
    const { edges } = buildHeapLayout(cells(5));
    expect(edges).toEqual([
      { parent: 0, child: 1 },
      { parent: 0, child: 2 },
      { parent: 1, child: 3 },
      { parent: 1, child: 4 },
    ]);
  });

  it("handles a partial last row", () => {
    const { rows, nodes } = buildHeapLayout(cells(4));
    expect(rows).toBe(3);
    expect(nodes.find((n) => n.index === 3)).toMatchObject({ row: 2, col: 0.125 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stl/heapTree.test.ts`
Expected: FAIL with "Cannot find module '.../heapTree'".

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/viz/stl/heapTree.ts`:

```ts
import type { NormalizedCell } from "../memoryModel";

export interface HeapNode { cell: NormalizedCell; index: number; row: number; col: number; }
export interface HeapEdge { parent: number; child: number; }
export interface HeapLayout { nodes: HeapNode[]; edges: HeapEdge[]; rows: number; }

/** Lay out a heap's backing array as a complete binary tree by index.
 *  col is the node's horizontal center in (0,1); for a complete tree this
 *  places each parent exactly over the midpoint of its two children. */
export function buildHeapLayout(children: NormalizedCell[]): HeapLayout {
  const n = children.length;
  if (n === 0) return { nodes: [], edges: [], rows: 0 };
  const nodes: HeapNode[] = children.map((cell, index) => {
    const row = Math.floor(Math.log2(index + 1));
    const slotsInRow = 2 ** row;
    const slot = index - (slotsInRow - 1);
    return { cell, index, row, col: (slot + 0.5) / slotsInRow };
  });
  const edges: HeapEdge[] = [];
  for (let index = 1; index < n; index++) {
    edges.push({ parent: Math.floor((index - 1) / 2), child: index });
  }
  const rows = Math.floor(Math.log2(n)) + 1;
  return { nodes, edges, rows };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/stl/heapTree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/stl/heapTree.ts frontend/tests/stl/heapTree.test.ts
git commit -m "feat(stl): pure heap-tree layout from backing array"
```

---

### Task 4: HeapTreePanel render component

Render the layout as absolutely-positioned `MemoryCell` nodes over an inline SVG edge layer. Top node tinted, edges 1px `--blue`, panel scrolls horizontally.

**Files:**
- Create: `frontend/src/viz/stl/HeapTreePanel.tsx`
- Modify: `frontend/src/index.css` (panel styles)
- Test: `frontend/tests/stl/HeapTreePanel.test.tsx`

**Interfaces:**
- Consumes: `buildHeapLayout` (Task 3), `MemoryCell`, `NormalizedCell`.
- Produces:
```ts
export function HeapTreePanel(props: {
  cell: NormalizedCell;                 // the priority_queue container cell
  highlightedIds?: Set<string>;
  changedIds?: Set<string>;
  onCharViewToggle?: (cellId: string) => void;
}): JSX.Element;
```
  - Renders one `.heap-node` per child, each wrapping a `<MemoryCell>` with `noPorts` unset (ports keep working). The root node (`index 0`) gets class `heap-node-top`.
  - Renders `edges.length` `<line>` elements inside one `<svg class="heap-edges">`.
  - Container has `data-heap-tree` = the cell id.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/stl/HeapTreePanel.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { HeapTreePanel } from "../../src/viz/stl/HeapTreePanel";
import type { NormalizedCell } from "../../src/viz/memoryModel";

const child = (i: number, v: string): NormalizedCell => ({
  id: `pq-${i}`, name: `[${i}]`, source: "stack", kind: "scalar",
  address: null, type: "int", displayValue: v, rawValue: null,
});

function pqCell(vals: string[]): NormalizedCell {
  return {
    id: "pq", name: "pq", source: "stack", kind: "container", address: null,
    type: "priority_queue<int, vector<int>, greater<int> >",
    displayValue: `priority_queue<int> · ${vals.length}`, rawValue: null,
    containerKind: "priority_queue", elementType: "int", heapKind: "min",
    length: vals.length, children: vals.map((v, i) => child(i, v)),
  };
}

describe("HeapTreePanel", () => {
  it("renders one node per child and one edge per non-root", () => {
    const { container } = render(createElement(HeapTreePanel, { cell: pqCell(["1", "2", "4", "3", "5"]) }));
    expect(container.querySelectorAll(".heap-node").length).toBe(5);
    expect(container.querySelectorAll(".heap-edges line").length).toBe(4);
  });

  it("marks the root node as the top", () => {
    const { container } = render(createElement(HeapTreePanel, { cell: pqCell(["1", "2", "4"]) }));
    const top = container.querySelector(".heap-node-top");
    expect(top?.textContent).toContain("1");
  });

  it("renders nothing but an empty frame for an empty heap", () => {
    const { container } = render(createElement(HeapTreePanel, { cell: pqCell([]) }));
    expect(container.querySelectorAll(".heap-node").length).toBe(0);
    expect(container.querySelector("[data-heap-tree]")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stl/HeapTreePanel.test.tsx`
Expected: FAIL with "Cannot find module '.../HeapTreePanel'".

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/viz/stl/HeapTreePanel.tsx`:

```tsx
import type { NormalizedCell } from "../memoryModel";
import { MemoryCell } from "../MemoryCell";
import { buildHeapLayout } from "./heapTree";

const ROW_H = 64;   // px vertical pitch between tree levels
const SLOT_W = 96;  // px horizontal pitch for the widest row

export function HeapTreePanel({ cell, highlightedIds, changedIds, onCharViewToggle }: {
  cell: NormalizedCell;
  highlightedIds?: Set<string>;
  changedIds?: Set<string>;
  onCharViewToggle?: (cellId: string) => void;
}) {
  const { nodes, edges, rows } = buildHeapLayout(cell.children ?? []);
  const width = 2 ** Math.max(rows - 1, 0) * SLOT_W;
  const height = Math.max(rows, 1) * ROW_H;
  const xy = (index: number) => {
    const n = nodes.find((m) => m.index === index)!;
    return { x: n.col * width, y: n.row * ROW_H + ROW_H / 2 };
  };
  return (
    <div className="heap-tree-scroll" data-heap-tree={cell.id}>
      <div className="heap-tree" style={{ width, height, position: "relative" }}>
        <svg className="heap-edges" width={width} height={height}>
          {edges.map((e) => {
            const p = xy(e.parent), c = xy(e.child);
            return <line key={`${e.parent}-${e.child}`} x1={p.x} y1={p.y} x2={c.x} y2={c.y} />;
          })}
        </svg>
        {nodes.map((n) => (
          <div
            key={n.cell.id}
            className={`heap-node${n.index === 0 ? " heap-node-top" : ""}`}
            style={{ position: "absolute", left: n.col * width, top: n.row * ROW_H, transform: "translateX(-50%)" }}
          >
            <MemoryCell
              cell={n.cell}
              highlightedIds={highlightedIds}
              changedIds={changedIds}
              onCharViewToggle={onCharViewToggle}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/stl/HeapTreePanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add styles**

Append to `frontend/src/index.css`:

```css
.heap-tree-scroll { overflow-x: auto; padding: 4px 0; }
.heap-tree { margin: 0 auto; }
.heap-edges { position: absolute; inset: 0; pointer-events: none; }
.heap-edges line { stroke: var(--blue); stroke-width: 1; }
.heap-node { z-index: 1; }
.heap-node-top > .cell > .cell-head { background: var(--yellow); }
```

- [ ] **Step 6: Verify build passes**

Run: `npm run build`
Expected: PASS (tsc + vite build, no type errors).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/viz/stl/HeapTreePanel.tsx frontend/src/index.css frontend/tests/stl/HeapTreePanel.test.tsx
git commit -m "feat(viz): HeapTreePanel renders a priority_queue as a binary heap tree"
```

---

### Task 5: Header badge + tree toggle + wiring

Add the min/max/heap badge and the `⇄ tree` / `⇄ array` button to a priority_queue cell's header, branch its body to `HeapTreePanel` when toggled on, and thread the toggle state from `MemoryView` (mirroring the char-view toggle).

**Files:**
- Modify: `frontend/src/viz/MemoryCell.tsx` (badge, button, body branch, new props)
- Modify: `frontend/src/viz/MemoryView.tsx` (`heapViews` state + threading to every `MemoryCell` render site)
- Modify: `frontend/src/index.css` (badge style)
- Test: `frontend/tests/stl/HeapTreePanel.test.tsx` (extend with MemoryCell integration cases)

**Interfaces:**
- Consumes: `HeapTreePanel` (Task 4), `cell.heapKind` (Task 2).
- Produces: `MemoryCell` gains props `heapViews?: Set<string>` and `onHeapToggle?: (cellId: string) => void`; both are threaded through every recursive `MemoryCell` call and every `Children` sub-render, exactly like `onCharViewToggle`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/stl/HeapTreePanel.test.tsx`:

```ts
import { screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { MemoryCell } from "../../src/viz/MemoryCell";

describe("priority_queue header badge + tree toggle", () => {
  it("shows a min-heap badge for a greater<> comparator", () => {
    render(createElement(MemoryCell, { cell: pqCell(["1", "2"]) }));
    expect(screen.getByText("min-heap")).toBeTruthy();
  });

  it("shows a '⇄ tree' button that fires onHeapToggle with the cell id", () => {
    const onHeapToggle = vi.fn();
    render(createElement(MemoryCell, { cell: pqCell(["1", "2"]), onHeapToggle }));
    fireEvent.click(screen.getByRole("button", { name: /⇄ tree/ }));
    expect(onHeapToggle).toHaveBeenCalledWith("pq");
  });

  it("renders the tree body (and a '⇄ array' button) when the toggle is on", () => {
    const { container } = render(createElement(MemoryCell, {
      cell: pqCell(["1", "2", "4"]),
      onHeapToggle: vi.fn(),
      heapViews: new Set(["pq"]),
    }));
    expect(container.querySelector("[data-heap-tree]")).toBeTruthy();
    expect(screen.getByRole("button", { name: /⇄ array/ })).toBeTruthy();
  });

  it("renders the flat array body when the toggle is off", () => {
    const { container } = render(createElement(MemoryCell, {
      cell: pqCell(["1", "2", "4"]), onHeapToggle: vi.fn(), heapViews: new Set(),
    }));
    expect(container.querySelector("[data-heap-tree]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stl/HeapTreePanel.test.tsx -t "header badge"`
Expected: FAIL (no `min-heap` text / no `⇄ tree` button — props not yet supported).

- [ ] **Step 3: Add the two props to MemoryCell**

In `frontend/src/viz/MemoryCell.tsx`, extend `MemoryCellProps`:

```ts
  /** Cell ids currently showing the binary-tree view (priority_queue only), and
   *  the toggle that flips a pq cell between flat array and tree. */
  heapViews?: Set<string>;
  onHeapToggle?: (cellId: string) => void;
```

Add `heapViews, onHeapToggle` to the destructured params of both `MemoryCell` and `Children`, and pass them through on EVERY `<MemoryCell .../>` call inside `Children` (the grid, the depth-3 slices, and the default list) and the matrix branch — alongside the existing `onCharViewToggle` on each.

- [ ] **Step 4: Render the badge and toggle button in the header**

In `MemoryCell`, right after the `charViewToggle` button block inside `.cell-head`, add:

```tsx
        {cell.containerKind === "priority_queue" && (
          <span className="heap-badge">
            {cell.heapKind === "min" ? "min-heap" : cell.heapKind === "max" ? "max-heap" : "heap"}
          </span>
        )}
        {cell.containerKind === "priority_queue" && onHeapToggle && (
          <button
            className={`heap-view-toggle${heapViews?.has(cell.id) ? " heap-view-on" : ""}`}
            title={heapViews?.has(cell.id) ? "Show as array" : "Show as heap tree"}
            onClick={(e) => { e.stopPropagation(); onHeapToggle(cell.id); }}
          >
            {heapViews?.has(cell.id) ? "⇄ array" : "⇄ tree"}
          </button>
        )}
```

- [ ] **Step 5: Branch the body to the tree panel**

In `MemoryCell`, replace the children-render line:

```tsx
      {hasKids && <Children cell={cell} highlightedIds={highlightedIds} changedIds={changedIds} forceLinear={forceLinear} noPorts={noPorts} dpViews={dpViews} onDpToggle={onDpToggle} onCharViewToggle={onCharViewToggle} dpReadSteps={dpReadSteps} />}
```

with a branch (add `import { HeapTreePanel } from "./stl/HeapTreePanel";` at the top):

```tsx
      {cell.containerKind === "priority_queue" && heapViews?.has(cell.id) ? (
        <HeapTreePanel cell={cell} highlightedIds={highlightedIds} changedIds={changedIds} onCharViewToggle={onCharViewToggle} />
      ) : (
        hasKids && <Children cell={cell} highlightedIds={highlightedIds} changedIds={changedIds} forceLinear={forceLinear} noPorts={noPorts} dpViews={dpViews} onDpToggle={onDpToggle} onCharViewToggle={onCharViewToggle} onHeapToggle={onHeapToggle} heapViews={heapViews} dpReadSteps={dpReadSteps} />
      )}
```

- [ ] **Step 6: Run the component tests**

Run: `npx vitest run tests/stl/HeapTreePanel.test.tsx`
Expected: PASS (all HeapTreePanel + header/toggle cases).

- [ ] **Step 7: Wire the toggle state in MemoryView**

In `frontend/src/viz/MemoryView.tsx`, next to `charView` state (~line 28), add:

```ts
  const [heapViews, setHeapViews] = useState<Set<string>>(new Set());
  const toggleHeap = (cellId: string) =>
    setHeapViews((prev) => {
      const n = new Set(prev);
      if (n.has(cellId)) n.delete(cellId); else n.add(cellId);
      return n;
    });
```

Then add `heapViews={heapViews} onHeapToggle={toggleHeap}` to EVERY `<MemoryCell .../>` render site in this file (globals map, stack frame cells, heap map, and the `FrameCells` sub-component's cells) — the same set of sites that already pass `onCharViewToggle={toggleCharView}`. Also thread `heapViews`/`onHeapToggle` through the `FrameCells` prop type and destructure (mirror `onCharViewToggle`).

- [ ] **Step 8: Add the badge style**

Append to `frontend/src/index.css`:

```css
.heap-badge {
  font: 12px var(--mono);
  border: 1px dotted var(--ink);
  padding: 0 4px;
  margin-left: 6px;
  color: var(--ink-soft);
}
.heap-view-toggle { margin-left: 6px; }
```

- [ ] **Step 9: Verify build + full frontend test run**

Run: `npm run build && npm test`
Expected: PASS (typecheck clean, all tests green).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/viz/MemoryCell.tsx frontend/src/viz/MemoryView.tsx frontend/src/index.css frontend/tests/stl/HeapTreePanel.test.tsx
git commit -m "feat(viz): priority_queue heap badge + array/tree toggle wiring"
```

---

### Task 6: End-to-end verification with a real trace

Confirm the feature works on a real backend trace (the `findKthLargest` min-heap example), not just unit tests.

**Files:** none (manual/scripted verification).

- [ ] **Step 1: Run the stack and open the app**

Run: `./run.sh` (from repo root). Wait for backend `:8000` and frontend `:5173`.

- [ ] **Step 2: Trace the min-heap example**

Paste the `findKthLargest` program (`priority_queue<int, vector<int>, greater<int>> minHeap`) into the editor and run the trace.

- [ ] **Step 3: Verify the tree view**

Step to a point where `minHeap` has ≥ 3 elements. Confirm:
- The `minHeap` header shows a `min-heap` badge and a `⇄ tree` button.
- Clicking `⇄ tree` draws a binary tree: root at top with blue edges to children, root tinted yellow.
- The root value equals the smallest element in the heap (min-heap invariant).
- Clicking `⇄ array` returns to the flat array; stepping still highlights only changed nodes.

- [ ] **Step 4: Spot-check a nested payload**

Trace the `kClosest` program (`priority_queue<pair<int,pair<int,int>>, ...>`), toggle its tree, and confirm each node renders the nested pair correctly and nodes do not overlap (panel scrolls if wide).

- [ ] **Step 5: Commit any fixups**

If Steps 3–4 surfaced CSS/layout fixes, apply them, re-run `npm run build && npm test`, and commit:

```bash
git add -A
git commit -m "fix(viz): heap-tree layout polish from end-to-end check"
```

---

## Self-Review Notes

- **Spec coverage:** comparator parse + custom case (Tasks 1–2), pure layout with parent-centering (Task 3), inline-SVG render + payload variety + top tint + overflow scroll (Task 4), badge + toggle + nested placement threading + diff rule reuse (Task 5), real-trace verification incl. nested payload (Task 6). All spec sections mapped.
- **Type consistency:** `heapKind: "min" | "max" | "custom"`, `buildHeapLayout`, `HeapNode/HeapEdge/HeapLayout`, `heapViews`/`onHeapToggle`, `topLevelTemplateArgs`, `classifyHeap` used identically across tasks.
- **Diff rule:** node cells reuse the pq's existing logical child ids (unchanged from the array view), so `changedIds`/`highlightedIds` tint only the changed node — no extra work needed beyond passing the sets through.
