# Trace-budget raise + accurate infinite-loop detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let large-but-terminating C++ programs (e.g. a 5×5 surround-regions DFS) trace to completion, and stop mislabeling them as infinite loops.

**Architecture:** Two independent fixes. Fix 2 hardens the loop classifier in `step_limits.py` (pure Python, fast TDD, no image rebuild) so a degenerate/empty-body state repeat is never called a loop. Fix 1 raises the coupled resource budget (raw-step cap, byte budget, wall, timeout, memory, cpu-rlimit) as a single global profile; `MAX_STEPS` lives in Valgrind C source so it forces a tracer image rebuild.

**Tech Stack:** Python 2/3-compatible tracer postprocessing (`step_limits.py`), FastAPI backend (`backend/app/`), patched Valgrind 3.11 (`mc_translate.c`), Docker.

## Global Constraints

- `step_limits.py` MUST stay Python 2/3 compatible: ASCII only, no Python-3-only syntax, no `print` statements. It is imported under Python 2 in-container and unit-tested under Python 3.
- Do NOT hand-edit frontend fixtures; none change here.
- Measured completion target for the reference board: 24,043 raw steps, 90.8 MB vgtrace, 46.6 s wall (local ARM64/OrbStack), 294 rendered steps.
- After any change to `mc_translate.c`, the Dockerfile, or `*.patch`: rebuild `cpp-tutor-tracer:dev` AND run `docker rm -f cpp-tutor-tracer-warm` (the warm container keeps serving the old image otherwise).
- Ship both fixes; Fix 2 is required independently of Fix 1.

---

## Task 1: Accurate loop detection (Fix 2)

Harden `_loop_cut_index` so an infinite loop is declared only when the repeat encloses a real loop body OR is a genuine single-line spin. Pure Python; no image rebuild needed (`python3 test_step_limits.py` runs the module directly).

**Files:**
- Modify: `tracer/opt-cpp-backend/step_limits.py` (add `SPIN_RUN`, add `_tail_run_length`, rewrite `_loop_cut_index`)
- Test: `tracer/opt-cpp-backend/test_step_limits.py` (revise one test, add three)

**Interfaces:**
- Consumes: `fingerprint(point) -> str` (existing, unchanged).
- Produces: `_loop_cut_index(points) -> int | None` (same signature; stricter behavior). `_tail_run_length(fps: list[str]) -> int`. Module constant `SPIN_RUN = 8`.

- [ ] **Step 1: Write the failing test for the DFS false positive**

Add to `tracer/opt-cpp-backend/test_step_limits.py`:

```python
def test_adjacent_duplicate_final_state_is_not_a_loop():
    # The surround-regions DFS bug: a multi-part `if` line traces as several
    # basic blocks with no observable change; cut off at the step cap on the
    # SECOND such block, the final state equals its immediate predecessor
    # (empty loop body). That is not a cycle -- it is too long.
    pts = [pt(1, {"i": 0}), pt(2, {"i": 1}), pt(6, {"i": 2}), pt(6, {"i": 2})]
    out = apply_step_limits(pts, True)
    assert out[-1]["event"] == "instruction_limit_reached"
    assert "smaller input" in out[-1]["exception_msg"]
```

- [ ] **Step 2: Write the failing test for a short duplicate run (still too long)**

```python
def test_short_run_duplicate_final_state_is_not_a_loop():
    # A 3-long identical tail run, program otherwise progressing, no earlier
    # sighting of the repeated state -> below the spin threshold -> too long.
    pts = [pt(1, {"i": 0}), pt(2, {"i": 1}),
           pt(9, {"s": 0}), pt(9, {"s": 0}), pt(9, {"s": 0})]
    out = apply_step_limits(pts, True)
    assert out[-1]["event"] == "instruction_limit_reached"
```

- [ ] **Step 3: Write the failing test for a genuine single-line spin**

```python
def test_single_line_spin_flagged_as_infinite_loop():
    # while(true); -- a long run of byte-identical consecutive states at the
    # step cap. No distinct body, but the run length proves the spin.
    pts = [pt(1, {"i": 0}), pt(2, {"i": 1})]
    pts += [pt(9, {"s": 0}) for _ in range(9)]  # >= SPIN_RUN identical
    out = apply_step_limits(pts, True)
    assert out[-1]["event"] == "infinite_loop_detected"
```

- [ ] **Step 4: Revise `test_stdout_excluded_from_fingerprint` to a real-cycle fixture**

Its old 2-point adjacent-identical shape is exactly what Fix 2 now rejects. Preserve its intent (stdout excluded from the fingerprint) with a genuine cycle. Replace the whole function body:

```python
def test_stdout_excluded_from_fingerprint():
    # stdout differs but is excluded from the fingerprint, so the final state
    # still matches an earlier one; pt6 is a real loop body between the two
    # sightings -> genuine cycle.
    pts = [pt(5, {"x": 1}, stdout="a"), pt(6, {"x": 2}), pt(5, {"x": 1}, stdout="abc")]
    out = apply_step_limits(pts, True)
    assert out[-1]["event"] == "infinite_loop_detected"
```

- [ ] **Step 5: Run the tests to verify the three new ones fail (and the revised one)**

Run: `cd tracer/opt-cpp-backend && python3 test_step_limits.py`
Expected: FAIL — `test_adjacent_duplicate_final_state_is_not_a_loop` and `test_short_run_duplicate_final_state_is_not_a_loop` report `infinite_loop_detected` instead of `instruction_limit_reached` (current code flags any second occurrence, adjacent or not). `test_single_line_spin_flagged_as_infinite_loop` currently PASSES (adjacent repeat already flags) — that is fine; it locks in behavior we must keep. The revised `test_stdout_excluded_from_fingerprint` currently PASSES too.

- [ ] **Step 6: Implement the guard in `step_limits.py`**

Add the constant next to `DISPLAY_CAP` (line 16):

```python
DISPLAY_CAP = 2000

# Minimum length of an all-identical tail run that counts as a genuine
# single-line spin loop (while(true);). Below this, an adjacent/short
# identical run is a degenerate repeat (e.g. multiple basic-block samples of
# one multi-part source line caught at the step cap), not a loop.
SPIN_RUN = 8
```

Add a helper above `_loop_cut_index`:

```python
def _tail_run_length(fps):
    """Count identical fingerprints at the very end of the trace."""
    last = fps[-1]
    count = 0
    for k in range(len(fps) - 1, -1, -1):
        if fps[k] == last:
            count += 1
        else:
            break
    return count
```

Replace the body of `_loop_cut_index` (currently the `occurrences`-counting loop) with:

```python
    n = len(points)
    if n < 2:
        return None
    fps = [fingerprint(p) for p in points]
    last = fps[-1]
    first = None
    for i in range(n):
        if fps[i] != last:
            continue
        if first is None:
            first = i
            continue
        # Second occurrence at i: the pair (first, i) is the cut boundary.
        # Only a real cycle counts. A real cycle either did observable work
        # between the two sightings (a distinct intermediate state -> real
        # loop body) or is a genuine single-line spin (a long identical tail
        # run). A degenerate repeat -- adjacent sightings with an empty body,
        # e.g. two basic-block samples of one multi-part source line cut off
        # at the step cap -- is NOT a loop; the program was still progressing.
        has_body = any(fps[k] != last for k in range(first + 1, i))
        is_spin = _tail_run_length(fps) >= SPIN_RUN
        if has_body or is_spin:
            return i + 1
        return None
    return None
```

Keep the existing docstring; it still describes the final-state keying. Add one sentence to it noting the non-trivial-period guard (adjacent empty-body repeats and short runs are rejected).

- [ ] **Step 7: Run the full suite to verify all pass**

Run: `cd tracer/opt-cpp-backend && python3 test_step_limits.py`
Expected: `ALL PASS` — the three new tests, the revised `test_stdout_excluded_from_fingerprint`, and all previously-passing tests (`test_state_cycle_flagged_as_infinite_loop`, `test_infinite_loop_flagged_when_final_state_recurs`, `test_early_call_then_step_line_repeat_is_not_a_loop`, `test_mid_trace_state_repeat_is_not_a_loop_when_final_state_novel`, `test_long_not_stuck_gets_budget_message`, `test_display_ceiling_truncates`, `test_cycle_beyond_display_cap_is_instruction_limit`, `test_no_false_positive_on_distinct_states`, `test_state_repeat_not_flagged_when_terminated_within_budget`, `test_same_cycle_flagged_only_when_budget_exhausted`, `test_terminating_trace_is_unchanged`, `test_empty_list_returned_as_is`, `test_fingerprint_differs_on_line_and_matches_on_state`).

- [ ] **Step 8: Commit**

```bash
git add tracer/opt-cpp-backend/step_limits.py tracer/opt-cpp-backend/test_step_limits.py
git commit -m "fix(tracer): reject degenerate empty-body state repeats in loop detection"
```

---

## Task 2: Raise the Python-side budget constants (Fix 1, part 1)

Bump the byte/wall budgets, backend timeout, container memory, and cpu rlimit. No image rebuild for these (Python + argv); they take effect on the next backend run. Verified end-to-end together with Task 3.

**Files:**
- Modify: `tracer/opt-cpp-backend/step_limits.py:36-37`
- Modify: `backend/app/tracer_service.py:19` and `:107`
- Modify: `backend/app/local_tracer.py:17`

**Interfaces:**
- Consumes: nothing new.
- Produces: raised module/argv constants only; no signature changes.

- [ ] **Step 1: Raise `VGTRACE_BYTE_BUDGET` and `VALGRIND_WALL_SECONDS`**

In `tracer/opt-cpp-backend/step_limits.py`:

```python
VGTRACE_BYTE_BUDGET = 128 * 1024 * 1024
VALGRIND_WALL_SECONDS = 90
```

Then update the stale numbers in the comment block directly above (lines ~18-35) so it stays self-documenting: change "inside the backend's 60s request timeout" to "120s request timeout", "so 30MB is ~9s + ~3s locally" to "so 128MB is ~36s + ~13s locally", and "stays under the 60s backend timeout" to "stays under the 120s backend timeout". Add a sentence: "Sized from a measured reference (5x5 surround-regions DFS): 24,043 raw steps, 90.8 MB vgtrace, 46.6 s local wall."

- [ ] **Step 2: Raise the backend timeout and container memory**

In `backend/app/tracer_service.py`:

```python
_LIMIT_FLAGS = [
    "--net=none", "--cap-drop", "all", "--user=netuser",
    "--memory=2g", "--cpus=1", "--pids-limit=128",
]
```

and the `run_trace` default:

```python
def run_trace(code: str, lang: str,
              image: str = "cpp-tutor-tracer:dev",
              timeout: int = 120) -> Trace | CompileError:
```

- [ ] **Step 3: Raise the local-tracer CPU rlimit**

In `backend/app/local_tracer.py`:

```python
RLIMIT_CPU_SECONDS = 115       # below the 120s wrapper timeout
```

- [ ] **Step 4: Verify the backend still imports and its unit tests pass**

Run: `cd backend && .venv/bin/pytest -m "not docker" -q`
Expected: PASS (no behavioral tests depend on the old constant values; this confirms nothing imports-broke).

- [ ] **Step 5: Commit**

```bash
git add tracer/opt-cpp-backend/step_limits.py backend/app/tracer_service.py backend/app/local_tracer.py
git commit -m "perf(tracer): raise byte/wall/timeout/memory budgets for larger traces"
```

---

## Task 3: Raise `MAX_STEPS` and rebuild the tracer (Fix 1, part 2)

`MAX_STEPS` is compiled into Valgrind, so this task owns the image rebuild and the end-to-end verification that the reference board now completes.

**Files:**
- Modify: `tracer/opt-cpp-backend/valgrind-3.11.0/memcheck/mc_translate.c:52`

**Interfaces:**
- Consumes: Task 1 (correct classifier) + Task 2 (raised byte/wall budgets) must already be in place, or the board is re-cut by the byte budget / re-mislabeled.
- Produces: a rebuilt `cpp-tutor-tracer:dev` image whose raw-step cap is 30000.

- [ ] **Step 1: Raise the constant**

In `tracer/opt-cpp-backend/valgrind-3.11.0/memcheck/mc_translate.c`, line 52:

```c
const int MAX_STEPS = 30000; // cpp-tutor: raw-instruction cap. Sized from a measured reference (5x5 surround-regions DFS = 24,043 raw steps, 90.8 MB vgtrace, 46.6 s local ARM64/OrbStack wall). Production is ~7.6x slower; the 120s backend timeout and 128MB VGTRACE_BYTE_BUDGET (step_limits.py) are the coupled ceilings. Display cap (step_limits.DISPLAY_CAP=2000) is higher, so STL programs still hit resource caps first.
```

- [ ] **Step 2: Rebuild the tracer image**

Run: `docker build -t cpp-tutor-tracer:dev tracer/`
Expected: build succeeds. The Valgrind layer recompiles (slow — minutes).

- [ ] **Step 3: Drop the warm container**

Run: `docker rm -f cpp-tutor-tracer-warm`
Expected: removes the stale warm container (or prints "No such container" — both fine).

- [ ] **Step 4: End-to-end verify the reference board completes**

Save the surround-regions program to `/tmp/board.cpp` (the full LeetCode example: `printBoard`/`dfs`/`solve`/`main` on the 5×5 board), then run the tracer directly against the freshly built image:

```bash
docker run --rm -i --entrypoint python cpp-tutor-tracer:dev \
  /opt/tracer/run_cpp_backend.py "$(cat /tmp/board.cpp)" cpp --jsondump \
  > /tmp/trace.json 2>/dev/null
python3 - <<'PY'
import json
t = json.load(open("/tmp/trace.json")).get("trace", [])
last = t[-1]
print("rendered steps:", len(t))
print("last event:", last.get("event"))
print("After printed:", "After" in (last.get("stdout") or ""))
assert last.get("event") == "return", last.get("event")
assert "After" in (last.get("stdout") or "")
assert 250 <= len(t) <= 400
print("OK: board traces to completion, no loop/limit label")
PY
```

Expected: `last event: return`, `After printed: True`, `rendered steps ≈ 294`, `OK` printed. NOT `infinite_loop_detected` and NOT `instruction_limit_reached`.

- [ ] **Step 5: Regression — a genuine infinite loop is still caught**

```bash
printf '%s' 'int main(){ while(true){} return 0; }' > /tmp/spin.cpp
docker run --rm -i --entrypoint python cpp-tutor-tracer:dev \
  /opt/tracer/run_cpp_backend.py "$(cat /tmp/spin.cpp)" cpp --jsondump \
  > /tmp/spin.json 2>/dev/null
python3 - <<'PY'
import json
t = json.load(open("/tmp/spin.json")).get("trace", [])
print("last event:", t[-1].get("event"))
assert t[-1].get("event") == "infinite_loop_detected", t[-1].get("event")
print("OK: genuine spin still flagged")
PY
```

Expected: `last event: infinite_loop_detected`, `OK`.

- [ ] **Step 6: Commit**

```bash
git add tracer/opt-cpp-backend/valgrind-3.11.0/memcheck/mc_translate.c
git commit -m "perf(tracer): raise MAX_STEPS to 30000 for larger bounded programs"
```

Note: `tracer/opt-cpp-backend` is a git submodule; if the working tree tracks it as such, commit inside the submodule first, then record the pointer bump in the superproject.

---

## Notes / future work (out of scope)

The only true *scaling* fix is reducing per-step trace size — the reference board emits 90.8 MB because every raw step re-dumps the whole nested container. Delta / changed-heap encoding would cut this dramatically but touches the frontend decode pipeline (`memoryModel.ts`) and the trace format. Tracked separately, not in this plan.
