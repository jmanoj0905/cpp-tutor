# UI/UX Debugger Workspace Design

Date: 2026-06-26

## Goal

Improve cpp-tutor so the execution state is easy to inspect while editing code. The UI should feel like a compact teaching debugger: source code and playback controls on the left, program output and memory state on the right.

## Scope

In scope:

- Keep the C++ code editor on the left.
- Add a step slider that moves through the trace and highlights the active source line.
- Keep four playback buttons: `<< First`, `< Prev`, `Next >`, and `Last >>`.
- Show `stdout` on the right.
- Show stack memory and heap memory on the right.
- Decode scalar values, pointers, references, and heap entries into readable memory cells where the OPT trace format gives enough information.
- Draw arrows from stack/global pointer values to matching heap targets when references can be resolved.
- Keep unresolved references visible instead of hiding them.
- Improve the visual hierarchy, responsive layout, empty states, and loading/error states.

Out of scope:

- No `stdin` panel or program input support.
- No backend changes unless the existing trace data cannot support a required display.
- No guided lessons, hints, variable history, or timeline explanations.

## UX Design

The app becomes a two-column debugger workspace.

The left column contains the editor at the top. After a trace is available, it also shows a step timeline slider and the VCR controls. The slider maps directly to `usePlayer.goto(index)`, displays the current step count, and helps users scrub through execution faster than repeated button clicks.

The right column contains execution state. `stdout` appears first because it is the simplest user-facing program result. Stack memory follows, grouped by function frame. Heap memory follows stack memory, with heap entries shown as addressable cells.

On smaller screens, the layout collapses into a single column: editor, controls, stdout, stack, heap.

## Memory Model

The frontend will normalize OPT values before rendering them:

- `["C_DATA", address, type, value]` scalar values render as their scalar value.
- `["C_DATA", address, type, ["REF", target]]` values render as pointer/reference cells.
- Bare `["REF", target]` values render as reference cells.
- Object and array values render as summarized cells until the trace format can be decoded more deeply.

The memory view should keep both the user-facing value and the raw address/reference available in the UI. When a pointer target matches a heap entry, the view draws an arrow from the pointer cell to the target heap cell. When the target cannot be matched, the pointer remains visible with an unresolved style.

## Components

Expected frontend components:

- `App`: owns code, trace, loading, error, and visualization state.
- `Editor`: remains the CodeMirror source editor.
- `Vcr`: grows to include the slider and four playback buttons.
- `CodeView`: continues to display traced code with the active line.
- `MemoryView`: new view that renders stack and heap sections together so arrows can span them.
- Memory normalization helpers: pure functions for decoding OPT values and deriving pointer links.

## Error Handling

Compile errors stay visible near the editor so users can fix code without scanning the whole page.

Runtime/tracer failures remain visible as error panels. During trace generation, the run button should show a loading state and prevent duplicate submissions.

Empty states should be clear but compact. Before tracing, the right side can show an execution placeholder instead of blank space.

## Testing

Frontend tests should cover:

- The slider calls `goto` and updates the displayed step.
- The active source line follows the selected trace point.
- `stdout` renders on the right.
- Stack scalar values render in frame order.
- Pointer/reference values render as reference cells.
- Heap entries render when present.
- Resolved pointer links are derived when a target matches a heap entry.
- Unresolved references remain visible.

Existing API/client tests should remain valid because `stdin` is not being added.

## Acceptance Criteria

- The first screen clearly presents a code editor and a way to run/visualize execution.
- After tracing, the user can scrub steps with a slider and use the four playback buttons.
- The active code line is visually obvious.
- The right side contains `stdout`, stack memory, and heap memory, with no `stdin`.
- Pointer/reference relationships are shown with arrows when resolvable.
- The UI is responsive and does not rely on horizontal page scrolling.
- Frontend tests and production build pass.
