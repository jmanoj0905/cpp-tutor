# Hide compiler internals in the stack view

## Problem

The stack view shows clutter that has no pedagogical value:

1. **Compiler-generated range-for temporaries.** A `for (x : container)` loop makes
   the compiler inject stack locals `__for_range`, `__for_begin`, `__for_end`
   (with undecoded `const_iterator` wrappers exposing `_M_current` pointers).
   These are real stack locals; even a perfect decoder would show them.

2. **A vector decode gap.** An empty (or nested / member) `std::vector` sometimes
   falls through `vectorDecoder` and renders its raw libstdc++ guts —
   `<anon_field>`, `_Vector_base`, `_M_impl`, `_Vector_impl`,
   `_M_start 0x0`, `_M_finish 0x0`, `_M_end_of_storage 0x0` — instead of a clean
   `vector<int> · 0`.

These are two distinct problems and get two distinct fixes.

## Part A — per-frame "internals" toggle

Hide compiler-generated stack locals behind a per-frame collapse control,
hidden by default.

### Classification rule

A stack local is a **compiler internal** iff its name starts with `__`
(double underscore). This is the reserved-identifier convention the compiler
uses for its temporaries (`__for_range`, `__for_begin`, `__for_end`, `__range`,
…). User code cannot legally define names starting with `__`, so this rule
never hides a real variable. No type-sniffing.

Scope: **top-level frame locals only**, not nested struct members.

### Data layer — `frontend/src/viz/memoryModel.ts` (pure)

- Add optional `internal?: boolean` to `NormalizedCell`.
- Add helper `isCompilerInternal(name: string): boolean` = `name.startsWith("__")`.
- In `normalizeFrames`, set `internal: true` on each top-level frame cell whose
  name matches. Globals and heap are untouched.
- Keep the module pure (no React/DOM), per repo convention.

### Render layer — `frontend/src/viz/MemoryView.tsx`

- Extract a small `FrameView` component (one per frame) that owns local
  `useState` for expanded/collapsed, default **collapsed**.
- Split the frame's cells into `visible` (not internal) and `internal`.
- Always render `visible` cells.
- If `internal.length > 0`, render a toggle affordance:
  - collapsed: `▸ {n} internals`
  - expanded: `▾ {n} internals` followed by the internal cells rendered with a
    dimmed CSS class (e.g. `cell-internal`).
- If `internal.length === 0`, render no toggle.
- No new dependencies. Plain React + CSS variables from `index.css`.

### Connectors

Hidden internal cells have no DOM, so their pointer lines are not drawn —
`Connectors` already skips links whose port or target element is missing. This
is the desired behavior: the `__for_*` iterator lines vanish when collapsed and
reappear when expanded.

Toggling adds/removes DOM, which changes layout size and should trip the
existing `ResizeObserver` redraw. Verify the redraw actually fires on toggle;
if it does not, bump the connector redraw trigger when expand state changes.

## Part B — vector decode-gap fix

Ensure **every** `std::vector` renders as a clean `vector<T> · N` container,
never a raw `_Vector_base` / `_M_impl` dump.

`vectorDecoder` already returns a clean empty container when the element buffer
is absent, so the leak means the decoder did not fire on that cell. Suspected
causes: the vector is a struct member or nested element decoded bottom-up (its
`_M_start` buffer consumed before the outer decode), or the cell's `type`
string did not match `/^(?:std::)?vector\s*</`.

Work:

1. Build a minimal C++ repro that produces the raw `_Vector_base` dump
   (empty vector, and/or `vector<vector<int>>`, and/or a struct with a
   `vector` member).
2. Capture it as a real backend trace fixture in
   `frontend/tests/fixtures/` (do not hand-edit).
3. Root-cause why `vectorDecoder` did not match/decode that cell.
4. Fix so the raw guts never render.
5. Regenerate any affected fixtures.

## Part C — bolder variable names

Variable names currently render soft and unweighted:
`.cell-name { color: var(--ink-soft); }`. Make the name a little bolder than
its surroundings so the eye lands on it first.

- `frontend/src/index.css`: give `.cell-name` `font-weight: 600` and switch its
  color from `var(--ink-soft)` to `var(--ink)`.
- Purely visual; no data-layer or test change.

## Testing

TDD, per repo convention — failing test first, then minimal implementation,
one logical change per commit.

- `memoryModel.test.ts`: `__for_range` flagged `internal: true`; a user local
  (e.g. `x`, `count`) not flagged; nested members not flagged.
- `MemoryView.test.tsx`: a frame with internals renders the toggle collapsed by
  default (internal cells absent from DOM); expanding reveals them; a frame with
  no internals renders no toggle.
- Vector fix: a decode/render test driven by the new fixture asserting the
  container form (`vector<int> · 0`) and the absence of `_Vector_base` /
  `_M_impl` text.

## Out of scope

- Hiding undecoded node containers (map/set/list raw guts) — the classification
  rule is `__` prefix only; broadening to type-sniffing is explicitly rejected
  to avoid hiding legitimate user structs.
- Any global (all-frames-at-once) toggle; the control is per-frame.
- Persisting the collapse state across steps or reloads.
