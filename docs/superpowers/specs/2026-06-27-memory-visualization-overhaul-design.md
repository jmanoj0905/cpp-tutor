# Memory Visualization Overhaul Design

Date: 2026-06-27

## Goal

Make cpp-tutor's execution view read like Python Tutor: memory cells connected
by visual pointer lines, with first-class rendering of structs, arrays, and
`std::vector`/`std::string`. Take visual and interaction inspiration from the
sibling project `c-struct-visualizer`, but keep cpp-tutor's existing lightweight
stack (bare React + CodeMirror + custom Bauhaus CSS) rather than adopting React
Flow / tailwind.

This builds on the prior debugger-workspace design
(`2026-06-26-ui-ux-debugger-workspace-design.md`), which established the
two-column layout and the `NormalizedMemory` model. That model already derives
pointer `links` but nothing renders them yet, and `StackView` only shows scalar
values. This spec closes those gaps.

## Decisions

Resolved with the user during brainstorming:

- **Render engine:** lightweight SVG overlay. Keep CSS panels; draw connectors
  from DOM rects (Python-Tutor technique). No React Flow, no elkjs.
- **Aesthetic:** keep and polish the current Bauhaus theme (cream/charcoal,
  red/blue/yellow accents, Space Grotesk + JetBrains Mono).
- **Vector support:** frontend-first. Decode vectors from existing trace data;
  make a targeted backend change only if a real trace proves the heap element
  buffer or size markers are missing.
- **Line coverage:** all references — stack/global→heap, heap→heap, and
  vector→its buffer.

## Scope

In scope:

- Recursive decoding of `C_STRUCT`, `C_ARRAY`, and `C_MULTIDIMENSIONAL_ARRAY`
  in the frontend memory model.
- Detection and clean rendering of `std::vector<T>` (indexed cells + size) and
  `std::string` (text + size).
- An SVG connector layer drawing curved arrows for every resolvable reference,
  recomputed on step change / resize / scroll.
- A `MemoryView` that renders Stack frames, Globals, and Heap in one positioned
  container so connectors can span sections.
- Polished Bauhaus memory cells, section headers, empty/loading/error states.
- Frontend tests for decoding, rendering, and connector geometry.

Out of scope:

- No migration to React Flow, elkjs, tailwind, or new component libraries.
- No `stdin` panel (consistent with the prior spec).
- No draggable/zoomable canvas, node auto-layout, or graph export.
- No guided lessons, variable history, or timeline annotations.
- `std::map`/`std::set`/other containers beyond vector/string are not required;
  they fall through to the generic struct renderer.
- Backend changes only if Risk section's verification fails.

## OPT Trace Format (reference)

Confirmed from `tracer/opt-cpp-backend/vg_to_opt_trace.py`:

- Scalar: `["C_DATA", addr, type, value]`
- Pointer: `["C_DATA", addr, "pointer", addrValue]` or
  `["C_DATA", addr, type, ["REF", target]]`; bare `["REF", target]`
- Struct: `["C_STRUCT", addr, type, [memberName, encodedValue], ...]`
- Array: `["C_ARRAY", addr, elem0, elem1, ...]`
- Multidim array: `["C_MULTIDIMENSIONAL_ARRAY", addr, dimensions, elem0, ...]`
- Heap block: stored in `heap` map as `["C_ARRAY", addr, elem0, ...]`

A `std::vector<T>` arrives as a `C_STRUCT` whose nested `_M_impl` struct holds
pointer members `_M_start`, `_M_finish`, `_M_end_of_storage`. `_M_start`
dereferences (via the encoder's `deref_val` path) into a heap `C_ARRAY` of the
elements. `std::string` is analogous with a char buffer.

## Architecture

Three layers, all frontend.

### Data layer — `frontend/src/viz/memoryModel.ts` (extended)

Pure functions, no React. Produces `NormalizedMemory`.

Current `NormalizedCell` summarizes structs/arrays. Extend it:

- Add child structure to support nesting:
  - `kind` gains `"struct"`, `"array"`, `"vector"`, `"string"` (existing
    `"scalar"`, `"reference"`, `"summary"` remain).
  - `NormalizedCell` gains optional `children?: NormalizedCell[]` (struct members
    or array/vector elements) and optional `length?: number`,
    `elementType?: string`.
- `decodeStruct`: recurse over members → child cells; member cells carry
  `name = memberName`. Detect vector/string by `type` before falling back to a
  generic struct.
- `decodeArray` / `decodeMultidimArray`: recurse elements into `children`,
  index-named (`[0]`, `[1]`, …); set `length`.
- `decodeVector`: locate `_M_start`/`_M_finish` pointer members; resolve
  `_M_start` target in the heap `C_ARRAY`; compute
  `size = (finish − start) / elementSize` from hex addresses, falling back to the
  resolved buffer's element count; produce a `kind:"vector"` cell whose
  `children` are the in-bounds elements and whose `targetAddress`/`targetId`
  point at the heap buffer (so a connector is drawn). `elementType` from the
  template argument in the type string.
- `decodeString`: similar; render the char buffer as a string value plus length.
- Link derivation extends to **all** reference cells anywhere in the tree
  (including nested struct members and the vector→buffer link), not just
  top-level stack/global cells. Heap→heap links included.
- Guard recursion depth and element counts to avoid pathological traces
  (cap children rendered, expose `length` so UI can show "… N more").

### Render layer — `frontend/src/viz/MemoryView.tsx` (new, replaces `StackView`)

- Renders, in one positioned (`position: relative`) container so the overlay can
  be absolute within it: Globals section, Stack frames (function-named cards),
  Heap section.
- A recursive `MemoryCell` component renders any `NormalizedCell`:
  - scalar → value; reference → port dot on the right edge (line anchor);
    struct → nested member rows; array/vector → indexed cells with a
    `vector<T> ▸ size N` header; string → quoted text + length.
  - Each cell root carries `data-cell-id={cell.id}` so the connector layer can
    find DOM rects. Reference source ports carry `data-port-id`.
  - Large containers collapse: render first N elements + a "… M more" toggle.
- `StackView.tsx` is removed; its test file is replaced by `MemoryView` tests.

### Connector layer — `frontend/src/viz/Connectors.tsx` (new)

- An absolutely-positioned, full-size `<svg>` with `pointer-events: none`
  layered over the `MemoryView` container.
- Input: the `links` from `NormalizedMemory` plus a ref to the container.
- In `useLayoutEffect` (and on a `ResizeObserver` + scroll/step change): for each
  link, look up source port and target cell by `data-cell-id` / `data-port-id`,
  measure rects relative to the container, compute a curved cubic-bezier path
  from source right edge to target left edge, with an arrowhead marker.
- Resolved links: solid `--blue`, arrowhead at target. Unresolved references:
  short dashed `--red` stub from the source port (no target).
- Optional hover state: hovering a port or line raises opacity/width of that
  line and both endpoints.
- Recompute triggers: trace step change (new memory), window/container resize,
  container scroll, and collapse/expand toggles.

### Wiring — `frontend/src/App.tsx`

- `Visualized` swaps `StackView` for `MemoryView`, passing the normalized memory
  for the current `player.point`.
- Keeps stdout panel, VCR controls, CodeView, compile/runtime error display,
  loading state on the Run button, and the pre-run empty state.

## Data Flow

```
ExecPoint (trace[i])
  → normalizeMemory()                     [data layer, pure]
      → NormalizedMemory { globals, frames, heap, links }
  → MemoryView renders cells              [DOM with data-cell-id/data-port-id]
  → Connectors reads rects + links        [SVG overlay, useLayoutEffect]
      → curved paths between ports/cells
```

Step change replaces the memory object; React re-renders cells; the connector
effect re-measures and redraws.

## Styling (Bauhaus, extended)

- Reuse existing CSS variables and card/border/radius language in `index.css`.
- New classes for: memory cell, type chip, reference port dot, vector/array grid,
  string value, collapsed-container toggle, section headers, connector svg.
- Connector colors map to existing `--blue` (resolved) and `--red` (unresolved).
- Responsive: single column under the existing 900px breakpoint; connectors
  recompute after the reflow.

## Error & Empty States

- Compile errors stay near the editor (unchanged).
- Runtime/tracer failures remain as visible panels (unchanged).
- Before a trace exists, the memory area shows a compact placeholder.
- A memory cell that cannot be decoded falls back to the existing `summary`
  rendering rather than throwing.
- Unresolved references stay visible (dashed stub), never hidden.

## Testing (TDD)

Data layer (`memoryModel.test.ts`, extended):

- Recursive struct decoding produces child member cells in address order.
- `C_ARRAY` decodes to indexed children with correct `length`.
- `C_MULTIDIMENSIONAL_ARRAY` decodes with dimensions.
- `std::vector` decode: size computed from `(_M_finish − _M_start)/elemSize`,
  children are in-bounds elements, vector→buffer link present.
- Vector size falls back to buffer length when address arithmetic is unavailable.
- `std::string` decode yields text value + length.
- Link derivation includes nested member refs and heap→heap links.
- Unresolved references retain `unresolved: true` and appear in no resolved link.

Render layer (`MemoryView.test.tsx`, new):

- Renders globals, stack frames (by function name), and heap sections.
- Reference cells expose `data-cell-id` and a port with `data-port-id`.
- Vector cell shows `size N` header and indexed children.
- Large container shows the "… N more" toggle.

Connector layer (`Connectors.test.tsx`, new):

- Given mocked element rects, draws one path per resolved link with endpoints at
  source-right / target-left.
- Unresolved reference renders a dashed stub and no full path.

Unchanged: `usePlayer`, `Vcr`, `client` tests stay green.

## Risk / Verification

Primary risk: a real `std::vector` trace may not contain the heap element buffer
or the `_M_finish` marker, if gdb does not expand `_M_impl` or deref `_M_start`.

Verification step (first implementation task): build/run the tracer on a small
`std::vector<int>` program and inspect the JSON. Confirm presence of:

1. the vector `C_STRUCT` with `_M_start`/`_M_finish` pointer members, and
2. a heap `C_ARRAY` at `_M_start`'s target holding the elements.

If both present → frontend-only, as designed. If missing → targeted patch in
`vg_to_opt_trace.py` / `run_cpp_backend.py` to dump the buffer and size, scoped
to exactly that gap. No broader backend work.

## Acceptance Criteria

- Pointer/reference relationships render as visible curved connector lines for
  all resolvable references; unresolved refs show a dashed stub.
- `std::vector<T>` renders as a labeled, size-aware indexed view connected to its
  heap buffer; `std::string` renders as text + length.
- Structs and arrays render with their nested contents, not as `{...}`.
- Connectors stay correct across stepping, resize, scroll, and collapse/expand.
- The UI keeps the Bauhaus aesthetic and remains responsive without horizontal
  page scrolling.
- Frontend tests and the production build pass.
```
