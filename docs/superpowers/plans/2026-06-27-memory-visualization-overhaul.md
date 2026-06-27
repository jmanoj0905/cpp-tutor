# Memory Visualization Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render C++ memory like Python Tutor — recursive structs/arrays, first-class `std::vector`/`std::string`, and curved SVG pointer lines between every resolvable reference — on cpp-tutor's existing React + Bauhaus-CSS stack.

**Architecture:** Three frontend layers. (1) A pure data layer in `memoryModel.ts` decodes the OPT trace into a `NormalizedMemory` tree (now recursive, with vector/string/array kinds and cross-tree pointer links). (2) A `MemoryView` render layer draws Globals/Stack/Heap as positioned Bauhaus cards via a recursive `MemoryCell`, tagging each cell with `data-cell-id` / `data-port-id`. (3) A `Connectors` SVG overlay reads DOM rects for those tags and draws bezier arrows, recomputed on step/resize/scroll.

**Tech Stack:** React 19, TypeScript, Vite 8, Vitest 4 + @testing-library/react, plain CSS (Bauhaus theme in `index.css`). No new dependencies.

## Global Constraints

- No new npm dependencies — frontend stays React + CodeMirror + custom CSS only. No React Flow, elkjs, tailwind, zustand.
- All work runs from the `frontend/` directory. Tests: `npm test` (= `vitest run`). Build: `npm run build`. Lint: `npm run lint`.
- Keep the existing Bauhaus theme: CSS variables `--bg --panel --code-bg --ink --ink-soft --red --blue --yellow --border --border-thin --radius --sans --mono` already defined in `frontend/src/index.css`.
- Data-layer functions stay pure (no React, no DOM).
- Connector colors: resolved = `var(--blue)`, unresolved = `var(--red)`.
- Backend (`tracer/`, `backend/`) is touched ONLY if Task 1 verification proves trace data is insufficient; otherwise frontend-only.
- TDD: write the failing test, watch it fail, implement minimally, watch it pass, commit. One logical change per commit.

---

## File Structure

- `frontend/src/viz/memoryModel.ts` — MODIFY. Recursive decode; vector/string/array kinds; cross-tree link derivation; buffer-consumption.
- `frontend/src/viz/connectorGeometry.ts` — CREATE. Pure geometry helpers (rect → points → bezier path). No DOM/React.
- `frontend/src/viz/MemoryCell.tsx` — CREATE. Recursive cell renderer with `data-cell-id` / `data-port-id`.
- `frontend/src/viz/MemoryView.tsx` — CREATE. Globals/Stack/Heap sections in one positioned container; mounts `Connectors`. Replaces `StackView`.
- `frontend/src/viz/Connectors.tsx` — CREATE. SVG overlay; measures rects; redraws on step/resize/scroll.
- `frontend/src/viz/StackView.tsx` — DELETE (replaced by `MemoryView`).
- `frontend/src/App.tsx` — MODIFY. Use `MemoryView`; pass current point.
- `frontend/src/index.css` — MODIFY. Styles for memory cells, ports, vector/array grids, sections, connector svg.
- `frontend/tests/memoryModel.test.ts` — MODIFY. Update array/struct expectations; add vector/string/array/nested-link tests.
- `frontend/tests/connectorGeometry.test.ts` — CREATE.
- `frontend/tests/MemoryView.test.tsx` — CREATE.
- `frontend/tests/Connectors.test.tsx` — CREATE.
- `frontend/tests/StackView.test.tsx` — DELETE.
- `frontend/tests/fixtures/vector-trace.json` — CREATE (Task 1 output, real or representative).

---

## Task 1: Verify vector trace format (gate)

Confirms the frontend-only assumption: a `std::vector` must appear as a `C_STRUCT` with `_M_start`/`_M_finish` pointer members, and the element buffer must exist in `heap` as a `C_ARRAY` at `_M_start`'s target.

**Files:**
- Create: `frontend/tests/fixtures/vector-trace.json`
- Possibly modify (only if verification fails): `tracer/opt-cpp-backend/vg_to_opt_trace.py`, `tracer/opt-cpp-backend/run_cpp_backend.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `frontend/tests/fixtures/vector-trace.json` — a real OPT `Trace` JSON whose final step contains a `std::vector<int>` with 3 elements. Later tasks reference its exact shape for vector tests.

- [ ] **Step 1: Write the probe program and run the tracer**

Create a scratch file `tracer/vec_probe.cpp`:

```cpp
#include <vector>
int main() {
  std::vector<int> v;
  v.push_back(10);
  v.push_back(20);
  v.push_back(30);
  return 0;
}
```

Try the backend two ways (whichever the repo supports):

```bash
# A) via the running API, if backend is up
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor
curl -s -X POST http://localhost:8000/api/trace \
  -H 'Content-Type: application/json' \
  --data "$(python3 -c 'import json;print(json.dumps({"code":open("tracer/vec_probe.cpp").read(),"lang":"cpp"}))')" \
  > /tmp/vec-trace.json

# B) via docker, if an image/compose exists
docker compose -f tracer/docker-compose.yml up -d 2>/dev/null || true
# then repeat the curl above
```

- [ ] **Step 2: Inspect the JSON for the required shape**

```bash
python3 - <<'PY'
import json
t = json.load(open("/tmp/vec-trace.json"))
steps = t["trace"] if isinstance(t, dict) and "trace" in t else t
last = steps[-1]
print("keys:", list(last.keys()))
print("locals:", json.dumps(last["stack_to_render"][0].get("encoded_locals"), indent=2)[:2000])
print("heap:", json.dumps(last["heap"], indent=2)[:2000])
PY
```

Confirm in the output:
1. local `v` is a `["C_STRUCT", addr, "...vector...", ...]` containing pointer members whose names include `_M_start` and `_M_finish` (possibly nested inside an `_M_impl` struct), and
2. `heap` contains a `["C_ARRAY", <_M_start target>, ["C_DATA",...,10], ["C_DATA",...,20], ["C_DATA",...,30], ...]`.

- [ ] **Step 3: Decision gate**

- If BOTH present → save the working trace as the fixture and proceed frontend-only:

```bash
cp /tmp/vec-trace.json /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor/frontend/tests/fixtures/vector-trace.json
```

- If the tracer cannot be run here (no backend, no docker) → hand-write `frontend/tests/fixtures/vector-trace.json` matching the canonical shape below (later tasks assume this shape), and note in the PR that the backend path is unverified:

```json
{
  "code": "#include <vector>\nint main(){std::vector<int> v;v.push_back(10);v.push_back(20);v.push_back(30);return 0;}",
  "trace": [
    {
      "line": 6, "event": "step_line", "func_name": "main", "stdout": "",
      "ordered_globals": [], "globals": {},
      "heap": {
        "0x5000": ["C_ARRAY", "0x5000",
          ["C_DATA", "0x5000", "int", 10],
          ["C_DATA", "0x5004", "int", 20],
          ["C_DATA", "0x5008", "int", 30],
          ["C_DATA", "0x500c", "int", 0]]
      },
      "stack_to_render": [{
        "unique_hash": "main_0x1", "frame_id": "0x1", "func_name": "main",
        "ordered_varnames": ["v"],
        "encoded_locals": {
          "v": ["C_STRUCT", "0x100", "std::vector<int>",
            ["_M_impl", ["C_STRUCT", "0x100", "std::_Vector_base<int>::_Vector_impl",
              ["_M_start",          ["C_DATA", "0x100", "pointer", ["REF", "0x5000"]]],
              ["_M_finish",         ["C_DATA", "0x108", "pointer", ["REF", "0x500c"]]],
              ["_M_end_of_storage", ["C_DATA", "0x110", "pointer", ["REF", "0x5010"]]]
            ]]
          ]
        }
      }]
    }
  ]
}
```

- If a piece is MISSING (e.g. gdb does not deref `_M_start`) → make the smallest possible patch in `vg_to_opt_trace.py`/`run_cpp_backend.py` to dump the buffer + finish pointer, then save the real trace as the fixture. Keep the patch scoped to vector buffers only.

- [ ] **Step 4: Commit**

```bash
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor
rm -f tracer/vec_probe.cpp
git add -f frontend/tests/fixtures/vector-trace.json
# include any backend patch only if one was needed:
# git add tracer/opt-cpp-backend/vg_to_opt_trace.py tracer/opt-cpp-backend/run_cpp_backend.py
git commit -m "test: add std::vector trace fixture for memory viz"
```

---

## Task 2: Recursive struct & array decoding in the data layer

Replaces the summary-only decoding of `C_STRUCT`/`C_ARRAY` with recursive children. This changes existing test expectations.

**Files:**
- Modify: `frontend/src/viz/memoryModel.ts`
- Test: `frontend/tests/memoryModel.test.ts`

**Interfaces:**
- Consumes: existing `ExecPoint` (`frontend/src/types/trace.ts`), existing `decodeMemoryValue(rawValue, name, source, idPrefix)`, `MemorySource`.
- Produces:
  - Extended `MemoryCellKind = "scalar" | "reference" | "struct" | "array" | "vector" | "string" | "summary"`.
  - Extended `NormalizedCell` with optional `children?: NormalizedCell[]`, `length?: number`, `elementType?: string`, `startAddress?: string`, `finishAddress?: string`.
  - `decodeMemoryValue` returns `kind:"array"` for `C_ARRAY`/`C_MULTIDIMENSIONAL_ARRAY` (with `children`, `length`) and `kind:"struct"` for generic `C_STRUCT` (with `children`).

- [ ] **Step 1: Update expectations and write failing tests**

In `frontend/tests/memoryModel.test.ts`, REPLACE the `"summarizes arrays and objects..."` test (currently asserting `kind:"summary"`) with:

```ts
it("decodes arrays recursively with indexed children", () => {
  const cell = decodeMemoryValue(
    ["C_ARRAY", "0x40", ["C_DATA", "0x40", "int", 1], ["C_DATA", "0x44", "int", 2]],
    "items", "stack", "frame-1",
  );
  expect(cell).toMatchObject({ kind: "array", address: "0x40", length: 2, displayValue: "int[2]" });
  expect(cell.children?.map((c) => [c.name, c.displayValue])).toEqual([["[0]", "1"], ["[1]", "2"]]);
});

it("decodes structs recursively with named member children", () => {
  const cell = decodeMemoryValue(
    ["C_STRUCT", "0x50", "Point", ["x", ["C_DATA", "0x50", "int", 3]], ["y", ["C_DATA", "0x54", "int", 4]]],
    "pt", "stack", "frame-1",
  );
  expect(cell).toMatchObject({ kind: "struct", address: "0x50", type: "Point", displayValue: "Point" });
  expect(cell.children?.map((c) => [c.name, c.displayValue])).toEqual([["x", "3"], ["y", "4"]]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/memoryModel.test.ts -t "recursively"`
Expected: FAIL — current code returns `kind:"summary"`.

- [ ] **Step 3: Implement recursive decode**

In `frontend/src/viz/memoryModel.ts`, extend the kind union and the interface:

```ts
export type MemoryCellKind = "scalar" | "reference" | "struct" | "array" | "vector" | "string" | "summary";

export interface NormalizedCell {
  id: string;
  name: string;
  source: MemorySource;
  kind: MemoryCellKind;
  address: string | null;
  type: string | null;
  displayValue: string;
  rawValue: unknown;
  targetAddress?: string;
  targetId?: string;
  unresolved?: boolean;
  children?: NormalizedCell[];
  length?: number;
  elementType?: string;
  startAddress?: string;
  finishAddress?: string;
}
```

Add helpers near `toCellId`:

```ts
function childPrefix(idPrefix: string, name: string): string {
  return `${idPrefix}-${name}`;
}

function childElementType(children: NormalizedCell[]): string {
  return children[0]?.type ?? "";
}
```

Replace the `C_ARRAY` branch (currently returns summary) with:

```ts
if (tag === "C_ARRAY") {
  const address = toOptionalString(rawValue[1]);
  const elements = rawValue.slice(2);
  const children = elements.map((el, i) =>
    decodeMemoryValue(el, `[${i}]`, source, childPrefix(idPrefix, name)),
  );
  return {
    ...base,
    kind: "array",
    address,
    type: "array",
    length: children.length,
    children,
    displayValue: `${childElementType(children)}[${children.length}]`,
  };
}

if (tag === "C_MULTIDIMENSIONAL_ARRAY") {
  const address = toOptionalString(rawValue[1]);
  const dims = Array.isArray(rawValue[2]) ? (rawValue[2] as number[]) : [];
  const elements = rawValue.slice(3);
  const children = elements.map((el, i) =>
    decodeMemoryValue(el, `[${i}]`, source, childPrefix(idPrefix, name)),
  );
  return {
    ...base,
    kind: "array",
    address,
    type: "array",
    length: children.length,
    children,
    displayValue: `array[${dims.join("][")}]`,
  };
}
```

Replace the `C_STRUCT` branch (currently returns summary) with the generic-struct version (vector/string detection is added in Task 4):

```ts
if (tag === "C_STRUCT") {
  const address = toOptionalString(rawValue[1]);
  const type = toOptionalString(rawValue[2]) ?? "object";
  const memberEntries = rawValue.slice(3) as [string, unknown][];
  const children = memberEntries.map(([memberName, memberValue]) =>
    decodeMemoryValue(memberValue, memberName, source, childPrefix(idPrefix, name)),
  );
  return {
    ...base,
    kind: "struct",
    address,
    type,
    children,
    displayValue: type,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/memoryModel.test.ts`
Expected: PASS. The existing `"normalizes stack frames..."` test only checks names/links for `items` (now `kind:"array"`), so it stays valid. If any assertion still references `displayValue: "Array(...)"` or `"... {...}"`, update it to the new `T[n]` / type-name form in this step.

- [ ] **Step 5: Commit**

```bash
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor
git add frontend/src/viz/memoryModel.ts frontend/tests/memoryModel.test.ts
git commit -m "feat(frontend): decode structs and arrays recursively"
```

---

## Task 3: Cross-tree pointer link derivation

Pointer links currently come only from top-level stack/global cells. Extend to references anywhere in the tree (nested struct members, array elements) and heap→heap.

**Files:**
- Modify: `frontend/src/viz/memoryModel.ts`
- Test: `frontend/tests/memoryModel.test.ts`

**Interfaces:**
- Consumes: `NormalizedCell` (with `children`), `NormalizedMemory`, existing `resolveReferences`, `normalizeMemory`.
- Produces:
  - `flattenCells(cells: NormalizedCell[]): NormalizedCell[]` — depth-first flatten including children.
  - `resolveReferences` recurses into `children` so nested refs get `targetId`.
  - `normalizeMemory` derives `links` from flattened globals + frames + heap (heap→heap included).

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/memoryModel.test.ts`:

```ts
it("derives links from nested struct members and heap-to-heap", () => {
  const nestedPoint: ExecPoint = {
    line: 1, event: "step_line", func_name: "main", stdout: "",
    ordered_globals: [], globals: {},
    heap: {
      "0xA0": ["C_STRUCT", "0xA0", "Node",
        ["next", ["C_DATA", "0xA8", "Node *", ["REF", "0xB0"]]]],
      "0xB0": ["C_DATA", "0xB0", "int", 9],
    },
    stack_to_render: [{
      unique_hash: "main_0x1", frame_id: "0x1", func_name: "main",
      ordered_varnames: ["root"],
      encoded_locals: {
        root: ["C_STRUCT", "0x10", "Wrap",
          ["ptr", ["C_DATA", "0x10", "Node *", ["REF", "0xA0"]]]],
      },
    }] as any,
  };
  const memory = normalizeMemory(nestedPoint);
  const targets = memory.links.map((l) => [l.fromName, l.targetAddress]);
  expect(targets).toContainEqual(["ptr", "0xA0"]);
  expect(targets).toContainEqual(["next", "0xB0"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/memoryModel.test.ts -t "nested struct"`
Expected: FAIL — `next` (heap→heap) and `ptr` (nested) absent from links.

- [ ] **Step 3: Implement recursion**

In `frontend/src/viz/memoryModel.ts` add:

```ts
function flattenCells(cells: NormalizedCell[]): NormalizedCell[] {
  return cells.flatMap((cell) => [cell, ...flattenCells(cell.children ?? [])]);
}
```

Change `resolveReferences` to recurse into children:

```ts
function resolveReferences(cells: NormalizedCell[], heapByAddress: Map<string, NormalizedCell>): NormalizedCell[] {
  return cells.map((cell) => {
    const children = cell.children ? resolveReferences(cell.children, heapByAddress) : cell.children;
    if (cell.kind !== "reference" || !cell.targetAddress) return { ...cell, children };
    const target = heapByAddress.get(cell.targetAddress);
    if (!target) return { ...cell, children, unresolved: true };
    return { ...cell, children, targetId: target.id, unresolved: false };
  });
}
```

Update `normalizeMemory` to also resolve heap cells and derive links from flattened cells:

```ts
export function normalizeMemory(point: ExecPoint): NormalizedMemory {
  const heapRaw = normalizeHeap(point.heap);
  const heapByAddress = new Map(heapRaw.flatMap((cell) => (cell.address ? [[cell.address, cell]] : [])));

  const globals = resolveReferences(normalizeGlobals(point), heapByAddress);
  const frames = normalizeFrames(point).map((frame) => ({
    ...frame,
    cells: resolveReferences(frame.cells, heapByAddress),
  }));
  const heap = resolveReferences(heapRaw, heapByAddress);

  const links = flattenCells([...globals, ...frames.flatMap((f) => f.cells), ...heap])
    .filter((cell) => cell.kind === "reference" && cell.targetId && cell.targetAddress)
    .map((cell) => ({
      fromId: cell.id,
      fromName: cell.name,
      toId: cell.targetId as string,
      targetAddress: cell.targetAddress as string,
    }));

  return { globals, frames, heap, links };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/memoryModel.test.ts`
Expected: PASS. The existing `"normalizes..."` test still expects links `[["gp","0x100"],["p","0x100"]]`; flatten preserves global-before-frame order, so this holds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/memoryModel.ts frontend/tests/memoryModel.test.ts
git commit -m "feat(frontend): derive pointer links across nested and heap cells"
```

---

## Task 4: std::vector & std::string decoding

Detect vector/string structs and finalize them against the heap: inline live elements, compute size from pointer arithmetic, and hide the consumed buffer from the heap section. Elements render inline (Python-Tutor style); because the buffer is shown inside the vector and removed from the heap section, no extra vector→buffer line is needed — element-level pointers still get lines.

**Files:**
- Modify: `frontend/src/viz/memoryModel.ts`
- Modify (if needed): `frontend/tsconfig.app.json` (enable `resolveJsonModule`)
- Test: `frontend/tests/memoryModel.test.ts`

**Interfaces:**
- Consumes: `NormalizedCell` (`startAddress`, `finishAddress`, `children`, `length`, `elementType`), `flattenCells`, `normalizeMemory`, the Task 1 fixture shape.
- Produces:
  - `decodeMemoryValue` returns `kind:"vector"`/`kind:"string"` for matching `C_STRUCT` types, carrying `startAddress`/`finishAddress` and `targetAddress = startAddress`.
  - `resolveVectors(cells, heapByAddress, consumed: Set<string>): NormalizedCell[]` — inlines buffer elements as `children`, sets `length`, marks buffer addr consumed; recurses into children.
  - `normalizeMemory` runs `resolveVectors` after `resolveReferences` and excludes consumed addresses from `heap`.

- [ ] **Step 1: Write failing tests**

Add to the top of `frontend/tests/memoryModel.test.ts` (with the other imports):

```ts
import vectorTrace from "./fixtures/vector-trace.json";
```

Add these tests:

```ts
it("decodes std::vector with size from pointer arithmetic and inlined elements", () => {
  const steps = (vectorTrace as any).trace as ExecPoint[];
  const memory = normalizeMemory(steps[steps.length - 1]);
  const v = memory.frames[0].cells.find((c) => c.name === "v")!;
  expect(v.kind).toBe("vector");
  expect(v.length).toBe(3);
  expect(v.elementType).toBe("int");
  expect(v.children?.map((c) => c.displayValue)).toEqual(["10", "20", "30"]);
  // the heap buffer backing the vector is not shown as a separate heap cell
  expect(memory.heap.find((c) => c.address === "0x5000")).toBeUndefined();
});

it("computes vector size from buffer length when arithmetic is unavailable", () => {
  const point: ExecPoint = {
    line: 1, event: "step_line", func_name: "main", stdout: "",
    ordered_globals: [], globals: {},
    heap: { "0x9000": ["C_ARRAY", "0x9000", ["C_DATA", "0x9000", "int", 7]] },
    stack_to_render: [{
      unique_hash: "main_0x1", frame_id: "0x1", func_name: "main",
      ordered_varnames: ["v"],
      encoded_locals: {
        v: ["C_STRUCT", "0x10", "std::vector<int>",
          ["_M_start",  ["C_DATA", "0x10", "pointer", ["REF", "0x9000"]]],
          ["_M_finish", ["C_DATA", "0x18", "pointer", ["REF", "0x9004"]]]],
      },
    }] as any,
  };
  const v = normalizeMemory(point).frames[0].cells.find((c) => c.name === "v")!;
  expect(v.kind).toBe("vector");
  expect(v.length).toBe(1);
  expect(v.children?.map((c) => c.displayValue)).toEqual(["7"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/memoryModel.test.ts -t "std::vector"`
Expected: FAIL — `v.kind` is `"struct"`, no `length`.

If the JSON import errors, add `"resolveJsonModule": true` to `compilerOptions` in `frontend/tsconfig.app.json` in this step.

- [ ] **Step 3: Implement vector/string detection + finalize**

In `decodeMemoryValue`, REPLACE the generic `C_STRUCT` branch from Task 2 with detection-then-fallback:

```ts
if (tag === "C_STRUCT") {
  const address = toOptionalString(rawValue[1]);
  const type = toOptionalString(rawValue[2]) ?? "object";
  const memberEntries = rawValue.slice(3) as [string, unknown][];
  const children = memberEntries.map(([memberName, memberValue]) =>
    decodeMemoryValue(memberValue, memberName, source, childPrefix(idPrefix, name)),
  );

  const ptrs = collectPointerMembers(children);
  if (isVectorType(type) && ptrs.has("_M_start")) {
    const startAddress = ptrs.get("_M_start");
    const finishAddress = ptrs.get("_M_finish");
    return {
      ...base, kind: "vector", address, type,
      elementType: templateArg(type),
      startAddress, finishAddress,
      targetAddress: startAddress,
      displayValue: `vector<${templateArg(type)}>`,
    };
  }
  if (isStringType(type) && ptrs.has("_M_p")) {
    return {
      ...base, kind: "string", address, type,
      startAddress: ptrs.get("_M_p"),
      displayValue: '""',
    };
  }

  return { ...base, kind: "struct", address, type, children, displayValue: type };
}
```

Add helpers:

```ts
function isVectorType(type: string): boolean {
  return /\bvector\s*</.test(type);
}
function isStringType(type: string): boolean {
  return /basic_string|\bstring\b/.test(type);
}
function templateArg(type: string): string {
  const m = type.match(/<\s*([^,>]+)/);
  return m ? m[1].trim() : "";
}
// recursively search a decoded struct's children (e.g. through _M_impl) for
// reference members named _M_start/_M_finish/_M_p → name -> targetAddress
function collectPointerMembers(children: NormalizedCell[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of children) {
    if (c.kind === "reference" && c.targetAddress && !out.has(c.name)) out.set(c.name, c.targetAddress);
    if (c.children) for (const [k, v] of collectPointerMembers(c.children)) if (!out.has(k)) out.set(k, v);
  }
  return out;
}

function parseAddr(addr?: string | null): number | null {
  if (!addr) return null;
  const n = Number.parseInt(addr, 16);
  return Number.isNaN(n) ? null : n;
}

function computeVectorSize(start: string | undefined, finish: string | undefined, buffer: NormalizedCell): number {
  const elems = buffer.children ?? [];
  const s = parseAddr(start), f = parseAddr(finish);
  if (s !== null && f !== null && elems.length >= 2) {
    const e0 = parseAddr(elems[0].address), e1 = parseAddr(elems[1].address);
    if (e0 !== null && e1 !== null && e1 > e0) {
      const size = Math.round((f - s) / (e1 - e0));
      if (size >= 0 && size <= elems.length) return size;
    }
  }
  if (s !== null && f !== null) {
    if (f === s) return 0;
    // single-element buffer: arithmetic needs ≥2 elems, so fall back to length
  }
  return elems.length;
}

function resolveVectors(
  cells: NormalizedCell[],
  heapByAddress: Map<string, NormalizedCell>,
  consumed: Set<string>,
): NormalizedCell[] {
  return cells.map((cell) => {
    const children = cell.children ? resolveVectors(cell.children, heapByAddress, consumed) : cell.children;
    if (cell.kind === "vector" && cell.startAddress) {
      const buffer = heapByAddress.get(cell.startAddress);
      if (buffer) {
        consumed.add(cell.startAddress);
        const size = computeVectorSize(cell.startAddress, cell.finishAddress, buffer);
        const elems = (buffer.children ?? []).slice(0, size).map((c, i) => ({ ...c, name: `[${i}]` }));
        return { ...cell, children: elems, length: size, displayValue: `vector<${cell.elementType ?? ""}> · ${size}` };
      }
      return { ...cell, children, length: 0, displayValue: `vector<${cell.elementType ?? ""}> · 0` };
    }
    if (cell.kind === "string" && cell.startAddress) {
      const buffer = heapByAddress.get(cell.startAddress);
      if (buffer) {
        consumed.add(cell.startAddress);
        const text = (buffer.children ?? []).map((c) => c.displayValue).filter((s) => s !== "0").join("");
        return { ...cell, children: undefined, displayValue: `"${text}"` };
      }
    }
    return { ...cell, children };
  });
}
```

Update `normalizeMemory` to run vector resolution and filter consumed buffers:

```ts
export function normalizeMemory(point: ExecPoint): NormalizedMemory {
  const heapRaw = normalizeHeap(point.heap);
  const heapByAddress = new Map(heapRaw.flatMap((cell) => (cell.address ? [[cell.address, cell]] : [])));

  const consumed = new Set<string>();
  const globals = resolveVectors(resolveReferences(normalizeGlobals(point), heapByAddress), heapByAddress, consumed);
  const frames = normalizeFrames(point).map((frame) => ({
    ...frame,
    cells: resolveVectors(resolveReferences(frame.cells, heapByAddress), heapByAddress, consumed),
  }));
  const heap = resolveVectors(resolveReferences(heapRaw, heapByAddress), heapByAddress, consumed)
    .filter((cell) => !(cell.address && consumed.has(cell.address)));

  const links = flattenCells([...globals, ...frames.flatMap((f) => f.cells), ...heap])
    .filter((cell) => cell.kind === "reference" && cell.targetId && cell.targetAddress)
    .map((cell) => ({
      fromId: cell.id, fromName: cell.name,
      toId: cell.targetId as string, targetAddress: cell.targetAddress as string,
    }));

  return { globals, frames, heap, links };
}
```

Note: the vector cell's own `targetAddress` points at its buffer, but that buffer is `consumed` (removed from heap) so it never resolves a `targetId` — it produces no link, which is intended. The vector keeps `kind:"vector"` (not `"reference"`), so it is excluded from the link filter regardless.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/memoryModel.test.ts`
Expected: PASS (all, including the vector fixture and length-fallback tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/memoryModel.ts frontend/tests/memoryModel.test.ts frontend/tsconfig.app.json
git commit -m "feat(frontend): decode std::vector and std::string into clean views"
```

---

## Task 5: Pure connector geometry

Pure helpers turning two rectangles into a bezier path. No DOM, no React — unit-testable.

**Files:**
- Create: `frontend/src/viz/connectorGeometry.ts`
- Test: `frontend/tests/connectorGeometry.test.ts`

**Interfaces:**
- Produces:
  - `interface Rect { left: number; top: number; right: number; bottom: number }`
  - `interface Point { x: number; y: number }`
  - `sourcePoint(r: Rect): Point` — right-edge vertical center.
  - `targetPoint(r: Rect): Point` — left-edge vertical center.
  - `bezierPath(from: Point, to: Point): string` — cubic SVG path `d` with horizontal control handles.

- [ ] **Step 1: Write failing tests**

Create `frontend/tests/connectorGeometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sourcePoint, targetPoint, bezierPath } from "../src/viz/connectorGeometry";

describe("connectorGeometry", () => {
  it("anchors source at right-center and target at left-center", () => {
    expect(sourcePoint({ left: 0, top: 0, right: 10, bottom: 20 })).toEqual({ x: 10, y: 10 });
    expect(targetPoint({ left: 30, top: 10, right: 50, bottom: 30 })).toEqual({ x: 30, y: 20 });
  });

  it("builds a cubic bezier path string between two points", () => {
    const d = bezierPath({ x: 10, y: 10 }, { x: 30, y: 20 });
    expect(d.startsWith("M 10 10 C")).toBe(true);
    expect(d).toContain("30 20");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/connectorGeometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/viz/connectorGeometry.ts`:

```ts
export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Point { x: number; y: number }

export function sourcePoint(r: Rect): Point {
  return { x: r.right, y: (r.top + r.bottom) / 2 };
}

export function targetPoint(r: Rect): Point {
  return { x: r.left, y: (r.top + r.bottom) / 2 };
}

export function bezierPath(from: Point, to: Point): string {
  const dx = Math.max(40, Math.abs(to.x - from.x) / 2);
  const c1 = { x: from.x + dx, y: from.y };
  const c2 = { x: to.x - dx, y: to.y };
  return `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/connectorGeometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/connectorGeometry.ts frontend/tests/connectorGeometry.test.ts
git commit -m "feat(frontend): pure connector geometry helpers"
```

---

## Task 6: MemoryCell recursive renderer

A recursive component rendering any `NormalizedCell`, tagging cells for the connector layer.

**Files:**
- Create: `frontend/src/viz/MemoryCell.tsx`
- Test: `frontend/tests/MemoryView.test.tsx` (created here; extended in Task 7)

**Interfaces:**
- Consumes: `NormalizedCell` from `memoryModel`.
- Produces: `MemoryCell({ cell }: { cell: NormalizedCell })`. Contract:
  - Root element has `data-cell-id={cell.id}`.
  - `kind:"reference"` renders its value plus a `<span data-port-id={cell.id} className="port" />`.
  - `kind:"vector"` renders header text `vector<T> · N` and indexed children.
  - `kind:"struct"`/`"array"` render their `children` recursively.
  - Containers with > 8 children render the first 8, then a `… N more` toggle that expands the rest.

- [ ] **Step 1: Write failing tests**

Create `frontend/tests/MemoryView.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryCell } from "../src/viz/MemoryCell";
import type { NormalizedCell } from "../src/viz/memoryModel";

function cell(p: Partial<NormalizedCell>): NormalizedCell {
  return { id: "id", name: "n", source: "stack", kind: "scalar", address: null, type: null, displayValue: "", rawValue: null, ...p };
}

describe("MemoryCell", () => {
  it("tags a reference cell with cell id and a port", () => {
    const { container } = render(<MemoryCell cell={cell({ id: "stack-f-p", name: "p", kind: "reference", displayValue: "-> 0x100", targetAddress: "0x100" })} />);
    expect(container.querySelector('[data-cell-id="stack-f-p"]')).not.toBeNull();
    expect(container.querySelector('[data-port-id="stack-f-p"]')).not.toBeNull();
  });

  it("renders a vector header and indexed children", () => {
    render(<MemoryCell cell={cell({ id: "v", name: "v", kind: "vector", elementType: "int", length: 2, displayValue: "vector<int> · 2",
      children: [cell({ id: "v0", name: "[0]", displayValue: "10" }), cell({ id: "v1", name: "[1]", displayValue: "20" })] })} />);
    expect(screen.getByText("vector<int> · 2")).toBeDefined();
    expect(screen.getByText("10")).toBeDefined();
    expect(screen.getByText("20")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/MemoryView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/viz/MemoryCell.tsx`:

```tsx
import { useState } from "react";
import type { NormalizedCell } from "./memoryModel";

const COLLAPSE_AT = 8;

export function MemoryCell({ cell }: { cell: NormalizedCell }) {
  return (
    <div className={`cell cell-${cell.kind}`} data-cell-id={cell.id}>
      <div className="cell-head">
        <span className="cell-name">{cell.name}</span>
        {cell.type && cell.kind !== "vector" && cell.kind !== "array" && <span className="cell-type">{cell.type}</span>}
        <CellValue cell={cell} />
      </div>
      {hasChildren(cell) && <Children cell={cell} />}
    </div>
  );
}

function CellValue({ cell }: { cell: NormalizedCell }) {
  if (cell.kind === "reference") {
    return (
      <span className={`cell-value ref ${cell.unresolved ? "unresolved" : ""}`}>
        {cell.displayValue}
        <span className="port" data-port-id={cell.id} />
      </span>
    );
  }
  if (cell.kind === "vector" || cell.kind === "array" || cell.kind === "struct") {
    return <span className="cell-value summary">{cell.displayValue}</span>;
  }
  return <span className="cell-value">{cell.displayValue}</span>;
}

function hasChildren(cell: NormalizedCell): boolean {
  return Array.isArray(cell.children) && cell.children.length > 0;
}

function Children({ cell }: { cell: NormalizedCell }) {
  const all = cell.children ?? [];
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? all : all.slice(0, COLLAPSE_AT);
  const hidden = all.length - shown.length;
  const grid = cell.kind === "array" || cell.kind === "vector";
  return (
    <div className={`cell-children ${grid ? "grid" : ""}`}>
      {shown.map((child) => <MemoryCell key={child.id} cell={child} />)}
      {hidden > 0 && (
        <button className="more-toggle" onClick={() => setExpanded(true)}>… {hidden} more</button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/MemoryView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/MemoryCell.tsx frontend/tests/MemoryView.test.tsx
git commit -m "feat(frontend): recursive MemoryCell renderer with ports and collapsing"
```

---

## Task 7: MemoryView sections

Renders Globals / Stack / Heap in one positioned container, ready for the overlay.

**Files:**
- Create: `frontend/src/viz/MemoryView.tsx`
- Create: `frontend/src/viz/Connectors.tsx` (temporary stub here; real impl in Task 8)
- Test: `frontend/tests/MemoryView.test.tsx` (extend)

**Interfaces:**
- Consumes: `normalizeMemory(point)`, `NormalizedMemory`, `MemoryCell`, and `Connectors` (Task 8).
- Produces: `MemoryView({ point }: { point: ExecPoint })`. Renders a `<div className="memory" ref>` containing `.memory-section` blocks for Globals (if any), each Stack frame (titled by `frame.name`), and Heap (if any), then mounts `<Connectors containerRef={ref} links={memory.links} stepKey={point.line} />`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/MemoryView.test.tsx`:

```ts
import { MemoryView } from "../src/viz/MemoryView";
import type { ExecPoint } from "../src/types/trace";

it("renders globals, stack frames by name, and heap sections", () => {
  const point: ExecPoint = {
    line: 1, event: "step_line", func_name: "main", stdout: "",
    ordered_globals: ["g"], globals: { g: ["C_DATA", "0x1", "int", 5] },
    heap: { "0x100": ["C_DATA", "0x100", "int", 7] },
    stack_to_render: [{ unique_hash: "main_0x1", frame_id: "0x1", func_name: "main",
      ordered_varnames: ["x"], encoded_locals: { x: ["C_DATA", "0x10", "int", 41] } }] as any,
  };
  render(<MemoryView point={point} />);
  expect(screen.getByText("Globals")).toBeDefined();
  expect(screen.getByText("main")).toBeDefined();
  expect(screen.getByText("Heap")).toBeDefined();
  expect(screen.getByText("41")).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/MemoryView.test.tsx -t "renders globals"`
Expected: FAIL — `MemoryView` not found.

- [ ] **Step 3: Implement (with a temporary Connectors stub)**

Create `frontend/src/viz/Connectors.tsx` (stub, replaced in Task 8):

```tsx
export function Connectors(_props: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  links: unknown[];
  stepKey: number;
}) {
  return null;
}
```

Create `frontend/src/viz/MemoryView.tsx`:

```tsx
import { useRef } from "react";
import type { ExecPoint } from "../types/trace";
import { normalizeMemory } from "./memoryModel";
import { MemoryCell } from "./MemoryCell";
import { Connectors } from "./Connectors";

export function MemoryView({ point }: { point: ExecPoint }) {
  const memory = normalizeMemory(point);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="memory" ref={containerRef}>
      {memory.globals.length > 0 && (
        <section className="memory-section">
          <h3>Globals</h3>
          <div className="frame-cells">{memory.globals.map((c) => <MemoryCell key={c.id} cell={c} />)}</div>
        </section>
      )}
      {memory.frames.map((frame) => (
        <section className="memory-section frame" key={frame.id}>
          <div className="frame-name">{frame.name}</div>
          <div className="frame-cells">{frame.cells.map((c) => <MemoryCell key={c.id} cell={c} />)}</div>
        </section>
      ))}
      {memory.heap.length > 0 && (
        <section className="memory-section">
          <h3>Heap</h3>
          <div className="frame-cells">{memory.heap.map((c) => <MemoryCell key={c.id} cell={c} />)}</div>
        </section>
      )}
      <Connectors containerRef={containerRef} links={memory.links} stepKey={point.line} />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/MemoryView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/MemoryView.tsx frontend/src/viz/Connectors.tsx frontend/tests/MemoryView.test.tsx
git commit -m "feat(frontend): MemoryView with globals/stack/heap sections"
```

---

## Task 8: Connectors SVG overlay

Reads DOM rects for ports/targets and draws bezier arrows; recomputes on step/resize/scroll.

**Files:**
- Modify: `frontend/src/viz/Connectors.tsx` (replace the stub)
- Test: `frontend/tests/Connectors.test.tsx`

**Interfaces:**
- Consumes: `MemoryLink` from `memoryModel`, `sourcePoint`/`targetPoint`/`bezierPath`/`Rect` from `connectorGeometry`.
- Produces: `Connectors({ containerRef, links, stepKey }: { containerRef: React.RefObject<HTMLDivElement | null>; links: MemoryLink[]; stepKey: number })`. Renders an absolutely-positioned `<svg className="connectors">`; one `<path className="connector resolved">` per link whose port (`[data-port-id=fromId]`) and target (`[data-cell-id=toId]`) both exist. Unresolved references show only the dashed port from `MemoryCell` (Task 6/9); `Connectors` draws resolved links only.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/Connectors.test.tsx`:

```ts
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { useRef, useEffect, useState } from "react";
import { Connectors } from "../src/viz/Connectors";
import type { MemoryLink } from "../src/viz/memoryModel";

function rect(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON() {} } as DOMRect;
}

function Harness({ links }: { links: MemoryLink[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = ref.current!;
    el.getBoundingClientRect = () => rect(0, 0, 200, 200);
    const port = el.querySelector('[data-port-id="from"]');
    const target = el.querySelector('[data-cell-id="to"]');
    if (port) port.getBoundingClientRect = () => rect(10, 10, 20, 30);
    if (target) target.getBoundingClientRect = () => rect(120, 40, 180, 60);
    setReady(true);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <span data-port-id="from" />
      <span data-cell-id="to" />
      {ready && <Connectors containerRef={ref} links={links} stepKey={0} />}
    </div>
  );
}

describe("Connectors", () => {
  it("draws one path per resolved link with container-relative coordinates", () => {
    const links: MemoryLink[] = [{ fromId: "from", fromName: "p", toId: "to", targetAddress: "0x1" }];
    const { container } = render(<Harness links={links} />);
    const paths = container.querySelectorAll("path.connector");
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute("d")!.startsWith("M 20 20 C")).toBe(true); // source right edge
    expect(paths[0].getAttribute("d")).toContain("120 50");                 // target left-center
  });

  it("skips links whose endpoints are missing", () => {
    const links: MemoryLink[] = [{ fromId: "nope", fromName: "x", toId: "gone", targetAddress: "0x9" }];
    const { container } = render(<Harness links={links} />);
    expect(container.querySelectorAll("path.connector").length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/Connectors.test.tsx`
Expected: FAIL — stub renders `null`, zero paths.

- [ ] **Step 3: Implement**

Replace `frontend/src/viz/Connectors.tsx`:

```tsx
import { useLayoutEffect, useState } from "react";
import type { MemoryLink } from "./memoryModel";
import { sourcePoint, targetPoint, bezierPath, type Rect } from "./connectorGeometry";

interface Drawn { id: string; d: string }

function relRect(el: Element, origin: DOMRect): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top };
}

export function Connectors({
  containerRef, links, stepKey,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  links: MemoryLink[];
  stepKey: number;
}) {
  const [paths, setPaths] = useState<Drawn[]>([]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const origin = container.getBoundingClientRect();
      const drawn: Drawn[] = [];
      for (const link of links) {
        const port = container.querySelector(`[data-port-id="${CSS.escape(link.fromId)}"]`);
        const target = container.querySelector(`[data-cell-id="${CSS.escape(link.toId)}"]`);
        if (!port || !target) continue;
        const d = bezierPath(sourcePoint(relRect(port, origin)), targetPoint(relRect(target, origin)));
        drawn.push({ id: `${link.fromId}->${link.toId}`, d });
      }
      setPaths(drawn);
    };

    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(container);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [containerRef, links, stepKey]);

  return (
    <svg className="connectors" aria-hidden>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {paths.map((p) => (
        <path key={p.id} className="connector resolved" d={p.d} markerEnd="url(#arrow)" />
      ))}
    </svg>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/Connectors.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/Connectors.tsx frontend/tests/Connectors.test.tsx
git commit -m "feat(frontend): SVG connector overlay for pointer lines"
```

---

## Task 9: Wire MemoryView into App, remove StackView, add styles

Swap the old view in, delete the obsolete one, and style everything in the Bauhaus theme.

**Files:**
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/viz/StackView.tsx`, `frontend/tests/StackView.test.tsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: `MemoryView` from Task 7.
- Produces: `App`/`Visualized` rendering `<MemoryView point={player.point} />` in place of `StackView`.

- [ ] **Step 1: Remove StackView and its test**

```bash
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor
git rm frontend/src/viz/StackView.tsx frontend/tests/StackView.test.tsx
```

- [ ] **Step 2: Swap the view in App**

In `frontend/src/App.tsx`: replace `import { StackView } from "./viz/StackView";` with `import { MemoryView } from "./viz/MemoryView";`, and replace `<StackView point={player.point} />` with `<MemoryView point={player.point} />`.

- [ ] **Step 3: Add Bauhaus styles**

Append to `frontend/src/index.css`:

```css
/* ── Memory view ─────────────────────────────────────────────── */
.memory {
  position: relative;
  background: var(--panel);
  border: var(--border);
  border-radius: var(--radius);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.memory-section h3 { margin-bottom: 10px; }

.frame-cells { display: flex; flex-direction: column; gap: 8px; }

.memory-section.frame { border: var(--border-thin); border-radius: 10px; overflow: hidden; }
.memory-section.frame .frame-cells { padding: 10px; }

.cell {
  border: var(--border-thin);
  border-radius: 10px;
  padding: 6px 10px;
  background: var(--panel);
  font-family: var(--mono);
  font-size: 13px;
}

.cell-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cell-name { color: var(--ink-soft); }
.cell-type {
  font-size: 11px; color: var(--ink-soft);
  border: 1px solid rgba(26,26,26,0.2); border-radius: 6px; padding: 0 6px;
}
.cell-value { color: var(--ink); font-weight: 600; margin-left: auto; }
.cell-value.summary { font-weight: 700; }

.cell-value.ref { position: relative; color: var(--blue); }
.port {
  display: inline-block; width: 9px; height: 9px; margin-left: 6px;
  border-radius: 50%; background: var(--blue); vertical-align: middle;
}
.cell-value.ref.unresolved { color: var(--red); }
.cell-value.ref.unresolved .port {
  background: transparent; border: 2px dashed var(--red);
}

.cell-children { margin-top: 8px; padding-left: 10px; border-left: var(--border-thin); }
.cell-children.grid {
  display: flex; flex-wrap: wrap; gap: 6px;
  border-left: none; padding-left: 0;
}
.cell-children.grid .cell { padding: 4px 8px; }

.more-toggle {
  font-family: var(--sans); font-size: 12px; color: var(--ink);
  background: var(--yellow); border: var(--border-thin); border-radius: 8px;
  padding: 2px 10px; cursor: pointer;
}

/* connector overlay sits above cells but ignores pointer events */
.connectors {
  position: absolute; inset: 0; width: 100%; height: 100%;
  pointer-events: none; overflow: visible;
}
.connector { fill: none; stroke-width: 2; }
.connector.resolved { stroke: var(--blue); }
.connectors marker path { fill: var(--blue); }
```

- [ ] **Step 4: Run the full suite, build, and lint**

Run: `cd frontend && npm test && npm run build && npm run lint`
Expected: all tests PASS, build succeeds, lint clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/index.css
git commit -m "feat(frontend): render MemoryView with connectors; remove StackView"
```

---

## Task 10: Manual visual verification

Confirm the real app shows cells, vectors, and lines.

**Files:** none (verification only).

- [ ] **Step 1: Start the app**

Run: `cd frontend && npm run dev`
Open the printed localhost URL. (Backend must be reachable at `http://localhost:8000` or `VITE_API`.)

- [ ] **Step 2: Trace a pointer + vector example**

Paste and visualize:

```cpp
#include <vector>
int main() {
  int a = 7;
  int* p = &a;
  std::vector<int> v;
  v.push_back(10);
  v.push_back(20);
  v.push_back(30);
  return 0;
}
```

- [ ] **Step 3: Confirm acceptance criteria**

Verify visually:
- `p` shows a blue port and a curved line to its target cell.
- `v` shows `vector<int> · 3` with indexed cells `[0]=10 [1]=20 [2]=30`, and no separate raw heap buffer for it.
- Stepping with the VCR controls redraws lines correctly; resizing the window keeps lines aligned.
- Unresolved references (if any) show a dashed red port and no line.
- Layout stays within the column; no horizontal page scroll.

- [ ] **Step 4: Note results**

Record pass/fail per criterion in the PR description. If a vector shows the wrong size or missing elements, compare Task 1's fixture against the real trace (the backend may need the scoped patch from Task 1 Step 3).

---

## Self-Review Notes

- **Spec coverage:** connectors / all-references → Tasks 3, 5, 8; recursive struct/array → Task 2; vector/string → Tasks 1, 4; MemoryView sections + Bauhaus polish + empty states → Tasks 7, 9; testing → every task; backend-verify risk → Task 1.
- **Type consistency:** `NormalizedCell` fields (`children/length/elementType/startAddress/finishAddress`), `MemoryLink` (`fromId/fromName/toId/targetAddress`), and component props (`MemoryCell{cell}`, `MemoryView{point}`, `Connectors{containerRef,links,stepKey}`) are used identically across tasks.
- **Empty/loading/error states:** pre-run empty state, Run-button loading, and error panels already live in `App.tsx` from the prior milestone and are preserved (Task 9 only swaps the view component).
- **Decision recorded:** vectors render elements inline and remove the backing heap buffer from the Heap section, so no extra vector→buffer connector is drawn; all real pointer references (including element-level) still draw lines, satisfying the "all references" decision.
