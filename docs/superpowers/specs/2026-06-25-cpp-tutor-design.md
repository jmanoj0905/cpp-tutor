# cpp-tutor — Design Spec

**Date:** 2026-06-25
**Status:** Approved, ready for implementation plan

## Goal

A self-hosted clone of [pythontutor.com](https://pythontutor.com), scoped to **C and C++ only**, with full feature parity to pythontutor's C/C++ visualizer plus enhancements. User writes C/C++, clicks Visualize, and steps forward/backward through execution watching the stack, heap, arrays, structs, and pointer arrows update in real time.

## Scope decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Languages | C and C++ only | Matches project name; few good tools exist for C/C++ memory visualization |
| Execution model | Backend sandbox (server-side) | Real compilation + Valgrind memory tracking; not feasible client-side |
| Fidelity | Full pythontutor parity + extras | User wants every feature pythontutor offers |
| Tracer | Reuse Philip Guo's `opt-cpp-backend` (Valgrind-based) | Same engine real pythontutor uses; fastest path to accurate traces |
| Trace schema | Reuse pythontutor trace JSON schema | Lets us mirror proven renderer semantics |
| Backend | Python + FastAPI | Natural orchestration of the tracer + sandbox |
| Frontend | React + Vite + SVG/D3 | Full control over pointer-arrow rendering |
| Sandbox | Docker per-run | Locked-down container: no net, mem/CPU/time caps, non-root |

## Non-goals (YAGNI)

- Other languages (Python, Java, JS) — C/C++ only.
- User accounts / auth — share links are anonymous.
- Live collaboration / teacher mode — out of scope for v1.
- Mobile-first design — desktop-first; responsive is best-effort.

## Architecture

```
Frontend (React + Vite + SVG/D3)
  Editor pane: CodeMirror 6, C++ highlight, line markers, breakpoints, inline errors
  Viz pane: Stack | Heap columns, pointer arrows (SVG), drag/hide objects
  VCR controls: First / Prev / Next / Last + slider + step counter
  Output box, dark mode, share
        |
        |  POST /api/trace {code, lang, opts}
        |  GET  /api/share/:id   POST /api/share
        v
Backend (FastAPI)
  /api/trace      -> orchestrate one run, return full trace JSON
  /api/share      -> persist code+opts, mint short id
  rate-limit, request queue, per-run timeout
        |
        |  docker run --rm (per request)
        v
Sandbox image
  g++/gcc compile -> run under opt-cpp-backend (Valgrind tool + gdb)
  -> emits pythontutor trace JSON
  caps: no network, memory/CPU/time limit, non-root user
```

## Components

Each unit has one clear purpose, a defined interface, and is independently testable.

| Unit | Responsibility | Interface | Depends on |
|---|---|---|---|
| `sandbox-image` | Dockerfile + runner: compile C/C++, run under opt-cpp-backend, emit trace JSON. stdin = source, stdout = JSON | `run_trace.sh <lang>` | opt-cpp-backend, valgrind, g++/gcc |
| `tracer-service` | Orchestrate one run: write code to temp, `docker run`, parse + validate JSON, enforce timeout | `trace(code, lang, opts) -> Trace \| Error` | docker, sandbox-image |
| `api` | FastAPI HTTP layer: `/api/trace`, `/api/share`, rate limiting, queue, timeouts, error mapping | REST JSON | tracer-service, share-store |
| `share-store` | Persist code + opts, mint and resolve short ids | `save(code, opts) -> id`, `load(id) -> {code, opts}` | SQLite |
| `trace-model` | Typed pythontutor schema shared across FE/BE (steps, stack_to_render, heap, ordered_globals, encoded values) | Pydantic (BE) + TS types (FE) | — |
| `viz-engine` | Render a single execution step: stack frames, heap objects, arrays, struct field tables, pointer arrows | `render(step, opts) -> DOM/SVG` | React, SVG/D3 |
| `editor` | CodeMirror 6 wrapper: syntax highlight, execution line markers, breakpoints, error gutter | events + props | CodeMirror 6 |
| `player` | Step state machine: current index, slider, keyboard nav, breakpoint jumps | `goto(i)`, `next()`, `prev()`, `first()`, `last()` | viz-engine |

## Data flow

1. User writes C/C++ → clicks **Visualize** → frontend sends `POST /api/trace`.
2. API → `tracer-service` → `docker run` sandbox → `opt-cpp-backend` emits the full trace JSON (array of execution points).
3. API returns the **entire trace once**. Frontend holds it in memory; stepping is **client-side only** — no server round-trip per step. Prev/Next is instant.
4. **Share**: `POST /api/share` stores code+opts, returns `/v/:id`; visiting that URL rehydrates the editor and re-runs (or restores) the trace.

## Error handling

| Failure | Backend response | Frontend behavior |
|---|---|---|
| Compile error | `{status: "compile_error", message, line}` | Inline gutter marker + red banner; no crash |
| Runtime crash / segfault | Trace truncates with an `exception`/`uncaught_exception` event at the last point | Show the crash at the final step with message |
| Infinite loop / timeout | Sandbox time cap kills run; `503` with reason | "Program ran too long — try a smaller example" |
| Memory cap exceeded | Sandbox mem cap kills run; `503` | Same friendly message |
| Sandbox/internal error | `500` | Generic retry message; log server-side |

## Testing strategy

- **sandbox-image**: golden C/C++ inputs (pointers, dynamic arrays, structs, recursion, linked list, `new`/`delete`, segfault) → assert trace JSON shape and key fields.
- **trace-model**: round-trip parse of real pythontutor trace fixtures.
- **viz-engine**: per-step fixture snapshot tests (frames, arrows, arrays, heap).
- **api**: contract tests for `compile_error`, `timeout`, happy path, share save/load.
- **e2e**: `browse` skill drives the real Visualize flow against a running stack and diffs rendered output.

## Feature parity checklist

Parity with pythontutor C/C++:

- [ ] C and C++ language selection
- [ ] Stack frames with named variables
- [ ] Heap objects column
- [ ] Arrays rendered as indexed cells (type + value per slot)
- [ ] Struct/object field tables (name | type | value)
- [ ] Pointer rendering: `NULL (0x0)`, and curved arrows to pointee (incl. cross-region stack→heap)
- [ ] VCR controls: First / Prev / Next / Last
- [ ] Step slider + step counter ("Done running (N steps)")
- [ ] Line markers: "line that just executed" (green), "next line to execute" (red)
- [ ] Print output box (resizable)
- [ ] Toggle: show memory addresses (none / default / detailed)
- [ ] Toggle: heapPrimitives (nest primitives vs render as objects)
- [ ] Toggle: textReferences (pointer arrows ↔ text)
- [ ] Move and hide objects (drag)
- [ ] Edit-this-code link / mode

Enhancements beyond parity:

- [ ] Dark mode toggle
- [ ] Share links (anonymous, short id)
- [ ] Breakpoints in editor with jump-to-breakpoint stepping
- [ ] Syntax highlighting (CodeMirror 6)
- [ ] Inline compile-error display
- [ ] Richer C++ memory view: types, sizes, smart pointers (`unique_ptr`/`shared_ptr`)

## Build phases (basis for the implementation plan)

1. **Tracer proof**: `sandbox-image` building in Docker and emitting valid trace JSON for one C++ program. De-risks the opt-cpp-backend version pins first.
2. **Backend**: `tracer-service` + FastAPI `/api/trace`.
3. **Minimal viz**: `trace-model` types + stack frames + variable values (no arrows yet).
4. **Full memory render**: pointer arrows, arrays, heap, struct field tables.
5. **Interaction**: `editor` + VCR controls + slider + line markers.
6. **Toggles**: memory addresses, heapPrimitives nesting, textReferences, drag/hide.
7. **Extras**: dark mode, share links + `share-store`, breakpoints, inline compile errors.

## Key risk

`opt-cpp-backend` is old and pins specific Valgrind + g++ versions. **Phase 1 must prove it builds and runs inside Docker before any other work.** If it proves unworkable, the escape hatch is a gdb-Python-API tracer (less accurate heap tracking, far simpler) emitting the same trace schema — the rest of the system is unaffected because everything downstream depends only on `trace-model`, not on how the trace was produced.
