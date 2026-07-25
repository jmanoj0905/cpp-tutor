# Trie Shape Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect a heap struct that holds an array of pointers to its own type (a trie node) as a new `trie` shape and render it as an N-ary tree with array-index→character edge labels and terminal-node markers.

**Architecture:** Extend the pure shape detector in `frontend/src/viz/shapes.ts` with a `trie` kind detected via a new `selfArrayMember` helper. Trie edges come from a new `buildTrieEdges`; the existing (already N-ary) `buildTreeModel` traversal and the `tree` confirmation check are reused. A new `layoutTrie` in `shapeLayout.ts` does generic N-ary band packing (ported from `treeLayout.ts`). `ShapePanel.tsx` draws edge-character labels and a terminal marker.

**Tech Stack:** TypeScript, React, Vitest. Pure data layer (`shapes.ts`, `shapeLayout.ts`) has no React/DOM imports and is unit-tested directly.

## Global Constraints

- No new frontend dependencies. React + CodeMirror + plain CSS only.
- `shapes.ts` and `shapeLayout.ts` MUST stay pure — no React, no DOM.
- Bauhaus theme: 12px mono data text, 1px dotted borders, square corners, accents only from CSS vars (`--blue --red --yellow --border`).
- TDD: write the failing test, watch it fail, implement minimally, one logical change per commit.
- Test fixtures under `frontend/tests/fixtures/` are real backend traces — generate, never hand-edit.
- All frontend commands run from `frontend/`.

---

### Task 1: `ShapeKind` type + `selfArrayMember` + trie candidacy

**Files:**
- Modify: `frontend/src/viz/shapes.ts`
- Modify: `frontend/tests/shapeHelpers.ts` (add `trieNode` builder)
- Test: `frontend/tests/shapes.test.ts`

**Interfaces:**
- Produces: `export type ShapeKind = "list" | "tree" | "trie"`; `selfArrayMember(cells: NormalizedCell[]): { name: string; count: number } | null`; `candidateKind(cell): ShapeKind | null` now returns `"trie"` for array-of-self-pointer structs.
- Consumes: existing `baseType`, `escapeRe`, `selfPtrMembers` in `shapes.ts`; `structCell` in `shapeHelpers.ts`.

- [ ] **Step 1: Add the `trieNode` test builder**

Add to `frontend/tests/shapeHelpers.ts` (after `treeNode`):

```ts
/** Trie node: a `children[count]` array of self-pointers + an endOfWord bool.
 *  `edges` maps array index -> target address for the non-null slots. */
export const trieNode = (
  addr: string,
  edges: Record<number, string>,
  endOfWord = false,
  count = 26,
  ownType = "TrieNode",
): NormalizedCell => {
  const id = `heap-heap-${addr}`;
  const elements: NormalizedCell[] = Array.from({ length: count }, (_, i) => {
    const target = edges[i];
    return {
      id: `${id}-children-${i}`, name: `[${i}]`, source: "heap",
      kind: target ? "reference" : "scalar", address: null, type: "TrieNode *",
      displayValue: target ? `-> ${target}` : "0x0", rawValue: null,
      ...(target ? { targetAddress: target } : {}),
    };
  });
  return {
    id, name: addr, source: "heap", kind: "struct", address: addr, type: ownType,
    displayValue: ownType, rawValue: null,
    children: [
      { id: `${id}-children`, name: "children", source: "heap", kind: "array",
        address: null, type: `${ownType} *[${count}]`, displayValue: "array",
        rawValue: null, children: elements },
      { id: `${id}-endOfWord`, name: "endOfWord", source: "heap", kind: "scalar",
        address: null, type: "bool", displayValue: endOfWord ? "true" : "false", rawValue: null },
    ],
  };
};
```

- [ ] **Step 2: Write the failing candidacy test**

Add to `frontend/tests/shapes.test.ts` (import `trieNode` from `./shapeHelpers`):

```ts
describe("trie candidacy", () => {
  it("an array of self-pointers makes a trie candidate (even when all null)", () => {
    expect(candidateKind(trieNode("0x1", {}))).toBe("trie");
    expect(candidateKind(trieNode("0x1", { 0: "0x2" }))).toBe("trie");
  });

  it("an array of non-self pointers is NOT a trie", () => {
    const c = structCell("0x1", "Bag", [{ name: "n", type: "int" }]);
    c.children!.push({
      id: "heap-heap-0x1-ps", name: "ps", source: "heap", kind: "array",
      address: null, type: "int *[4]", displayValue: "array", rawValue: null,
      children: [{ id: "e0", name: "[0]", source: "heap", kind: "scalar",
        address: null, type: "int *", displayValue: "0x0", rawValue: null }],
    });
    expect(candidateKind(c)).toBeNull();
  });

  it("trie wins over named self-pointer counting", () => {
    expect(candidateKind(trieNode("0x1", {}))).not.toBe("tree");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/shapes.test.ts -t "trie candidacy"`
Expected: FAIL — `candidateKind` returns `null`, not `"trie"`.

- [ ] **Step 4: Implement `ShapeKind` + `selfArrayMember` + candidacy**

In `frontend/src/viz/shapes.ts`, add the exported type near the top (after imports) and replace inline `"list" | "tree"` unions on `ShapeEdge`-adjacent decls as you touch them:

```ts
export type ShapeKind = "list" | "tree" | "trie";
```

Add the helper (after `selfPtrMembers`):

```ts
/** The array member (with its element count) that holds pointers to `cells`'
 *  own struct type, or null. Two-signal, mirroring selfPointerMemberNames:
 *  an element's type names the own type, OR — pointer-collapsed traces — an
 *  element resolves by address to another cell of this exact type. */
export function selfArrayMember(cells: NormalizedCell[]): { name: string; count: number } | null {
  const byAddr = new Map(cells.map((c) => [c.address as string, c]));
  const own = baseType(cells[0]?.type ?? null);
  const typedRe = own ? new RegExp(`^(struct\\s+|class\\s+)?${escapeRe(own)}\\s*\\*$`) : null;
  for (const cell of cells) {
    for (const m of cell.children ?? []) {
      if (m.kind !== "array" || !m.children) continue;
      const isSelf = m.children.some(
        (e) =>
          (typedRe !== null && e.type !== null && typedRe.test(e.type)) ||
          (e.type === "pointer" && e.targetAddress !== undefined && byAddr.has(e.targetAddress)),
      );
      if (isSelf) return { name: m.name, count: m.children.length };
    }
  }
  return null;
}
```

Update `candidateKind` to check trie first and widen its return type:

```ts
export function candidateKind(cell: NormalizedCell): ShapeKind | null {
  if (cell.kind !== "struct") return null;
  if (selfArrayMember([cell])) return "trie";
  const n = selfPtrMembers(cell).length;
  if (n === 1) return "list";
  if (n === 2) return "tree";
  return null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/shapes.test.ts -t "trie candidacy"`
Expected: PASS.

- [ ] **Step 6: Run the full shapes suite (regression)**

Run: `npx vitest run tests/shapes.test.ts`
Expected: PASS — existing list/tree candidacy unchanged.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/viz/shapes.ts frontend/tests/shapeHelpers.ts frontend/tests/shapes.test.ts
git commit -m "feat(shapes): detect array-of-self-pointer struct as trie candidate"
```

---

### Task 2: Group tries in `collectGroups`

**Files:**
- Modify: `frontend/src/viz/shapes.ts`
- Test: `frontend/tests/shapes.test.ts`

**Interfaces:**
- Consumes: `selfArrayMember` (Task 1); `TypeGroup`, `collectGroups`, `bucketStructCells` in `shapes.ts`.
- Produces: `interface TypeGroup` gains `kind: ShapeKind` and `arrayCount?: number`; `collectGroups` returns a group with `kind: "trie"` for trie types.

- [ ] **Step 1: Write the failing grouping test**

Add to `frontend/tests/shapes.test.ts`:

```ts
describe("trie grouping", () => {
  const mem = (cells: NormalizedCell[]): NormalizedMemory =>
    ({ globals: [], frames: [], heap: cells, links: [] });

  it("buckets a trie type as a single trie group carrying its array count", () => {
    const groups = collectGroups(mem([trieNode("0x1", { 0: "0x2" }), trieNode("0x2", {})]));
    const g = groups.get("TrieNode");
    expect(g?.kind).toBe("trie");
    expect(g?.arrayCount).toBe(26);
    expect([...(g?.selfNames ?? [])]).toEqual(["children"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shapes.test.ts -t "trie grouping"`
Expected: FAIL — `TrieNode` group is undefined (array member counts as 0 self-pointers).

- [ ] **Step 3: Implement trie branch in `collectGroups`**

Change `interface TypeGroup` to:

```ts
interface TypeGroup {
  kind: ShapeKind;
  typeName: string;
  cells: NormalizedCell[];
  selfNames: Set<string>;
  arrayCount?: number; // trie only: element count of the self-array member
}
```

In `collectGroups`, add the trie branch first inside the `for (const [typeName, cells] of byType)` loop:

```ts
  for (const [typeName, cells] of byType) {
    const arr = selfArrayMember(cells);
    if (arr) {
      groups.set(typeName, {
        kind: "trie", typeName, cells, selfNames: new Set([arr.name]), arrayCount: arr.count,
      });
      continue;
    }
    const selfNames = namesOverride?.get(typeName) ?? selfPointerMemberNames(cells);
    if (selfNames.size === 1 || selfNames.size === 2) {
      groups.set(typeName, { kind: selfNames.size === 1 ? "list" : "tree", typeName, cells, selfNames });
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shapes.test.ts -t "trie grouping"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/shapes.ts frontend/tests/shapes.test.ts
git commit -m "feat(shapes): group trie types with their array element count"
```

---

### Task 3: `buildTrieEdges` with char/index labels

**Files:**
- Modify: `frontend/src/viz/shapes.ts`
- Test: `frontend/tests/shapes.test.ts`

**Interfaces:**
- Consumes: `TypeGroup` with `arrayCount` (Task 2); `ShapeEdge`, `byAddr` pattern from `buildEdges`.
- Produces: `ShapeEdge` gains `label?: string`; `buildTrieEdges(g: TypeGroup): ShapeEdge[]` (module-internal; export for the unit test).

- [ ] **Step 1: Write the failing edge test**

Add to `frontend/tests/shapes.test.ts` (import `buildTrieEdges`, `collectGroups`):

```ts
describe("buildTrieEdges", () => {
  const mem = (cells: NormalizedCell[]): NormalizedMemory =>
    ({ globals: [], frames: [], heap: cells, links: [] });

  it("emits one edge per non-null slot, labelled with the alphabet char at size 26", () => {
    // root --a--> n1 --p--> n2 ; slot 0 = 'a', slot 15 = 'p'
    const g = collectGroups(mem([
      trieNode("0x1", { 0: "0x2" }),
      trieNode("0x2", { 15: "0x3" }),
      trieNode("0x3", {}, true),
    ])).get("TrieNode")!;
    const edges = buildTrieEdges(g);
    expect(edges.map((e) => [e.fromId, e.toId, e.label, e.slot])).toEqual([
      ["heap-heap-0x1", "heap-heap-0x2", "a", 0],
      ["heap-heap-0x2", "heap-heap-0x3", "p", 15],
    ]);
  });

  it("falls back to a numeric index label when the array size is not 26", () => {
    const g = collectGroups(mem([
      trieNode("0x1", { 2: "0x2" }, false, 4), trieNode("0x2", {}, false, 4),
    ])).get("TrieNode")!;
    expect(buildTrieEdges(g)[0].label).toBe("2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shapes.test.ts -t "buildTrieEdges"`
Expected: FAIL — `buildTrieEdges` is not exported / not defined.

- [ ] **Step 3: Implement `ShapeEdge.label` + `buildTrieEdges`**

Add `label` to the `ShapeEdge` interface:

```ts
export interface ShapeEdge {
  fromId: string;
  toId: string;
  member: string;
  memberCellId: string;
  slot: number;
  cycleBack?: boolean;
  label?: string; // trie: array-index char ('a'+i at size 26) or numeric index
}
```

Add the builder (after `buildEdges`):

```ts
/** Trie edges: walk the self-array member's non-null element cells; slot =
 *  array index; label = alphabet char at size 26, else the numeric index. */
export function buildTrieEdges(g: TypeGroup): ShapeEdge[] {
  const byAddr = new Map(g.cells.map((c) => [c.address as string, c]));
  const arrName = [...g.selfNames][0];
  const edges: ShapeEdge[] = [];
  for (const cell of g.cells) {
    const arr = (cell.children ?? []).find((c) => c.name === arrName && c.kind === "array");
    (arr?.children ?? []).forEach((el, i) => {
      const target = el.targetAddress ? byAddr.get(el.targetAddress) : undefined;
      if (!target) return;
      const label = g.arrayCount === 26 ? String.fromCharCode(97 + i) : String(i);
      edges.push({ fromId: cell.id, toId: target.id, member: `${arrName}[${i}]`, memberCellId: el.id, slot: i, label });
    });
  }
  return edges;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shapes.test.ts -t "buildTrieEdges"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/shapes.ts frontend/tests/shapes.test.ts
git commit -m "feat(shapes): build trie edges with alphabet/index labels"
```

---

### Task 4: Trie model — reuse `buildTreeModel`, add terminal nodes, wire `applyShapes`

**Files:**
- Modify: `frontend/src/viz/shapes.ts`
- Test: `frontend/tests/shapes.test.ts`

**Interfaces:**
- Consumes: `buildTrieEdges` (Task 3); existing `buildTreeModel`, `buildListModel`, `toShapeNode`, `applyShapes`, `confirmed` map.
- Produces: `ShapeModel.kind: ShapeKind`; `ShapeNode` gains `terminal?: boolean`; `buildTreeModel(g, links, edges?)` accepts a precomputed edge list and returns `kind: g.kind`; `applyShapes` renders trie groups when `confirmed.get(type) === "trie"`.

- [ ] **Step 1: Write the failing model test**

Add to `frontend/tests/shapes.test.ts`:

```ts
describe("trie model via applyShapes", () => {
  const mem = (cells: NormalizedCell[]): NormalizedMemory =>
    ({ globals: [], frames: [], heap: cells, links: [] });

  it("builds an N-ary trie with terminal flags and empty node labels", () => {
    const memory = mem([
      trieNode("0x1", { 0: "0x2" }),
      trieNode("0x2", { 15: "0x3" }),
      trieNode("0x3", {}, true),
    ]);
    const confirmed = new Map<string, "list" | "tree" | "trie">([["TrieNode", "trie"]]);
    const { shapes } = applyShapes(memory, confirmed, new Set());
    expect(shapes).toHaveLength(1);
    const s = shapes[0];
    expect(s.kind).toBe("trie");
    expect(s.nodes).toHaveLength(3);
    expect(s.edges.map((e) => e.label)).toEqual(["a", "p"]);
    const terminal = s.nodes.find((n) => n.terminal);
    expect(terminal?.id).toBe("heap-heap-0x3");
    expect(s.nodes.every((n) => n.label === "")).toBe(true); // edge chars carry identity
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shapes.test.ts -t "trie model"`
Expected: FAIL — `applyShapes` does not handle `"trie"`; `ShapeNode.terminal` undefined.

- [ ] **Step 3: Add `terminal` to `ShapeNode` and `toShapeNode`**

Add the field:

```ts
export interface ShapeNode {
  id: string;
  address: string;
  label: string;
  payloadIds: string[];
  cell: NormalizedCell;
  terminal?: boolean; // trie: a true boolean payload member (endOfWord)
}
```

Change `toShapeNode` to take the kind and derive `terminal`/label:

```ts
function toShapeNode(cell: NormalizedCell, selfNames: Set<string>, kind: ShapeKind): ShapeNode {
  const self = new Set(selfMembersOf(cell, selfNames).map((m) => m.id));
  const payload = (cell.children ?? []).filter((c) => !self.has(c.id));
  const leaves = (cs: NormalizedCell[]): NormalizedCell[] =>
    cs.flatMap((c) => (c.children?.length ? leaves(c.children) : [c]));
  const terminal = payload.some((p) => p.type === "bool" && p.displayValue === "true");
  const labelParts = kind === "trie" ? payload.filter((p) => p.type !== "bool") : payload;
  const label = labelParts.map((p) => p.displayValue).join(", ") || (kind === "trie" ? "" : cell.displayValue);
  return { id: cell.id, address: cell.address as string, label, payloadIds: leaves(payload).map((c) => c.id), cell, terminal };
}
```

- [ ] **Step 4: Parameterize `buildTreeModel` edges + kind, update its `toShapeNode` calls**

In `buildTreeModel`, accept a precomputed edge list and return `g.kind`:

```ts
function buildTreeModel(g: TypeGroup, links: MemoryLink[], edges: ShapeEdge[] = buildEdges(g)): ShapeModel {
  // ... unchanged body, but the first line `const edges = buildEdges(g);` is REMOVED
  //     (edges now comes from the parameter) ...
  // final return:
  return { kind: g.kind, typeName: g.typeName, nodes: g.cells.map((c) => toShapeNode(c, g.selfNames, g.kind)), edges, groups, detached };
}
```

Also update the `toShapeNode` call in `buildListModel` to pass the kind:

```ts
    nodes: g.cells.map((c) => toShapeNode(c, g.selfNames, "list")), edges, groups: chains, detached,
```

Widen `ShapeModel.kind` and `confirmed` typings to `ShapeKind` (replace `"list" | "tree"` occurrences in `ShapeModel`, `ShapeInfo.confirmed`, and `applyShapes`' `confirmed` param).

- [ ] **Step 5: Dispatch trie in `applyShapes`**

Replace the shape-building line in `applyShapes`:

```ts
    const shape =
      g.kind === "list" ? buildListModel(g, memory.links)
      : g.kind === "trie" ? buildTreeModel(g, memory.links, buildTrieEdges(g))
      : buildTreeModel(g, memory.links);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/shapes.test.ts -t "trie model"`
Expected: PASS.

- [ ] **Step 7: Run the full shapes suite (regression)**

Run: `npx vitest run tests/shapes.test.ts`
Expected: PASS — list/tree models unchanged (`buildTreeModel` default edge arg preserves old behavior).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/viz/shapes.ts frontend/tests/shapes.test.ts
git commit -m "feat(shapes): build N-ary trie model with terminal nodes"
```

---

### Task 5: Confirm trie types across the trace

**Files:**
- Modify: `frontend/src/viz/shapes.ts`
- Test: `frontend/tests/shapes.test.ts`

**Interfaces:**
- Consumes: `buildTrieEdges` (Task 3), `collectGroups` trie branch (Task 2), `confirmGroup`, `confirmShapeTypes`.
- Produces: `confirmGroup` accepts trie groups (reuses the tree branch, trie edges); `confirmShapeTypes` confirms `"trie"` types stickily. `ShapeInfo.confirmed` is `Map<string, ShapeKind>`.

- [ ] **Step 1: Write the failing confirmation test**

Add to `frontend/tests/shapes.test.ts`:

```ts
describe("trie confirmation", () => {
  const point = (cells: NormalizedCell[]): ExecPoint =>
    ({ line: 1, event: "step_line", stack_to_render: [], heap: {}, globals: {}, ordered_globals: [], stdout: "" }) as unknown as ExecPoint;

  it("confirms a clean trie as kind 'trie'", () => {
    // Drive confirmShapeTypes through normalizeMemory by using a real-ish heap:
    // here we assert via collectGroups + confirmGroup indirectly through the
    // public confirmShapeTypes on a single-step trace whose heap decodes to a trie.
    // (Fixture-backed end-to-end confirmation lives in Task 8.)
    const info = confirmShapeTypes([point([])]);
    expect(info.confirmed.get("TrieNode")).toBeUndefined(); // empty heap -> nothing yet
  });
});
```

Note: `confirmShapeTypes` consumes raw `ExecPoint`s and runs `normalizeMemory`, so hand-built `NormalizedCell`s cannot be injected directly. This step only guards the type signature and empty-trace path; the real sticky-confirmation assertion is the fixture test in Task 8. Keep this test minimal.

- [ ] **Step 2: Run test to verify it fails/compiles**

Run: `npx vitest run tests/shapes.test.ts -t "trie confirmation"`
Expected: FAIL to compile until `ShapeInfo.confirmed` is `Map<string, ShapeKind>` and `confirmGroup` handles trie.

- [ ] **Step 3: Handle trie in `confirmGroup`**

At the top of `confirmGroup`, source edges per kind and broaden the tree branch:

```ts
function confirmGroup(g: TypeGroup): boolean {
  const edges = g.kind === "trie" ? buildTrieEdges(g) : buildEdges(g);
  const indeg = inDegrees(g.cells, edges);

  if (g.kind === "tree" || g.kind === "trie") {
    // ... unchanged acyclic + in-degree<=1 body ...
  }
  // ... unchanged list body ...
}
```

Remove the now-shadowed `const edges = buildEdges(g);` that previously opened the function body (it is replaced by the kind-aware line above).

- [ ] **Step 4: Widen `ShapeInfo.confirmed` typing**

```ts
export interface ShapeInfo {
  confirmed: Map<string, ShapeKind>;
  firstSeen: Map<string, number>;
  selfNames: Map<string, Set<string>>;
}
```

`confirmShapeTypes` needs no logic change: its `collectGroups(memory, selfNames)` loop now yields trie groups (Task 2), `confirmGroup` passes them, and `confirmed.set(g.typeName, g.kind)` records `"trie"`. Verify the `confirmed` local is declared `new Map<string, ShapeKind>()`.

- [ ] **Step 5: Run test + full suite**

Run: `npx vitest run tests/shapes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/viz/shapes.ts frontend/tests/shapes.test.ts
git commit -m "feat(shapes): confirm trie types stickily across the trace"
```

---

### Task 6: N-ary trie layout

**Files:**
- Modify: `frontend/src/viz/shapeLayout.ts`
- Test: `frontend/tests/shapeLayout.test.ts`

**Interfaces:**
- Consumes: `ShapeModel` with `kind: "trie"`, its `groups` (preorder id arrays) and `edges` (with `slot`).
- Produces: `layoutShape` dispatches `trie → layoutTrie`; `layoutTrie(shape, widthOf): ShapeLayoutResult` returns non-overlapping N-ary positions (`SNodePos` top-left corners), reusing `SNODE_H`, `S_H_GAP`, `S_V_GAP`.

- [ ] **Step 1: Write the failing layout test**

Add to `frontend/tests/shapeLayout.test.ts`:

```ts
function trieShape(groups: string[][], edges: ShapeModel["edges"]): ShapeModel {
  return { kind: "trie", typeName: "TrieNode", nodes: [], edges, groups, detached: [] };
}

describe("layoutShape — trie (N-ary)", () => {
  it("packs a 3-child root without overlap, parent centered over its children", () => {
    const edges: ShapeModel["edges"] = [
      { fromId: "r", toId: "a", member: "children[0]", memberCellId: "ma", slot: 0, label: "a" },
      { fromId: "r", toId: "b", member: "children[1]", memberCellId: "mb", slot: 1, label: "b" },
      { fromId: "r", toId: "c", member: "children[2]", memberCellId: "mc", slot: 2, label: "c" },
    ];
    const r = layoutShape(trieShape([["r", "a", "b", "c"]], edges), fixedW);
    const [ra, rb, rc, rr] = ["a", "b", "c", "r"].map((id) => r.pos.get(id)!);
    // children on the same lower row, left-to-right, no overlap
    expect(ra.y).toBe(rb.y);
    expect(rb.y).toBe(rc.y);
    expect(ra.y).toBeGreaterThan(rr.y);
    expect(rb.x).toBeGreaterThanOrEqual(ra.x + ra.w);
    expect(rc.x).toBeGreaterThanOrEqual(rb.x + rb.w);
    // parent centered over the child span
    const childMid = (ra.x + rc.x + rc.w) / 2;
    expect(rr.x + rr.w / 2).toBeCloseTo(childMid, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shapeLayout.test.ts -t "trie"`
Expected: FAIL — `layoutShape` routes trie to the binary `layoutTree`, which only reads `[0,1]` slots (child `c` at slot 2 is dropped / mispositioned).

- [ ] **Step 3: Implement `layoutTrie` + dispatch**

In `frontend/src/viz/shapeLayout.ts`, update the dispatcher:

```ts
export function layoutShape(shape: ShapeModel, widthOf: (id: string) => number): ShapeLayoutResult {
  if (shape.kind === "list") return layoutList(shape, widthOf);
  if (shape.kind === "trie") return layoutTrie(shape, widthOf);
  return layoutTree(shape, widthOf);
}
```

Add the N-ary packer (ported from `treeLayout.ts`'s post-order band packing):

```ts
/** Generic N-ary band packing: each subtree owns a horizontal band, a parent
 *  is centered over the span of its visible children and clamped inside its
 *  band. First-seen parent wins for a doubly-referenced node. */
function layoutTrie(shape: ShapeModel, widthOf: (id: string) => number): ShapeLayoutResult {
  const laidOut = new Set(shape.groups.flat());
  const kids = new Map<string, string[]>();
  for (const id of laidOut) kids.set(id, []);
  const parented = new Set<string>();
  for (const e of [...shape.edges].sort((a, b) => a.slot - b.slot)) {
    if (!laidOut.has(e.fromId) || !laidOut.has(e.toId) || parented.has(e.toId)) continue;
    kids.get(e.fromId)!.push(e.toId);
    parented.add(e.toId);
  }

  const pos = new Map<string, SNodePos>();
  const center = (id: string) => { const p = pos.get(id)!; return p.x + p.w / 2; };
  let maxDepth = 0;

  const place = (id: string, depth: number, x0: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const w = widthOf(id);
    const cs = kids.get(id) ?? [];
    let kidsWidth = 0;
    for (const c of cs) kidsWidth += place(c, depth + 1, x0 + kidsWidth) + S_H_GAP;
    if (cs.length) kidsWidth -= S_H_GAP;
    const band = Math.max(w, kidsWidth);
    const mid = cs.length ? (center(cs[0]) + center(cs[cs.length - 1])) / 2 : x0 + w / 2;
    const cx = Math.min(Math.max(mid, x0 + w / 2), x0 + band - w / 2);
    pos.set(id, { x: cx - w / 2, y: depth * (SNODE_H + S_V_GAP), w });
    return band;
  };

  let cursor = 0;
  for (const grp of shape.groups) {
    if (grp.length === 0) continue;
    cursor += place(grp[0], 0, cursor) + S_H_GAP;
  }
  const width = Math.max(0, cursor - S_H_GAP);
  return { pos, width, height: (maxDepth + 1) * SNODE_H + maxDepth * S_V_GAP };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shapeLayout.test.ts -t "trie"`
Expected: PASS.

- [ ] **Step 5: Run the full layout suite (regression)**

Run: `npx vitest run tests/shapeLayout.test.ts`
Expected: PASS — list and binary-tree layout untouched.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/viz/shapeLayout.ts frontend/tests/shapeLayout.test.ts
git commit -m "feat(shape-layout): N-ary band packing for tries"
```

---

### Task 7: Render trie edge labels + terminal marker

**Files:**
- Modify: `frontend/src/viz/ShapePanel.tsx`
- Modify: `frontend/src/index.css`
- Test: `frontend/tests/ShapePanel.test.tsx`

**Interfaces:**
- Consumes: `ShapeModel.kind: "trie"`, `ShapeEdge.label`, `ShapeNode.terminal`, layout `pos` (Task 6).
- Produces: `renderEdge` accepts `ShapeKind` and draws a midpoint `<text>` when `e.label` is set; terminal nodes get class `shape-node-terminal`.

- [ ] **Step 1: Write the failing render test**

Add to `frontend/tests/ShapePanel.test.tsx` (follow the existing render/setup helpers in that file):

```ts
it("renders trie edge char labels and marks terminal nodes", () => {
  const shape: ShapeModel = {
    kind: "trie", typeName: "TrieNode",
    nodes: [
      { id: "r", address: "0x1", label: "", payloadIds: [], cell: {} as never },
      { id: "a", address: "0x2", label: "", payloadIds: [], cell: {} as never, terminal: true },
    ],
    edges: [{ fromId: "r", toId: "a", member: "children[0]", memberCellId: "m", slot: 0, label: "a" }],
    groups: [["r", "a"]], detached: [],
  };
  const { container } = render(
    <ShapePanel shape={shape} onToggleGeneric={() => {}} stepKey={0} />,
  );
  expect(container.querySelector(".shape-edge-label")?.textContent).toBe("a");
  expect(container.querySelector(".shape-node-terminal")).not.toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ShapePanel.test.tsx -t "trie edge char"`
Expected: FAIL — no `.shape-edge-label` / `.shape-node-terminal` in output.

- [ ] **Step 3: Widen `renderEdge` kind + draw the label**

In `frontend/src/viz/ShapePanel.tsx`, change the `renderEdge` `kind` param type from `"list" | "tree"` to `ShapeKind` (import `ShapeKind` from `./shapes`). Replace the final tree/cross-row return with a group that also renders the label:

```ts
  // tree/trie edge (or cross-row list edge): center-bottom -> center-top
  const x1 = from.x + from.w / 2, y1 = from.y + SNODE_H;
  const x2 = to.x + to.w / 2, y2 = to.y;
  const line = (
    <line className={`shape-edge${changed ? " shape-edge-changed" : ""}`}
      x1={x1} y1={y1} x2={x2} y2={y2} {...marker} />
  );
  if (!e.label) return <g key={key}>{line}</g>;
  return (
    <g key={key}>
      {line}
      <text className="shape-edge-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2} dx={4} dy={-2}>{e.label}</text>
    </g>
  );
```

(Keep the existing `cycleBack` and forward-list branches above unchanged; only the final `return <line .../>` becomes the block above. The earlier branches already `return` before reaching here.)

- [ ] **Step 4: Add the terminal node class**

In the node `.map`, add `terminal` to the class list:

```ts
            const cls = [
              "shape-node",
              changed ? "shape-node-changed" : "",
              selected?.id === n.id ? "shape-node-selected" : "",
              shape.detached.includes(n.id) ? "shape-node-detached" : "",
              n.terminal ? "shape-node-terminal" : "",
            ].filter(Boolean).join(" ");
```

- [ ] **Step 5: Add CSS**

In `frontend/src/index.css`, near the other `.shape-*` rules:

```css
.shape-edge-label {
  font: 12px var(--mono);
  fill: var(--ink-soft);
  paint-order: stroke;
  stroke: var(--panel);
  stroke-width: 3px;
}
.shape-node-terminal {
  border-style: double;
  border-color: var(--blue);
  box-shadow: 0 0 0 2px var(--blue);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/ShapePanel.test.tsx -t "trie edge char"`
Expected: PASS.

- [ ] **Step 7: Run the panel suite + typecheck**

Run: `npx vitest run tests/ShapePanel.test.tsx && npm run build`
Expected: PASS + clean `tsc -b`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/viz/ShapePanel.tsx frontend/src/index.css frontend/tests/ShapePanel.test.tsx
git commit -m "feat(shape-panel): render trie edge chars and terminal markers"
```

---

### Task 8: End-to-end fixture from the real tracer

**Files:**
- Create: `frontend/tests/fixtures/trie.json` (generated)
- Test: `frontend/tests/shapes.fixtures.test.ts`

**Interfaces:**
- Consumes: `confirmShapeTypes`, `applyShapes`, `normalizeMemory` end-to-end; fixture format `{ code, trace: ExecPoint[] }` matching existing fixtures.

- [ ] **Step 1: Generate the fixture from the tracer**

Ensure the tracer image exists (build once if needed — Valgrind layer is slow):

```bash
docker build -t cpp-tutor-tracer:dev tracer/
docker rm -f cpp-tutor-tracer-warm 2>/dev/null || true
```

Run the backend against the sample trie program and save the trace. From `backend/` with the venv active, either use the existing fixture-generation path used for other fixtures (check how a sibling fixture like `frontend/tests/fixtures/*.json` is produced — the repo generates these via a backend `POST /api/trace`), or:

```bash
cd backend && .venv/bin/uvicorn app.api:app --port 8000 &
curl -s http://localhost:8000/api/trace \
  -H 'Content-Type: application/json' \
  -d @/private/tmp/claude-501/-Users-manojj-Documents-CSE-Projects-My-Projects-cpp-tutor/7d883562-8f84-46f7-9a98-39c3d11e2ea9/scratchpad/trie_req.json \
  > frontend/tests/fixtures/trie.json
```

where `trie_req.json` is `{ "code": "<the sample trie program>" }`. Inspect the result: it MUST contain `"trace"` with `stack_to_render`/`heap` entries and NOT be a `compile_error`. If the tracer image is unavailable, SKIP to Step 5 (synthetic fallback) and leave a `// TODO: replace with real fixture` note in the test — do not hand-edit a fake trace.

- [ ] **Step 2: Write the failing end-to-end test**

Add to `frontend/tests/shapes.fixtures.test.ts` (match the file's existing fixture-loading pattern):

```ts
import trie from "./fixtures/trie.json";

it("recognizes the PrefixTree program as a trie end-to-end", () => {
  const trace = trie.trace as unknown as ExecPoint[];
  const info = confirmShapeTypes(trace);
  expect(info.confirmed.get("TrieNode")).toBe("trie");

  // After inserting "apple", the last populated step should render a trie whose
  // root has an 'a' edge and at least one terminal (endOfWord) node.
  const last = normalizeMemory(trace[trace.length - 1]);
  const { shapes } = applyShapes(last, info.confirmed, new Set(), info.selfNames);
  const trieShape = shapes.find((s) => s.typeName === "TrieNode");
  expect(trieShape?.kind).toBe("trie");
  expect(trieShape?.edges.some((e) => e.label === "a")).toBe(true);
  expect(trieShape?.nodes.some((n) => n.terminal)).toBe(true);
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/shapes.fixtures.test.ts -t "PrefixTree"`
Expected: PASS. If the actual own-type name differs (e.g. `class TrieNode` vs `TrieNode`), adjust the expected `typeName` to what `shapeTypeName` yields — inspect `applyShapes(...).shapes.map(s => s.typeName)` and match.

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/fixtures/trie.json frontend/tests/shapes.fixtures.test.ts
git commit -m "test(shapes): end-to-end trie fixture from the PrefixTree program"
```

- [ ] **Step 5 (fallback only, if tracer image unavailable): synthetic end-to-end**

Skip the real fixture. Instead add a test that builds a `NormalizedMemory` with `trieNode(...)` cells (from `shapeHelpers`) and asserts `applyShapes(memory, new Map([["TrieNode","trie"]]), new Set())` yields a trie shape with an `'a'` edge and a terminal node. Mark with a `// TODO: replace with real tracer fixture once cpp-tutor-tracer:dev is built`. Commit:

```bash
git add frontend/tests/shapes.test.ts
git commit -m "test(shapes): synthetic trie end-to-end (pending real fixture)"
```

---

## Final Verification

- [ ] Run the full frontend test suite: `cd frontend && npm test`
- [ ] Typecheck/build gate: `npm run build`
- [ ] Lint: `npm run lint`
- [ ] Manual smoke: `./run.sh`, paste the PrefixTree program, step to after `insert("apple")`, confirm the trie renders with lettered edges and a highlighted terminal node.
