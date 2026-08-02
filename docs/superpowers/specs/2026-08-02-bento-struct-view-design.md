# Bento view for nested struct-like cells

**Date:** 2026-08-02
**Status:** Design approved, ready for implementation plan

## Problem

`vector<pair<int, pair<int, int>>>` (and any nested struct/pair/tuple) renders as
lopsided nested boxes in the stack view. The user reads it as a 3-column table, but
`pair<int, pair<int,int>>` shows as one box `first` plus an inner box holding
`{first, second}` — an asymmetric nest that is hard to parse. The structure is
already correct in the data model; what's missing is a layout that makes the
`{a, {b, c}}` shape legible.

## Goal

A **bento** layout: each struct-like value renders as a tight row of tiles, where a
nested struct child becomes its own bordered *compartment* containing its own tile
row. Recursion handles arbitrary depth. Applied generically to any nested
struct-like value, anywhere it appears.

```
pair<int, pair<int,int>>  {60, {60, 10}}   →   ┌─────┬───────────┐
                                                │ 60  │ ┌────┬───┐ │
                                                │     │ │ 60 │10 │ │
                                                │     │ └────┴───┘ │
                                                └─────┴───────────┘
```

## Scope

**In scope — cells that render bento:** any cell that is struct-like:
- `kind === "struct"` (plain user structs), or
- `kind === "container"` with `containerKind` in `{ "pair", "tuple" }`.

Applied **recursively per cell**. A nested struct child renders its own bento
compartment.

**Out of scope — unchanged:** vectors, arrays, maps/sets, strings, scalars,
references. A `vector<pair<...>>` keeps its existing array grid/matrix/linear layout
on the outside; only each element (a pair) renders bento inside.

## Key decision: independent tiles, no sibling coordination

Chosen for robustness ("do whatever will never break for any code"). Bento is a
**purely per-cell recursive layout treatment**. There is:
- no cross-row/column alignment,
- no shared grid tracks,
- no sibling shape detection or measurement.

Rows of a vector each size to their own content (ragged edges are acceptable). This
cannot break on ragged, variable, or deeply nested siblings because no sibling ever
depends on another. Deep nesting simply nests more compartments.

## Design

### Data layer — `frontend/src/viz/memoryModel.ts`

Set a `bento: true` marker on struct-like cells during decode/normalize. Pure, no
React/DOM (preserves the existing purity contract). For nested
`pair<int, pair<int,int>>`, both the outer pair and the inner pair carry the flag.

### Render — `frontend/src/viz/MemoryCell.tsx`

In `Children`, when `cell.bento` is set, emit
`<div className="cell-children bento">` with a horizontal tile-row branch. Nested
struct children recurse through the same `MemoryCell`, so each nested compartment
picks up its own `.bento`. Every other branch (grid, matrix, kv, linear, string
collapse) is untouched.

Member names (`first`/`second`, tuple `[0]`, struct field names) render as tiny
dimmed captions in each tile's corner — kept, not dropped, so the view stays
truthful to the underlying members.

### Interaction with existing layout

- **Orthogonal to arrays.** The bento branch is chosen only for struct-like cells;
  vectors/arrays keep grid/matrix/linear. A `vector<pair<...>>` = array grid outside,
  bento inside each element. No collision.
- **Depth safety fallback.** The existing `forceLinear` (depth ≥ 4) still wins, so
  very deep nests flip to plain linear and never explode horizontally.
- **Diff/highlight unchanged and free.** Bento is layout-only. A changed leaf tile
  still gets `cell-changed`; if a struct's own summary changes, only its header tints
  (per the container diff rule). No highlight logic is touched.
- **Connectors keep resolving.** Tiles use the same recursive `MemoryCell`, so they
  still carry `data-cell-id` / `data-port-id`. Pointer lines into a pair member
  resolve as before.

### CSS — `frontend/src/index.css`

`.bento` = flex row with wrap; compartment tile borders; a corner-caption class.
Bauhaus theme only: dotted 1px borders, square corners, 12px mono, caption in
`--ink-soft`. No new dependencies.

## Testing (TDD)

- **`memoryModel` unit:** `bento` flag set for pair / tuple / struct; absent for
  vector / scalar / map. Nested `pair<int, pair<int,int>>` → outer and inner both
  flagged.
- **`MemoryCell` render:** struct-like cell emits `.bento`; array does not; changed
  leaf still gets `cell-changed`; tiles carry `data-cell-id`.
- **Build:** `npm run build` (tsc) is the typecheck gate.

## Non-goals

- Cross-row column alignment / table gridding.
- Any opt-in toggle (bento is always-on for struct-like cells).
- Changes to how maps/sets/vectors/strings render.
