# Trie shape detection — design

## Problem

The self-referential heap-shape detector (`frontend/src/viz/shapes.ts`) recognizes
only two shapes, both hard-wired to *named direct pointer members*:

- exactly 1 self-pointer member → `list`
- exactly 2 self-pointer members → `tree`

A trie node holds its self-pointers inside a **fixed-size array member**, e.g.

```cpp
class TrieNode {
public:
    TrieNode *children[26];
    bool endOfWord;
};
```

`selfPointerMemberNames` only inspects direct child cells whose *own* type is
`T *`; the `children` member decodes as an `array` cell, so it counts **zero**
self-pointers. The type is therefore never bucketed as a shape and the trie
renders as raw heap structs with unresolved pointer soup.

Goal: detect a struct with an array of pointers-to-own-type as a new `trie`
shape, render it as an N-ary tree with the array **index → character** on each
edge and a terminal marker on `endOfWord` nodes.

## Scope

In scope:
- Detect `trie` from a struct that has an array member whose elements are
  pointers to the owning struct type (any array size).
- N-ary layout and rendering, edge labels, terminal-node marking.

Out of scope (YAGNI):
- N-ary trees expressed as ≥3 *named* self-pointer members (no array). Not
  needed for tries; can be added later if a real program needs it.
- Char alphabets other than 26-slot lowercase (`'a'+i`). Any non-26 array falls
  back to a numeric `[i]` edge label.
- Compaction of single-child chains (radix/patricia view). Render every node.

## Design

### 1. Detection (`shapes.ts`)

New pure helper:

```ts
// The array child (if any) whose elements are pointers to `cell`'s own type.
function selfArrayMember(cell, byAddr): NormalizedCell | null
```

Two-signal proof, mirroring `selfPointerMemberNames`:
1. **By type** — an array child whose element cells have type matching
   `^(struct|class )?<own>\s*\*$`.
2. **By address** — real tracer collapses pointer element types to the literal
   `"pointer"`; then an array member counts as self when at least one element
   resolves via `targetAddress` to another cell of this exact struct type in the
   same type group. An unrelated array (`int[26]`, `char*[8]`) essentially never
   resolves to a same-struct cell, so no false positive.

`ShapeKind = "list" | "tree" | "trie"`. Detection precedence: a struct with a
self-array is a `trie` regardless of any named self-pointer count; otherwise the
existing 1→`list` / 2→`tree` rules apply.

`TypeGroup` and `ShapeInfo` carry, per trie type, the self-array member name and
its element count (drives the char-vs-index label decision). The array member
name is added to `selfNames` for that type so the array is excluded from a
node's rendered payload, exactly as named self-pointers already are.

### 2. Model building (`shapes.ts`)

- `ShapeEdge` gains `label?: string`.
- `buildTrieEdges(group)`: for each node, walk the self-array member's element
  cells; `slot = array index`; skip null / unresolved elements; resolve
  `targetAddress → target cell`; emit
  `{ fromId, toId, member: "<arr>[i]", memberCellId, slot, label }` where
  `label = elemCount === 26 ? String.fromCharCode(97 + i) : String(i)`.
- Reuse the existing `buildTreeModel` traversal for `trie`. It is already N-ary:
  it builds a `children` map from edges, sorts by `slot`, does a tolerant
  pre-order from in-degree-0 roots, and handles detached / cyclic components.
  Only the edge source differs (`buildTrieEdges` instead of `buildEdges`), so
  `buildEdges` is parameterized or `buildTreeModel` takes a precomputed edge
  list.
- `ShapeNode` gains `terminal?: boolean`, set when the node has a boolean
  payload member whose value is true (`endOfWord`). Node `label` remains the
  joined non-self payload; for a trie that is typically empty, so nodes render
  as small boxes and the **edge char** carries identity.

### 3. Confirmation (`shapes.ts`)

- `confirmGroup` for `trie` reuses the existing `tree` branch: acyclic and every
  in-degree ≤ 1 (a well-formed trie is a tree). No new strict-check logic.
- `confirmShapeTypes` records trie types and their self-array member name over
  the whole trace, using the same sticky "confirmed at any step" mechanism, so a
  trie only fully populated at a later step is recognized at earlier steps too.

### 4. Layout (`shapeLayout.ts`)

- Add `layoutTrie(shape, widthOf)`: generic N-ary band packing. Port the
  algorithm already proven in `treeLayout.ts` (call-tree layout): each subtree
  owns a horizontal band, parents centered over the span of their visible
  children, clamped inside their band, depth → row. Operates on the same
  `children` map the trie model exposes via its edges.
- `layoutShape` dispatches `trie → layoutTrie`. The existing binary `layoutTree`
  (`[left, right]` slots) is left untouched → zero regression risk for trees.

### 5. Render (`ShapePanel.tsx`, `index.css`)

- Widen the `kind` param to include `trie`.
- Trie edges draw center-bottom → center-top (same geometry as tree edges), plus
  a midpoint `<text>` label (the char) when `e.label` is set — 12px mono,
  Bauhaus, small offset off the line so it doesn't overlap the stroke.
- `terminal` nodes get a `.shape-node-terminal` class: an accent ring using
  `--blue` / a double dotted border, so completed words stand out from prefix
  nodes. Non-conflicting with `shape-node-changed` / `-selected` / `-detached`.

## Testing (TDD, viz layer)

Pure-layer tests first, each written failing then implemented minimally, one
logical change per commit.

- `tests/shapes.test.ts`:
  - trie detected from a struct with an array-of-self-ptr member (both the
    typed-element and `"pointer"`-collapsed + address-resolved paths);
  - edge labels are `a`,`p`,`p`,`l`,`e` for a 26-slot array following those
    indices; numeric `[i]` fallback when element count ≠ 26;
  - `terminal` flag set from a true `endOfWord` bool payload;
  - sticky confirmation across steps;
  - **regression**: existing list and binary-tree fixtures still detect as
    `list` / `tree` unchanged.
- `tests/shapeLayout.test.ts`: N-ary trie layout produces non-overlapping bands
  and monotonic depth rows.

### Fixture

Preferred (repo convention): generate a **real backend trace** of the sample
trie program via the tracer Docker image and add it under
`frontend/tests/fixtures/`, then drive an end-to-end decode → `applyShapes`
test. If the tracer image is unavailable at implementation time, start with a
hand-built synthetic trie `NormalizedMemory` for the pure tests and add the real
fixture once the image is built. Fixtures are generated, never hand-edited.

## Files touched

`shapes.ts`, `shapeLayout.ts`, `ShapePanel.tsx`, `index.css`, plus
`tests/shapes.test.ts`, `tests/shapeLayout.test.ts`, and one fixture. No new
dependencies (React + CodeMirror + plain CSS only).

## Risks

- **Binary-tree false-positive as trie.** A struct with `left`/`right` as named
  members has no array member, so `selfArrayMember` returns null → stays `tree`.
  A struct that *does* use an array of 2 self-pointers would become a trie; this
  is acceptable and arguably more correct.
- **Address-only detection needs a populated step.** A trie whose array elements
  are all null until a later step is handled by the whole-trace sticky
  confirmation, same as the existing `right`-populated-late tree case.
- **Sparse arrays.** `children[26]` is mostly null; only resolved elements emit
  edges and only real children are laid out, so no 26-way fan of empty slots.
