# cpp-tutor Milestone 1 — Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an end-to-end slice: paste C/C++ → server compiles and traces it under Valgrind → browser steps through execution showing stack frames and scalar variable values with First/Prev/Next/Last controls.

**Architecture:** A Docker image vendoring `JuezUN/opt-cpp-backend` produces pythontutor-format trace JSON. A FastAPI service runs that image per request (locked-down container) and returns the full trace in one response. A React (Vite) frontend holds the trace in memory and renders one step at a time entirely client-side, so stepping is instant.

**Tech Stack:** Docker, Python 3.11 + FastAPI + pytest (backend host), Python 2 (inside tracer container, upstream constraint), React 18 + TypeScript + Vite + Vitest (frontend), CodeMirror 6 (editor).

## Global Constraints

- Languages traced: **C and C++ only**. `lang` is always `"c"` or `"cpp"`.
- Tracer entry contract (inside container): `python run_cpp_backend.py "<source>" <c|cpp> [stdin] --jsondump` → OPT trace JSON on stdout; diagnostics on stderr (ignore stderr).
- Tracer image is **Python 2** and **ubuntu:14.04** internally — do not "modernize" it. The host service is Python 3.11.
- Container run flags (never omit): `--rm --net=none --cap-drop all --user=netuser --memory=256m --cpus=1 --pids-limit=128`.
- Trace JSON schema is pythontutor's OPT format: top-level `{code, trace}` where `trace` is a list of execution points, each `{line, event, func_name, stack_to_render, heap, globals, ordered_globals, stdout}`.
- Per-run wall-clock timeout: **15 seconds** (host-side kill).
- TDD: every task is failing-test-first. Commit after each task's tests pass.

---

## File Structure

```
cpp-tutor/
  tracer/
    opt-cpp-backend/        # git submodule: JuezUN/opt-cpp-backend
    Dockerfile             # builds the tracer image
    sample.cpp             # smoke-test program
  backend/
    pyproject.toml
    app/
      __init__.py
      trace_model.py       # Pydantic models for OPT trace
      tracer_service.py    # runs the container, returns Trace | TraceError
      api.py               # FastAPI app, /api/trace
    tests/
      test_tracer_service.py
      test_api.py
      fixtures/
        pointers.cpp
  frontend/
    package.json
    vite.config.ts
    vitest.config.ts
    index.html
    src/
      types/trace.ts       # TS mirror of trace_model
      api/client.ts        # POST /api/trace
      player/usePlayer.ts  # step state machine
      viz/StackView.tsx    # frames + scalar values
      viz/CodeView.tsx     # read-only code with line markers
      controls/Vcr.tsx     # First/Prev/Next/Last + counter
      Editor.tsx           # CodeMirror wrapper
      App.tsx
    tests/
      usePlayer.test.ts
      StackView.test.tsx
```

---

## Task 1: Tracer Docker image emits trace JSON

**Files:**
- Create: `tracer/Dockerfile`
- Create: `tracer/sample.cpp`
- Create (submodule): `tracer/opt-cpp-backend`
- Create: `.gitmodules` (auto)

**Interfaces:**
- Produces: a Docker image tagged `cpp-tutor-tracer:dev` that, run as
  `docker run --rm -i cpp-tutor-tracer:dev python /opt/tracer/run_cpp_backend.py "<code>" cpp --jsondump`,
  prints OPT trace JSON to stdout.

- [ ] **Step 1: Vendor the upstream tracer as a submodule**

```bash
cd cpp-tutor
git submodule add https://github.com/JuezUN/opt-cpp-backend.git tracer/opt-cpp-backend
git -C tracer/opt-cpp-backend checkout master
```

- [ ] **Step 2: Write the smoke-test program**

Create `tracer/sample.cpp`:

```cpp
#include <iostream>
using namespace std;
int main() {
  int x = 41;
  int y = x + 1;
  cout << y << endl;
  return 0;
}
```

- [ ] **Step 3: Write the Dockerfile**

Create `tracer/Dockerfile`. (Ubuntu 14.04 is EOL, so its apt mirrors moved to `old-releases.ubuntu.com`; the `sed` line fixes the classic apt 404.)

```dockerfile
FROM ubuntu:14.04

# 14.04 is EOL — repoint apt at the archive so apt-get update works.
RUN sed -i 's|http://archive.ubuntu.com|http://old-releases.ubuntu.com|g; s|http://security.ubuntu.com|http://old-releases.ubuntu.com|g' /etc/apt/sources.list \
 && apt-get update && apt-get install -y \
    build-essential autotools-dev automake libc6-dbg python \
 && rm -rf /var/lib/apt/lists/*

COPY opt-cpp-backend /opt/tracer
WORKDIR /opt/tracer/valgrind-3.11.0
RUN ./autogen.sh && ./configure --prefix=`pwd`/inst && make && make install

RUN useradd netuser && find /opt/tracer | xargs chown netuser
WORKDIR /opt/tracer
```

- [ ] **Step 4: Build the image (this is the failing-test equivalent — it must succeed)**

Run:
```bash
docker build -t cpp-tutor-tracer:dev tracer/
```
Expected: build completes. If Valgrind's `make` fails, that is the Phase-1 risk firing — STOP and escalate (fallback is a gdb-based tracer per the spec).

- [ ] **Step 5: Run the container against the sample and verify JSON**

Run:
```bash
CODE=$(cat tracer/sample.cpp)
docker run --rm -i --net=none --cap-drop all --user=netuser \
  --memory=256m --cpus=1 --pids-limit=128 \
  cpp-tutor-tracer:dev python /opt/tracer/run_cpp_backend.py "$CODE" cpp --jsondump \
  | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'trace' in d and len(d['trace'])>0; print('OK steps=', len(d['trace']))"
```
Expected: `OK steps= <N>` with N > 0.

- [ ] **Step 6: Commit**

```bash
git add .gitmodules tracer/
git commit -m "feat(tracer): vendor opt-cpp-backend, Dockerfile emits OPT trace JSON"
```

---

## Task 2: trace_model — typed OPT schema

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/app/trace_model.py`
- Test: `backend/tests/test_trace_model.py`

**Interfaces:**
- Produces: `Trace` and `TraceResult` Pydantic models.
  - `ExecPoint(line:int, event:str, func_name:str, stack_to_render:list, heap:dict, globals:dict, ordered_globals:list[str], stdout:str)`
  - `Trace(code:str, trace:list[ExecPoint])`
  - `parse_trace(raw:dict) -> Trace`
  - `CompileError(status:Literal["compile_error"], message:str, line:int|None)`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_trace_model.py`:

```python
from app.trace_model import parse_trace, Trace

def test_parse_minimal_trace():
    raw = {
        "code": "int main(){return 0;}",
        "trace": [
            {"line": 1, "event": "step_line", "func_name": "main",
             "stack_to_render": [], "heap": {}, "globals": {},
             "ordered_globals": [], "stdout": ""}
        ],
    }
    t = parse_trace(raw)
    assert isinstance(t, Trace)
    assert len(t.trace) == 1
    assert t.trace[0].func_name == "main"
    assert t.trace[0].line == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_trace_model.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.trace_model'`.

- [ ] **Step 3: Write pyproject + the model**

Create `backend/pyproject.toml`:

```toml
[project]
name = "cpp-tutor-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["fastapi>=0.110", "uvicorn>=0.29", "pydantic>=2.6"]

[project.optional-dependencies]
dev = ["pytest>=8.0", "httpx>=0.27"]

[tool.pytest.ini_options]
pythonpath = ["."]
```

Create `backend/app/__init__.py` (empty).

Create `backend/app/trace_model.py`:

```python
from typing import Any, Literal
from pydantic import BaseModel


class ExecPoint(BaseModel):
    line: int
    event: str
    func_name: str = ""
    stack_to_render: list[Any] = []
    heap: dict[str, Any] = {}
    globals: dict[str, Any] = {}
    ordered_globals: list[str] = []
    stdout: str = ""


class Trace(BaseModel):
    code: str
    trace: list[ExecPoint]


class CompileError(BaseModel):
    status: Literal["compile_error"] = "compile_error"
    message: str
    line: int | None = None


def parse_trace(raw: dict) -> Trace:
    return Trace.model_validate(raw)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_trace_model.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/pyproject.toml backend/app/__init__.py backend/app/trace_model.py backend/tests/test_trace_model.py
git commit -m "feat(backend): OPT trace Pydantic models + parse_trace"
```

---

## Task 3: tracer_service — run the container, return a Trace

**Files:**
- Create: `backend/app/tracer_service.py`
- Test: `backend/tests/test_tracer_service.py`
- Test fixture: `backend/tests/fixtures/pointers.cpp`

**Interfaces:**
- Consumes: `trace_model.parse_trace`, `Trace`, `CompileError`.
- Produces: `run_trace(code:str, lang:str, image:str="cpp-tutor-tracer:dev", timeout:int=15) -> Trace | CompileError`.
  Raises `TracerTimeout` on wall-clock overrun, `TracerError` on non-JSON output.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/fixtures/pointers.cpp`:

```cpp
int main() {
  int a = 5;
  int* p = &a;
  *p = 7;
  return 0;
}
```

Create `backend/tests/test_tracer_service.py`:

```python
import pytest
from app.tracer_service import run_trace, TracerTimeout
from app.trace_model import Trace, CompileError

pytestmark = pytest.mark.docker  # requires built image; skip in unit-only CI

def test_run_trace_returns_trace():
    with open("tests/fixtures/pointers.cpp") as f:
        code = f.read()
    result = run_trace(code, "cpp")
    assert isinstance(result, Trace)
    assert len(result.trace) >= 3
    assert any(pt.func_name == "main" for pt in result.trace)

def test_compile_error_is_structured():
    result = run_trace("int main(){ return", "cpp")
    assert isinstance(result, CompileError)
    assert result.message
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_tracer_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.tracer_service'`.

- [ ] **Step 3: Write the service**

Create `backend/app/tracer_service.py`:

```python
import json
import subprocess
from app.trace_model import Trace, CompileError, parse_trace


class TracerError(Exception):
    pass


class TracerTimeout(TracerError):
    pass


def _docker_cmd(code: str, lang: str, image: str) -> list[str]:
    return [
        "docker", "run", "--rm", "-i",
        "--net=none", "--cap-drop", "all", "--user=netuser",
        "--memory=256m", "--cpus=1", "--pids-limit=128",
        image,
        "python", "/opt/tracer/run_cpp_backend.py", code, lang, "--jsondump",
    ]


def run_trace(code: str, lang: str,
              image: str = "cpp-tutor-tracer:dev",
              timeout: int = 15) -> Trace | CompileError:
    if lang not in ("c", "cpp"):
        raise TracerError(f"unsupported lang: {lang}")
    try:
        proc = subprocess.run(
            _docker_cmd(code, lang, image),
            capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired as e:
        raise TracerTimeout("tracer exceeded time limit") from e

    out = proc.stdout.strip()
    try:
        raw = json.loads(out)
    except json.JSONDecodeError as e:
        raise TracerError(f"tracer produced non-JSON output: {out[:200]}") from e

    # The OPT backend reports a compile error as a single-point trace whose
    # event is "uncaught_exception" with the compiler message in exception_msg.
    tr = raw.get("trace", [])
    if len(tr) == 1 and tr[0].get("event") == "uncaught_exception" \
            and "exception_msg" in tr[0]:
        return CompileError(message=tr[0]["exception_msg"],
                            line=tr[0].get("line"))
    return parse_trace(raw)
```

- [ ] **Step 4: Run the tests (requires the image from Task 1)**

Run: `cd backend && python -m pytest tests/test_tracer_service.py -v`
Expected: PASS (both tests). If the image is missing, build it first (Task 1, Step 4).

- [ ] **Step 5: Commit**

```bash
git add backend/app/tracer_service.py backend/tests/test_tracer_service.py backend/tests/fixtures/pointers.cpp
git commit -m "feat(backend): tracer_service runs sandbox, returns Trace or CompileError"
```

---

## Task 4: FastAPI /api/trace endpoint

**Files:**
- Create: `backend/app/api.py`
- Test: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: `run_trace`, `Trace`, `CompileError`, `TracerTimeout`.
- Produces: FastAPI `app`. `POST /api/trace` body `{code:str, lang:"c"|"cpp"}`.
  - 200 + `Trace` JSON on success.
  - 200 + `CompileError` JSON on compile error.
  - 503 `{detail}` on timeout.
  - 422 on bad body (FastAPI default).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_api.py`:

```python
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.api import app
from app.trace_model import Trace, ExecPoint, CompileError
from app.tracer_service import TracerTimeout

client = TestClient(app)

def _fake_trace():
    return Trace(code="x", trace=[ExecPoint(line=1, event="step_line", func_name="main")])

def test_trace_ok():
    with patch("app.api.run_trace", return_value=_fake_trace()):
        r = client.post("/api/trace", json={"code": "int main(){}", "lang": "cpp"})
    assert r.status_code == 200
    assert len(r.json()["trace"]) == 1

def test_trace_compile_error():
    with patch("app.api.run_trace", return_value=CompileError(message="expected ;")):
        r = client.post("/api/trace", json={"code": "bad", "lang": "cpp"})
    assert r.status_code == 200
    assert r.json()["status"] == "compile_error"

def test_trace_timeout():
    with patch("app.api.run_trace", side_effect=TracerTimeout("too slow")):
        r = client.post("/api/trace", json={"code": "while(1){}", "lang": "cpp"})
    assert r.status_code == 503
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api'`.

- [ ] **Step 3: Write the API**

Create `backend/app/api.py`:

```python
from typing import Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from app.tracer_service import run_trace, TracerTimeout, TracerError
from app.trace_model import Trace, CompileError

app = FastAPI(title="cpp-tutor")
app.add_middleware(
    CORSMiddleware, allow_origins=["http://localhost:5173"],
    allow_methods=["*"], allow_headers=["*"],
)


class TraceRequest(BaseModel):
    code: str
    lang: Literal["c", "cpp"]


@app.post("/api/trace")
def trace(req: TraceRequest) -> Trace | CompileError:
    try:
        return run_trace(req.code, req.lang)
    except TracerTimeout:
        raise HTTPException(status_code=503,
                            detail="Program ran too long — try a smaller example.")
    except TracerError as e:
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_api.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api.py backend/tests/test_api.py
git commit -m "feat(backend): POST /api/trace endpoint with compile-error + timeout handling"
```

---

## Task 5: Frontend scaffold + trace types + API client

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/vitest.config.ts`, `frontend/tsconfig.json`, `frontend/index.html`
- Create: `frontend/src/types/trace.ts`
- Create: `frontend/src/api/client.ts`
- Test: `frontend/tests/client.test.ts`

**Interfaces:**
- Produces:
  - `types/trace.ts`: `ExecPoint`, `Trace`, `CompileError`, `TraceResult = Trace | CompileError`.
  - `api/client.ts`: `fetchTrace(code:string, lang:"c"|"cpp"): Promise<TraceResult>`.

- [ ] **Step 1: Scaffold Vite + install deps**

Run:
```bash
cd cpp-tutor
npm create vite@latest frontend -- --template react-ts
cd frontend && npm install && npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom && npm install @codemirror/state @codemirror/view @codemirror/lang-cpp
```

- [ ] **Step 2: Write vitest config**

Create `frontend/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "jsdom", globals: true, setupFiles: [] },
});
```

- [ ] **Step 3: Write the failing test**

Create `frontend/tests/client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchTrace } from "../src/api/client";

describe("fetchTrace", () => {
  it("posts code and returns parsed trace", async () => {
    const fake = { code: "x", trace: [{ line: 1, event: "step_line", func_name: "main", stack_to_render: [], heap: {}, globals: {}, ordered_globals: [], stdout: "" }] };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fake }) as any;
    const res = await fetchTrace("int main(){}", "cpp");
    expect("trace" in res && res.trace.length).toBe(1);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/client.test.ts`
Expected: FAIL — cannot find `../src/api/client`.

- [ ] **Step 5: Write types + client**

Create `frontend/src/types/trace.ts`:

```ts
export interface ExecPoint {
  line: number;
  event: string;
  func_name: string;
  stack_to_render: unknown[];
  heap: Record<string, unknown>;
  globals: Record<string, unknown>;
  ordered_globals: string[];
  stdout: string;
}
export interface Trace { code: string; trace: ExecPoint[]; }
export interface CompileError { status: "compile_error"; message: string; line: number | null; }
export type TraceResult = Trace | CompileError;
export const isCompileError = (r: TraceResult): r is CompileError =>
  (r as CompileError).status === "compile_error";
```

Create `frontend/src/api/client.ts`:

```ts
import type { TraceResult } from "../types/trace";

const BASE = import.meta.env.VITE_API ?? "http://localhost:8000";

export async function fetchTrace(code: string, lang: "c" | "cpp"): Promise<TraceResult> {
  const r = await fetch(`${BASE}/api/trace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, lang }),
  });
  if (r.status === 503) throw new Error("Program ran too long — try a smaller example.");
  if (!r.ok) throw new Error(`trace failed: ${r.status}`);
  return (await r.json()) as TraceResult;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/client.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): scaffold Vite app, trace types, API client"
```

---

## Task 6: Player state machine

**Files:**
- Create: `frontend/src/player/usePlayer.ts`
- Test: `frontend/tests/usePlayer.test.ts`

**Interfaces:**
- Consumes: `Trace` from `types/trace`.
- Produces: `usePlayer(trace: Trace)` hook returning
  `{ index:number, point:ExecPoint, total:number, first():void, prev():void, next():void, last():void, goto(i:number):void }`.
  `next`/`prev` clamp at bounds; `index` starts at 0.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/usePlayer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePlayer } from "../src/player/usePlayer";
import type { Trace } from "../src/types/trace";

const mk = (n: number): Trace => ({
  code: "x",
  trace: Array.from({ length: n }, (_, i) => ({
    line: i + 1, event: "step_line", func_name: "main",
    stack_to_render: [], heap: {}, globals: {}, ordered_globals: [], stdout: "",
  })),
});

describe("usePlayer", () => {
  it("steps and clamps at bounds", () => {
    const { result } = renderHook(() => usePlayer(mk(3)));
    expect(result.current.index).toBe(0);
    act(() => result.current.next());
    expect(result.current.index).toBe(1);
    act(() => { result.current.last(); result.current.next(); });
    expect(result.current.index).toBe(2); // clamped
    act(() => { result.current.first(); result.current.prev(); });
    expect(result.current.index).toBe(0); // clamped
    expect(result.current.total).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/usePlayer.test.ts`
Expected: FAIL — cannot find `../src/player/usePlayer`.

- [ ] **Step 3: Write the hook**

Create `frontend/src/player/usePlayer.ts`:

```ts
import { useState, useCallback } from "react";
import type { Trace } from "../types/trace";

export function usePlayer(trace: Trace) {
  const total = trace.trace.length;
  const [index, setIndex] = useState(0);
  const clamp = (i: number) => Math.max(0, Math.min(total - 1, i));
  const goto = useCallback((i: number) => setIndex(clamp(i)), [total]);
  return {
    index,
    total,
    point: trace.trace[index],
    first: () => setIndex(0),
    last: () => setIndex(total - 1),
    next: () => setIndex((i) => clamp(i + 1)),
    prev: () => setIndex((i) => clamp(i - 1)),
    goto,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/usePlayer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/player/usePlayer.ts frontend/tests/usePlayer.test.ts
git commit -m "feat(frontend): usePlayer step state machine with bound clamping"
```

---

## Task 7: Minimal viz — StackView (frames + scalar values)

**Files:**
- Create: `frontend/src/viz/StackView.tsx`
- Test: `frontend/tests/StackView.test.tsx`

**Interfaces:**
- Consumes: `ExecPoint`. A frame in `stack_to_render` has shape
  `{ func_name:string, encoded_locals: Record<string, unknown>, ordered_varnames: string[] }`.
  Scalar values are rendered as their JSON string; non-scalars (arrays/pointers, which are
  `["REF", id]` or `["C_DATA", ...]` arrays in OPT) render as the literal text `…` for now
  (full rendering lands in Milestone 2).
- Produces: `<StackView point={ExecPoint} />`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/StackView.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StackView } from "../src/viz/StackView";
import type { ExecPoint } from "../src/types/trace";

const point: ExecPoint = {
  line: 4, event: "step_line", func_name: "main",
  stack_to_render: [{
    func_name: "main",
    ordered_varnames: ["x", "y"],
    encoded_locals: { x: 41, y: 42 },
  }] as any,
  heap: {}, globals: {}, ordered_globals: [], stdout: "",
};

describe("StackView", () => {
  it("renders frame name and scalar locals in order", () => {
    render(<StackView point={point} />);
    expect(screen.getByText("main")).toBeDefined();
    expect(screen.getByText("x")).toBeDefined();
    expect(screen.getByText("41")).toBeDefined();
    expect(screen.getByText("42")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/StackView.test.tsx`
Expected: FAIL — cannot find `../src/viz/StackView`.

- [ ] **Step 3: Write StackView**

Create `frontend/src/viz/StackView.tsx`:

```tsx
import type { ExecPoint } from "../types/trace";

interface Frame {
  func_name: string;
  ordered_varnames: string[];
  encoded_locals: Record<string, unknown>;
}

function renderValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "…"; // REF/C_DATA — Milestone 2
  if (typeof v === "object") return "…";
  return String(v);
}

export function StackView({ point }: { point: ExecPoint }) {
  const frames = point.stack_to_render as unknown as Frame[];
  return (
    <div className="stack">
      <h3>Stack</h3>
      {frames.map((f, i) => (
        <div className="frame" key={i}>
          <div className="frame-name">{f.func_name}</div>
          <table>
            <tbody>
              {f.ordered_varnames.map((name) => (
                <tr key={name}>
                  <td className="var-name">{name}</td>
                  <td className="var-val">{renderValue(f.encoded_locals[name])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/StackView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/viz/StackView.tsx frontend/tests/StackView.test.tsx
git commit -m "feat(frontend): StackView renders frames + scalar locals"
```

---

## Task 8: CodeView + VCR controls + App wiring (end-to-end)

**Files:**
- Create: `frontend/src/viz/CodeView.tsx`
- Create: `frontend/src/controls/Vcr.tsx`
- Create: `frontend/src/Editor.tsx`
- Modify: `frontend/src/App.tsx` (replace Vite default)
- Test: `frontend/tests/Vcr.test.tsx`

**Interfaces:**
- Consumes: `usePlayer` return, `StackView`, `fetchTrace`, `isCompileError`.
- Produces:
  - `<CodeView code={string} activeLine={number} />` — numbered lines, highlights `activeLine`.
  - `<Vcr player={ReturnType<typeof usePlayer>} />` — four buttons + "Step i of N" counter.
  - `App` — textarea-or-CodeMirror editor, Visualize button, wires the trace → player → views.

- [ ] **Step 1: Write the failing test (Vcr)**

Create `frontend/tests/Vcr.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { Vcr } from "../src/controls/Vcr";
import { usePlayer } from "../src/player/usePlayer";
import type { Trace } from "../src/types/trace";

const mk = (n: number): Trace => ({
  code: "x",
  trace: Array.from({ length: n }, (_, i) => ({
    line: i + 1, event: "step_line", func_name: "main",
    stack_to_render: [], heap: {}, globals: {}, ordered_globals: [], stdout: "",
  })),
});

describe("Vcr", () => {
  it("shows counter and advances on Next", () => {
    const { result } = renderHook(() => usePlayer(mk(4)));
    const { rerender } = render(<Vcr player={result.current} />);
    expect(screen.getByText(/Step 1 of 4/)).toBeDefined();
    act(() => result.current.next());
    rerender(<Vcr player={result.current} />);
    expect(screen.getByText(/Step 2 of 4/)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/Vcr.test.tsx`
Expected: FAIL — cannot find `../src/controls/Vcr`.

- [ ] **Step 3: Write Vcr, CodeView, Editor**

Create `frontend/src/controls/Vcr.tsx`:

```tsx
import type { usePlayer } from "../player/usePlayer";

export function Vcr({ player }: { player: ReturnType<typeof usePlayer> }) {
  const { index, total, first, prev, next, last } = player;
  return (
    <div className="vcr">
      <button onClick={first} disabled={index === 0}>&lt;&lt; First</button>
      <button onClick={prev} disabled={index === 0}>&lt; Prev</button>
      <button onClick={next} disabled={index === total - 1}>Next &gt;</button>
      <button onClick={last} disabled={index === total - 1}>Last &gt;&gt;</button>
      <span className="counter">Step {index + 1} of {total}</span>
    </div>
  );
}
```

Create `frontend/src/viz/CodeView.tsx`:

```tsx
export function CodeView({ code, activeLine }: { code: string; activeLine: number }) {
  const lines = code.split("\n");
  return (
    <pre className="codeview">
      {lines.map((ln, i) => (
        <div key={i} className={i + 1 === activeLine ? "line active" : "line"}>
          <span className="lineno">{i + 1}</span>
          <span className="src">{ln || " "}</span>
        </div>
      ))}
    </pre>
  );
}
```

Create `frontend/src/Editor.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { cpp } from "@codemirror/lang-cpp";

export function Editor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        cpp(),
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="editor" ref={host} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/Vcr.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire App**

Replace `frontend/src/App.tsx`:

```tsx
import { useState } from "react";
import { Editor } from "./Editor";
import { CodeView } from "./viz/CodeView";
import { StackView } from "./viz/StackView";
import { Vcr } from "./controls/Vcr";
import { usePlayer } from "./player/usePlayer";
import { fetchTrace } from "./api/client";
import { isCompileError, type Trace } from "./types/trace";

const SAMPLE = `#include <iostream>
using namespace std;
int main() {
  int x = 41;
  int y = x + 1;
  cout << y << endl;
  return 0;
}`;

function Visualized({ trace }: { trace: Trace }) {
  const player = usePlayer(trace);
  return (
    <div className="viz">
      <div className="left">
        <CodeView code={trace.code} activeLine={player.point.line} />
        <Vcr player={player} />
      </div>
      <div className="right">
        <pre className="stdout">{player.point.stdout}</pre>
        <StackView point={player.point} />
      </div>
    </div>
  );
}

export default function App() {
  const [code, setCode] = useState(SAMPLE);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function visualize() {
    setErr(null); setTrace(null);
    try {
      const res = await fetchTrace(code, "cpp");
      if (isCompileError(res)) { setErr(res.message); return; }
      setTrace(res);
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="app">
      <h1>cpp-tutor</h1>
      <Editor value={code} onChange={setCode} />
      <button className="run" onClick={visualize}>Visualize Execution</button>
      {err && <pre className="error">{err}</pre>}
      {trace && <Visualized key={trace.code} trace={trace} />}
    </div>
  );
}
```

- [ ] **Step 6: Manual end-to-end check**

Run backend: `cd backend && pip install -e ".[dev]" && uvicorn app.api:app --reload`
Run frontend: `cd frontend && npm run dev`
In the browser at `http://localhost:5173`: click **Visualize Execution**, then click **Next >** repeatedly. Expected: active line advances, `x`/`y` appear in the Stack with values 41/42, stdout shows `42`.

- [ ] **Step 7: e2e smoke via browse skill**

Run (with both servers up):
```bash
B="$HOME/.claude/skills/gstack/browse/dist/browse"
$B goto http://localhost:5173
$B click "button.run"
$B wait ".stack"
$B js "document.querySelectorAll('.frame-name').length > 0"
```
Expected: final command prints `true`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/ frontend/tests/Vcr.test.tsx
git commit -m "feat(frontend): CodeView, VCR controls, CodeMirror editor, end-to-end App wiring"
```

---

## Self-Review

**Spec coverage (Milestone 1 subset):** stack frames ✔ (Task 7), scalar variable values ✔ (Task 7), VCR First/Prev/Next/Last + step counter ✔ (Task 8), line marker for executing line ✔ (CodeView active line, Task 8), print output box ✔ (App stdout, Task 8), C/C++ backend sandbox + real trace ✔ (Tasks 1–4), Docker per-run safety flags ✔ (Global Constraints + Task 3), compile-error handling ✔ (Tasks 3–4, App). **Deferred to Milestone 2+ (own plans):** pointer arrows, heap column, arrays, struct field tables, toggles (addresses/heapPrimitives/textReferences), drag/hide, dark mode, share links, breakpoints, richer C++ memory view. These are explicitly out of this plan's scope.

**Placeholder scan:** No TBD/TODO left in steps; the single `…` in `StackView.renderValue` is an intentional, specified Milestone-1 rendering for non-scalars (documented in the Task 7 interface), not a placeholder.

**Type consistency:** `fetchTrace(code, lang)` consistent across Tasks 5 and 8. `usePlayer(trace)` return shape (`index/total/point/first/prev/next/last/goto`) consistent across Tasks 6 and 8. `ExecPoint`/`Trace`/`CompileError` identical between `trace_model.py` (Task 2) and `trace.ts` (Task 5). Frame shape (`func_name/ordered_varnames/encoded_locals`) consistent between Task 7 test, implementation, and Task 8 usage.

## Milestone 2 preview (next plan, not this one)

Full memory rendering: decode OPT `REF`/`C_DATA`/`C_STRUCT`/`C_ARRAY` encodings, render heap column, draw pointer arrows in SVG (stack→heap and stack→stack), struct field tables, arrays as indexed cells. Then a Milestone 3 plan for toggles + drag/hide, and Milestone 4 for extras (dark mode, share links, breakpoints).
