# Hide Compiler Internals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide compiler-generated stack locals behind a per-frame toggle (hidden by default), fix the empty-vector decode gap that leaks raw libstdc++ guts, and make variable names a little bolder.

**Architecture:** Pure data layer (`memoryModel.ts`) flags top-level stack locals whose name starts with `__` as `internal`. The render layer (`MemoryView.tsx`) splits each frame's cells into visible + internal and gates the internal cells behind per-frame expand state lifted to `MemoryView` (so toggling recomputes `links` and forces the connector overlay to redraw). The vector decode fix distinguishes a missing `_M_start` member (not a vector) from a null `_M_start` pointer (empty vector).

**Tech Stack:** React + Vite + TypeScript, vitest + @testing-library/react, plain CSS variables. No new dependencies.

## Global Constraints

- No new frontend dependencies (React + CodeMirror + plain CSS only).
- `memoryModel.ts` and `connectorGeometry.ts` must stay pure — no React, no DOM.
- TDD: failing test first, watch it fail, minimal implementation, one logical change per commit.
- Run frontend commands from `frontend/`.
- Typecheck gate is `npm run build`; lint is `npm run lint`.
- CSS theme variables live in `frontend/src/index.css` (`--ink --ink-soft --blue --red --mono` etc.). Reuse them; do not hardcode colors.

---

### Task 1: Flag compiler-internal stack locals in the data layer

**Files:**
- Modify: `frontend/src/viz/memoryModel.ts` (add `internal?` to `NormalizedCell`, add `isCompilerInternal`, set flag in `normalizeFrames`)
- Test: `frontend/tests/memoryModel.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `NormalizedCell.internal?: boolean`; `export function isCompilerInternal(name: string): boolean`. Top-level stack frame cells whose name starts with `__` carry `internal: true`. Globals, heap, and nested members are never flagged.

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/memoryModel.test.ts`:

```ts
describe("compiler-internal stack locals", () => {
  it("flags top-level locals whose name starts with __ as internal", () => {
    const point = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {}, heap: {},
      stack_to_render: [{
        unique_hash: "f1", frame_id: "f1", func_name: "main",
        ordered_varnames: ["v", "__for_range"],
        encoded_locals: {
          v: ["C_DATA", "0x10", "int", 5],
          __for_range: ["C_DATA", "0x18", "int", 9],
        },
      }],
    } as unknown as ExecPoint;
    const cells = normalizeMemory(point).frames[0].cells;
    expect(cells.find((c) => c.name === "__for_range")!.internal).toBe(true);
    expect(cells.find((c) => c.name === "v")!.internal).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/memoryModel.test.ts -t "flags top-level locals"`
Expected: FAIL — `internal` is `undefined` (property does not exist yet).

- [ ] **Step 3: Add the `internal` field and helper**

In `frontend/src/viz/memoryModel.ts`, add the field to the `NormalizedCell` interface (next to `note?: string;`):

```ts
  note?: string;
  /** True for compiler-generated top-level stack locals (name starts with `__`),
   *  e.g. range-for temporaries __for_range/__for_begin/__for_end. Hidden by
   *  default behind the per-frame internals toggle. */
  internal?: boolean;
```

Add the exported helper (near the other top-level helpers, e.g. above `getReferenceTarget`):

```ts
export function isCompilerInternal(name: string): boolean {
  return name.startsWith("__");
}
```

- [ ] **Step 4: Set the flag in `normalizeFrames`**

In `frontend/src/viz/memoryModel.ts`, change the `cells:` mapping inside `normalizeFrames` from:

```ts
      cells: names.map((name) => decodeMemoryValue(locals[name], name, "stack", frameId)),
```

to:

```ts
      cells: names.map((name) => {
        const cell = decodeMemoryValue(locals[name], name, "stack", frameId);
        return isCompilerInternal(name) ? { ...cell, internal: true } : cell;
      }),
```

(The flag survives `resolveContainers`/`resolveReferences` because both spread the existing cell with `{ ...cell }`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/memoryModel.test.ts -t "flags top-level locals"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/viz/memoryModel.ts frontend/tests/memoryModel.test.ts
git commit -m "feat(viz): flag __-prefixed stack locals as compiler internals"
```

---

### Task 2: Per-frame internals toggle in the render layer

**Files:**
- Modify: `frontend/src/viz/MemoryView.tsx` (lift per-frame expand state, extract `FrameView`)
- Modify: `frontend/src/viz/MemoryCell.tsx` (dim internal cells)
- Modify: `frontend/src/index.css` (toggle + dimmed-cell styles)
- Test: `frontend/tests/MemoryView.test.tsx`

**Interfaces:**
- Consumes: `NormalizedCell.internal` from Task 1.
- Produces: each stack frame with ≥1 internal cell renders a `button.internals-toggle`; internal cells are absent from the DOM until the toggle is clicked. Internal cells, when shown, carry the `cell-internal` class. Globals frame is unchanged. Expand state lives in `MemoryView` (`Set<frameId>`), so toggling recomputes `memory`/`links` and re-runs the `Connectors` effect.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/MemoryView.test.tsx`. Update the import on line 2 to include `fireEvent`:

```ts
import { render, screen, fireEvent } from "@testing-library/react";
```

Then add inside the `describe("MemoryCell", ...)` block:

```ts
  it("hides compiler internals behind a per-frame toggle, collapsed by default", () => {
    const point = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {}, heap: {},
      stack_to_render: [{
        unique_hash: "f1", frame_id: "f1", func_name: "main",
        ordered_varnames: ["v", "__for_range"],
        encoded_locals: {
          v: ["C_DATA", "0x10", "int", 5],
          __for_range: ["C_DATA", "0x18", "int", 9],
        },
      }],
    } as any;
    const { container } = render(<MemoryView point={point} />);
    // internal cell hidden by default
    expect(container.querySelector('[data-cell-id="stack-f1-__for_range"]')).toBeNull();
    // toggle present
    const toggle = container.querySelector(".internals-toggle") as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    // clicking reveals it
    fireEvent.click(toggle);
    expect(container.querySelector('[data-cell-id="stack-f1-__for_range"]')).not.toBeNull();
  });

  it("renders no internals toggle when a frame has none", () => {
    const point = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {}, heap: {},
      stack_to_render: [{
        unique_hash: "f1", frame_id: "f1", func_name: "main",
        ordered_varnames: ["v"],
        encoded_locals: { v: ["C_DATA", "0x10", "int", 5] },
      }],
    } as any;
    const { container } = render(<MemoryView point={point} />);
    expect(container.querySelector(".internals-toggle")).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/MemoryView.test.tsx -t "internals"`
Expected: the "hides compiler internals" test FAILS (internal cell is in the DOM; no `.internals-toggle`). The "renders no internals toggle" test passes trivially (no toggle exists yet) — that is fine; it locks the behavior in.

- [ ] **Step 3: Rewrite `MemoryView.tsx` to lift expand state and use a `FrameView`**

Replace the entire contents of `frontend/src/viz/MemoryView.tsx` with:

```tsx
import { useEffect, useRef, useState } from "react";
import type { ExecPoint } from "../types/trace";
import { normalizeMemory, type NormalizedFrame } from "./memoryModel";
import { MemoryCell } from "./MemoryCell";
import { Connectors, type ConnectorSelection } from "./Connectors";

export function MemoryView({ point }: { point: ExecPoint }) {
  const memory = normalizeMemory(point);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ConnectorSelection | null>(null);
  const [expandedFrames, setExpandedFrames] = useState<Set<string>>(new Set());

  useEffect(() => { setSelected(null); }, [point]);
  const highlightedIds = selected ? new Set([selected.fromId, selected.toId]) : undefined;

  const toggleFrame = (id: string) =>
    setExpandedFrames((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="memory" ref={containerRef} onClick={() => setSelected(null)}>
      <div className="panes">
        <section className="stack-pane">
          <h3>Stack</h3>
          {memory.globals.length > 0 && (
            <div className="frame">
              <div className="frame-name">Globals</div>
              <div className="frame-cells">
                {memory.globals.map((c) => <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} />)}
              </div>
            </div>
          )}
          {memory.frames.map((frame, i) => (
            <FrameView
              key={frame.id}
              frame={frame}
              current={i === memory.frames.length - 1}
              expanded={expandedFrames.has(frame.id)}
              onToggle={() => toggleFrame(frame.id)}
              highlightedIds={highlightedIds}
            />
          ))}
        </section>
        <section className="heap-pane">
          <h3>Heap</h3>
          <div className="frame-cells">
            {memory.heap.map((c) => <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} />)}
          </div>
        </section>
      </div>
      <Connectors
        containerRef={containerRef}
        links={memory.links}
        stepKey={point.line}
        selected={selected}
        onSelect={(link) => setSelected(link)}
      />
    </div>
  );
}

function FrameView({
  frame, current, expanded, onToggle, highlightedIds,
}: {
  frame: NormalizedFrame;
  current: boolean;
  expanded: boolean;
  onToggle: () => void;
  highlightedIds?: Set<string>;
}) {
  const visible = frame.cells.filter((c) => !c.internal);
  const internal = frame.cells.filter((c) => c.internal);
  return (
    <div className={`frame${current ? " frame-current" : ""}`}>
      <div className="frame-name">{frame.name}</div>
      <div className="frame-cells">
        {visible.map((c) => <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} />)}
        {internal.length > 0 && (
          <>
            <button className="internals-toggle" onClick={onToggle}>
              {expanded ? "▾" : "▸"} {internal.length} internal{internal.length > 1 ? "s" : ""}
            </button>
            {expanded && internal.map((c) => (
              <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Dim internal cells in `MemoryCell.tsx`**

In `frontend/src/viz/MemoryCell.tsx`, change the root `div` of `MemoryCell` (line 10) from:

```tsx
    <div className={`cell cell-${cell.kind}${hot}`} data-cell-id={cell.id}>
```

to:

```tsx
    <div className={`cell cell-${cell.kind}${hot}${cell.internal ? " cell-internal" : ""}`} data-cell-id={cell.id}>
```

- [ ] **Step 5: Add styles in `index.css`**

Append to `frontend/src/index.css`:

```css
.internals-toggle {
  background: none;
  border: none;
  color: var(--ink-soft);
  font-family: var(--mono);
  font-size: 11px;
  text-align: left;
  padding: 2px 0;
  cursor: pointer;
}
.internals-toggle:hover { color: var(--ink); }
.cell-internal { opacity: 0.55; }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/MemoryView.test.tsx`
Expected: PASS (all MemoryView tests, including the two new ones and the existing frame/heap tests).

- [ ] **Step 7: Typecheck**

Run: `cd frontend && npm run build`
Expected: build succeeds (this is the typecheck gate — confirms the `NormalizedFrame` import and prop types line up).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/viz/MemoryView.tsx frontend/src/viz/MemoryCell.tsx frontend/src/index.css frontend/tests/MemoryView.test.tsx
git commit -m "feat(viz): per-frame toggle to hide compiler internals, collapsed by default"
```

---

### Task 3: Fix empty-vector decode gap

**Files:**
- Modify: `frontend/src/viz/stl/contiguous.ts` (`vectorDecoder`)
- Test: `frontend/tests/memoryModel.test.ts`

**Interfaces:**
- Consumes: `findMember` (already imported in `contiguous.ts`).
- Produces: `vectorDecoder` renders any vector-shaped struct as a `container` (`containerKind: "vector"`). It returns `null` (raw struct fallback) ONLY when no `_M_start` member exists at all. A present-but-null `_M_start` (`0x0`) yields an empty container `vector<T> · 0`, never the raw `_Vector_base`/`_M_impl` dump.

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/memoryModel.test.ts` (reproduces the exact nesting from the raw dump — `_M_start`/`_M_finish` are null pointers, decoded as scalars):

```ts
describe("empty vector decode", () => {
  it("renders an empty vector (_M_start = 0x0) as a container, not raw guts", () => {
    const point = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {}, heap: {},
      stack_to_render: [{
        unique_hash: "f1", frame_id: "f1", func_name: "main",
        ordered_varnames: ["v"],
        encoded_locals: {
          v: ["C_STRUCT", "0x10", "std::vector<int, std::allocator<int> >",
            ["<anon_field>", ["C_STRUCT", "0x10", "_Vector_base<int, std::allocator<int> >",
              ["_M_impl", ["C_STRUCT", "0x10", "_Vector_impl",
                ["_M_start", ["C_DATA", "0x10", "pointer", "0x0"]],
                ["_M_finish", ["C_DATA", "0x18", "pointer", "0x0"]],
                ["_M_end_of_storage", ["C_DATA", "0x20", "pointer", "0x0"]]]]]]],
        },
      }],
    } as unknown as ExecPoint;
    const v = normalizeMemory(point).frames[0].cells.find((c) => c.name === "v")!;
    expect(v.kind).toBe("container");
    expect(v.containerKind).toBe("vector");
    expect(v.length).toBe(0);
    expect(v.displayValue).toBe("vector<int> · 0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/memoryModel.test.ts -t "empty vector"`
Expected: FAIL — `v.kind` is `"struct"` (decoder returned null: `findPointer("_M_start")` is `undefined` because the null pointer decodes as a scalar, not a reference).

- [ ] **Step 3: Fix `vectorDecoder`**

In `frontend/src/viz/stl/contiguous.ts`, replace the `decode` body of `vectorDecoder` (currently starting `const start = findPointer(cell, "_M_start"); if (!start) return null;`) with:

```ts
  decode(cell, ctx: DecodeCtx) {
    // Presence of the _M_start MEMBER (not its value) is what makes this a
    // vector. An empty vector's _M_start is a null pointer that decodes as a
    // scalar, so findPointer returns undefined — bailing on that would leak the
    // raw _Vector_base struct. Distinguish "no member" from "null pointer".
    if (!findMember(cell, "_M_start")) return null;
    const elem = templateArg(cell.type ?? "");
    const start = findPointer(cell, "_M_start");
    const buffer = start ? ctx.heapByAddress.get(start) : undefined;
    if (!buffer) {
      return { ...cell, kind: "container", containerKind: "vector",
        children: [], length: 0, elementType: elem,
        displayValue: `vector<${elem}> · 0` };
    }
    ctx.consumed.add(start);
    const finish = findPointer(cell, "_M_finish");
    const size = vectorSize(start, finish, buffer);
    const children = (buffer.children ?? []).slice(0, size).map((c, i) => ({ ...c, name: `[${i}]` }));
    return { ...cell, kind: "container", containerKind: "vector",
      children, length: size, elementType: elem,
      displayValue: `vector<${elem}> · ${size}` };
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/memoryModel.test.ts -t "empty vector"`
Expected: PASS.

- [ ] **Step 5: Run the full memoryModel + stl suites for regressions**

Run: `cd frontend && npx vitest run tests/memoryModel.test.ts tests/stl`
Expected: PASS (the non-empty vector path is unchanged; `templateArg` still yields `int` from `vector<int, std::allocator<int> >`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/viz/stl/contiguous.ts frontend/tests/memoryModel.test.ts
git commit -m "fix(viz): render empty vector as container instead of raw _Vector_base guts"
```

---

### Task 4: Bolder variable names

**Files:**
- Modify: `frontend/src/index.css` (`.cell-name`)

**Interfaces:**
- Consumes: nothing.
- Produces: variable names render at `font-weight: 600` in `var(--ink)` (was unweighted `var(--ink-soft)`). Purely visual.

- [ ] **Step 1: Make the name bolder**

In `frontend/src/index.css`, change line 257 from:

```css
.cell-name { color: var(--ink-soft); }
```

to:

```css
.cell-name { color: var(--ink); font-weight: 600; }
```

- [ ] **Step 2: Typecheck / build gate**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual visual check**

Run: `cd frontend && npm run dev`, open the app, trace any program.
Expected: variable names sit a touch bolder/darker than their type and surrounding chrome.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/index.css
git commit -m "style(viz): make variable names a little bolder than surroundings"
```

---

## Final verification

- [ ] Run the full frontend suite: `cd frontend && npm test`
- [ ] Run the build: `cd frontend && npm run build`
- [ ] Run lint: `cd frontend && npm run lint`
- [ ] Manual: trace a program with a range-for loop over a vector — the `__for_*` temporaries are hidden by default; the frame shows a `▸ N internals` toggle that reveals them (dimmed) on click; an empty vector shows `vector<int> · 0` instead of raw guts; variable names are bolder.

## Self-review notes

- **Spec coverage:** Part A → Tasks 1 (data) + 2 (render). Part B → Task 3. Part C → Task 4. All spec sections covered.
- **Connectors:** expand state lifted to `MemoryView`, so a toggle recomputes `memory.links` (new array identity) and re-runs the `Connectors` effect (deps include `links`) — hidden internal iterator lines disappear/reappear correctly. No separate redraw plumbing needed.
- **Type consistency:** `internal?: boolean` defined in Task 1, consumed in Task 2/render and Task 2 tests; `NormalizedFrame` imported in `MemoryView.tsx`; `isCompilerInternal` exported and used only in `normalizeFrames`; `findMember` already imported in `contiguous.ts`.
