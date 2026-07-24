# Design: Trace budget raise + accurate infinite-loop detection

Date: 2026-07-24

## Problem

A bounded LeetCode-style program (surround-regions DFS on a 5×5
`vector<vector<char>>`) never traces to completion. The stepper stops early
(user sees ~265 steps) and mislabels the program an **infinite loop**, even
though it terminates normally.

Two independent defects, one stacked on the other.

### Defect 1 — resource caps cut a terminating program short

Measured, full completion of this board needs:

| Resource | Needed | Current cap | Over by |
|---|---|---|---|
| Raw instruction steps (`MAX_STEPS`, `mc_translate.c`) | 24,043 | 3,500 | 6.9× |
| vgtrace bytes (`VGTRACE_BYTE_BUDGET`, `step_limits.py`) | 90.8 MB | 30 MB | 3.0× |
| Wall time (local ARM64/OrbStack) | 46.6 s | — | — |
| Rendered steps | 294 | 2,000 (`DISPLAY_CAP`) | fine |

The byte budget binds as hard as the step cap: every raw step re-dumps the
whole nested container (5 heap `C_ARRAY`s + 5 nested vector structs), so a 5×5
board produces 90 MB of vgtrace. Wall time at production speeds (~7.6× slower)
would be ~350 s — this program is realistically only completable in a
self-hosted run, not a shared 60 s-timeout service.

### Defect 2 — bounded DFS mislabeled as an infinite loop

Because the raw budget is exhausted, `apply_step_limits` runs
`_loop_cut_index`, which flags a loop when the final captured state recurs
earlier in the trace. The final cut-off state here is a `dfs` entry frame with
`<UNALLOCATED>` locals over an unchanged board — and it is **byte-identical to
its immediate predecessor** (indices 111 and 112 in the local trace). Line 6,
`if (i<0||j<0||i>=board.size()||j>=board[i].size()) return;`, is a multi-part
condition whose sub-expressions trace as several basic blocks on one source
line with no observable change. Cut off at the second of such a pair, the
final state "recurs" — but the loop body between the two sightings is **empty**.
That is not a cycle; it is two basic-block samples of one line.

The existing false-positive guards (call/step_line pair, leaked-heap loop
header — see `test_early_call_then_step_line_repeat_is_not_a_loop` and
`test_mid_trace_state_repeat_is_not_a_loop_when_final_state_novel`) do not
cover this shape because they assume the coincidental repeat is *not* the final
state. Here it is.

## Goals

1. Let substantially larger bounded programs trace to completion (this board
   and comparable ones).
2. Never label a terminating program an infinite loop because of a
   degenerate / empty-body state repeat.
3. Keep genuine infinite loops correctly detected and trimmed.

Non-goal: reducing per-step trace size (delta / changed-heap encoding). That is
the only true *scaling* fix but is a large architectural change touching the
frontend decode pipeline. Noted for the future; out of scope here.

## Fix 1 — Hard global raise of the coupled budget

Decision: raise the defaults everywhere (single profile). Accepted trade-off:
the shared / ghcr-published image inherits ~90 s worst-case wall and ~128 MB
traces, with higher memory pressure. The operator owns the deployment and
accepts this.

Sized to fit the measured 24,043 steps / 90.8 MB / 46.6 s local with margin:

| Constant | Location | 3,500-era value | New value |
|---|---|---|---|
| `MAX_STEPS` | `tracer/opt-cpp-backend/valgrind-3.11.0/memcheck/mc_translate.c:52` | 3500 | **30000** |
| `VGTRACE_BYTE_BUDGET` | `step_limits.py:36` | 30 MB | **128 MB** |
| `VALGRIND_WALL_SECONDS` | `step_limits.py:37` | 35 | **90** |
| backend request timeout | `tracer_service.py:107` (`run_trace` default) | 60 | **120** |
| docker container memory | `tracer_service.py:19` (`--memory=256m`) | 256m | **2g** |
| `RLIMIT_CPU_SECONDS` | `local_tracer.py:17` | 55 | **115** (below the 120 s wrapper) |
| `DISPLAY_CAP` | `step_limits.py:16` | 2000 | unchanged (294 ≪ 2000) |
| `RLIMIT_AS_BYTES` | `local_tracer.py:18` | 4 GB | unchanged (adequate) |

The `MAX_STEPS` source comment in `mc_translate.c` and the budget-rationale
comment block in `step_limits.py` must be updated to the new sizing and its
local ~47 s / prod ~350 s basis, so the numbers stay self-documenting.

`MAX_STEPS` lives in the Valgrind C source, so this forces a tracer image
rebuild (slow Valgrind layer) and `docker rm -f cpp-tutor-tracer-warm`
afterward, per CLAUDE.md.

### Fix 1 verification

- Rebuild tracer image; run the surround-regions board end to end.
- Assert: final point `event == "return"`, `"After"` present in final stdout,
  rendered steps ≈ 294, no `instruction_limit_reached` / `infinite_loop_detected`.
- Confirm wall stays within the raised local budget.

## Fix 2 — Non-trivial-period guard (Approach A)

Keep the foundations (`max_steps_exceeded`-gated; key on final state). Before
declaring an infinite loop, require the recurrence to enclose a **real loop
body**, so a degenerate / empty-body repeat cannot trigger it.

### Rule

Let `F` be the final captured state's fingerprint and `j` the index of its
nearest earlier occurrence (the current `_loop_cut_index` behavior finds the
2nd occurrence from the front; the guard applies to the pair actually used to
cut). Declare an infinite loop only when **either**:

- **Real body:** at least one state strictly between the two sightings of `F`
  has a fingerprint ≠ `F` (the loop did observable work between repeats); **or**
- **Genuine spin:** `F` occurs in a run of ≥ `SPIN_RUN` (e.g. 8) consecutive
  identical states (a real `while(true);`-style spin, cut mid-spin).

Otherwise — a short run of identical consecutive states (≤ `SPIN_RUN`) with the
program otherwise progressing — classify as **too long**
(`instruction_limit_reached`), not a loop.

Rationale for the two-pronged rule:
- The **real-body** prong preserves every existing loop test: `[pt5,pt6,pt5]`
  has `pt6` (≠ `F`) between the two `pt5` sightings; `[pt1,A,B,A,B]` has `A`
  between the two `B` sightings.
- The **spin** prong preserves detection of single-line infinite loops, which
  otherwise have no distinct intermediate state. A real spin at `MAX_STEPS`
  produces thousands of identical consecutive records, far above `SPIN_RUN`, so
  the threshold is safe.
- The DFS bug: `F` at 112, nearest prior at 111 (adjacent), empty body, run
  length 2 < `SPIN_RUN` → correctly classified too long, **not** a loop.

### Contract preservation (existing tests, all must stay green)

- `test_state_cycle_flagged_as_infinite_loop` — real body (`pt6`) → loop ✓
- `test_infinite_loop_flagged_when_final_state_recurs` — real body (`A`) → loop ✓
- `test_stdout_excluded_from_fingerprint` — real body → loop ✓
- `test_early_call_then_step_line_repeat_is_not_a_loop` — final state novel → not loop ✓ (unchanged path)
- `test_mid_trace_state_repeat_is_not_a_loop_when_final_state_novel` — final state novel → not loop ✓
- `test_long_not_stuck_gets_budget_message`, `test_display_ceiling_truncates`,
  `test_cycle_beyond_display_cap_is_instruction_limit`,
  `test_no_false_positive_on_distinct_states`,
  `test_state_repeat_not_flagged_when_terminated_within_budget`,
  `test_terminating_trace_is_unchanged`, `test_empty_list_returned_as_is` — unaffected.

### New tests (TDD, write first, watch fail)

1. `test_adjacent_duplicate_final_state_is_not_a_loop` — the DFS shape:
   `[...distinct..., pt(6,S), pt(6,S)]` (final state == its immediate
   predecessor, empty body) with `max_steps_exceeded=True` →
   `instruction_limit_reached`, **not** `infinite_loop_detected`.
2. `test_short_run_duplicate_final_state_is_not_a_loop` — a 2–3 long identical
   run below `SPIN_RUN`, program otherwise progressing → too long.
3. `test_single_line_spin_flagged_as_infinite_loop` — ≥ `SPIN_RUN` identical
   consecutive states (`while(true);`) → `infinite_loop_detected`.

### Fix 2 implementation site

`tracer/opt-cpp-backend/step_limits.py`, inside/around `_loop_cut_index` (and
its use in `apply_step_limits`). Add `SPIN_RUN` constant. Keep the module
Python 2/3 compatible (imported under Python 2 in-container, unit-tested under
Python 3) — ASCII only, no Py3-only syntax.

### Fix 2 verification

- `python3 test_step_limits.py` — all existing + 3 new tests pass.
- End-to-end: the surround-regions board (post Fix 1) ends with `return`, no
  loop label. Independently, a genuine `while(true){}` still yields
  `infinite_loop_detected`.

## Interaction between the fixes

Fix 1 alone would let this board finish, sidestepping the mislabel *for this
input* — but any program that still exhausts the (raised) budget would hit the
same false positive. Fix 2 is required independently so the classifier is
correct regardless of where the cap lands. Ship both.

## Rollout

1. Fix 2 first (pure Python, fast TDD loop, no image rebuild).
2. Fix 1 constants; rebuild tracer image; `docker rm -f cpp-tutor-tracer-warm`.
3. End-to-end verify the board on the running stack.
