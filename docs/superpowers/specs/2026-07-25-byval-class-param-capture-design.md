# By-value class parameter capture (tracer)

**Date:** 2026-07-25
**Status:** Approved, pending implementation

## Problem

By-value non-trivially-copyable parameters — `std::string`, `std::vector<T>`,
any user class passed by value — are **completely absent** from a frame's
`encoded_locals`. Trivial params (`int`, pointers, references) are captured.

Observed on the "generate parentheses" program: the `string intermediate`
parameter never appears in any `helper` frame (only `close, n, open, res`),
so the UI can only ever show the empty copy living in `generateParanthesis`.

Minimal reproduction:

```cpp
void f(string s, int x){ int y = s.length() + x; (void)y; }
```

`f`'s locals emit as `x`, then `x, y` — `s` is never present.

## Root cause

The Itanium C++ ABI passes non-trivially-copyable types **by invisible
reference**: the caller constructs the object and passes a pointer. GCC (4.8,
`-O0 -gdwarf-2`) describes such a parameter's DWARF location as:

```
DW_AT_location: DW_OP_fbreg K; DW_OP_deref
```

i.e. "at frame-base + K there is a pointer; dereference it to reach the object."
Trivial locals get a plain `DW_OP_fbreg K` (no deref).

`analyse_deps` (`coregrind/m_debuginfo/debuginfo.c`) decides whether a variable
is a stack local by evaluating its location expression under **fake probe
registers** (sp = 6144 / 7168, fp = 0) and inspecting the derivative w.r.t.
sp/fp. The trailing `DW_OP_deref` reads client memory at the bogus probe
address (~6120), `VG_(am_is_valid_for_client)` returns False, and
`evaluate_Dwarf3_Expr` returns `GXR_Failure`. Because the result kind is not
`GXR_Addr`, the `if (res_sp_6k.kind == GXR_Addr)` block is skipped: **no
`StackBlock` is produced, so the variable is dropped** before any value is read.
All four probes fail identically, so the kind-equality asserts hold and there is
no crash — just a silently missing variable.

Python post-processing cannot recover this: the data never reaches the vgtrace.
The fix must live in the valgrind C layer.

## Fix

One patch file, `tracer/cpp-byval-param-capture.patch`, applied in the
`Dockerfile` after Fix 5 (matching the Fix 4 / Fix 5 convention). Three
coordinated edits.

### 1. `coregrind/m_debuginfo/d3basics.c` — elide a trailing deref on demand

Add a `Bool elide_final_deref` parameter to `ML_(evaluate_Dwarf3_Expr)`. When
set and a `DW_OP_deref` opcode is the **final** operation in the expression
(`expr == limit` immediately after the opcode byte is read), skip the memory
read and leave the just-popped address on the stack — i.e. yield the pointer
slot address instead of the pointed-to value.

Thread the flag through `ML_(evaluate_GX)` so loclist / ip-range handling is
preserved. Every existing caller passes `False`, so behavior is unchanged for
all current expressions.

### 2. `coregrind/m_debuginfo/debuginfo.c` — recognize the idiom in `analyse_deps`

Run the existing 4-probe classification normally. If it yields `GXR_Failure`,
re-run the four probes with `elide_final_deref = True`. If the elided evaluation
now yields `GXR_Addr` with a valid sp/fp derivative (delta of 0 or 1024, exactly
as today), emit the `StackBlock` with the new field `indirect = True`. In that
case `block.base` is the frame-relative offset of the **pointer slot**, not the
object.

Non-indirect variables continue through the unchanged path with
`indirect = False`.

### 3. `include/pub_tool_debuginfo.h` + `memcheck/mc_translate.c` — honor `indirect`

Add `Bool indirect;` to the `StackBlock` struct.

At the runtime emission site (`mc_translate.c`, currently line 6475):

```c
Addr var_addr = sb->spRel ? cur_sp + sb->base : cur_fp + sb->base;
if (sb->indirect) {
   if (!VG_(am_is_valid_for_client)(var_addr, sizeof(Addr), VKI_PROT_READ))
      continue;                 // unreadable slot → skip, same as dropping today
   var_addr = *(Addr*)var_addr; // real registers/memory here → deref succeeds
}
```

`cur_sp` / `cur_fp` are the real registers and client memory is valid at this
point, so the deref recovers the true object address. The `ordered_varnames`
loop and the value-emission call both read the same `StackBlock`, so they light
up with no further change.

## Correctness

- Runtime deref is guarded by `VG_(am_is_valid_for_client)`, mirroring the
  existing `DW_OP_deref` case in `evaluate_Dwarf3_Expr`. An unreadable or
  uninitialized slot skips the variable rather than crashing — the same
  end-state as today (variable absent), never worse.
- The elide flag is used **only** for static classification in `analyse_deps`.
  Runtime value reads use the real deref, never the elided path.
- Scope of the pattern is narrow and well-defined: `fbreg K; deref` is GCC's
  encoding for by-invisible-reference by-value class params. C++ `T&`
  references use a different encoding (location IS the pointer, no trailing
  deref, `reference_type`) and already work — they are untouched.

## Testing

- **Tracer regression test.** Add a golden/trace test (in the tracer test
  suite: `tests/golden_test.py` / `tests/run_test_from_scratch.py`) driving a
  `void f(string s, int x)` program and asserting `s` appears in `f`'s `locals`
  with the correct string content, across the relevant steps.
- **Manual end-to-end.** Re-trace the "generate parentheses" program; confirm
  `intermediate` now appears in `helper` frames with values `"("`, `"(("`,
  `"((()))"`, etc.
- **Frontend fixtures.** Check whether any `frontend/tests/fixtures/` trace
  exercises a by-value class param (expected: none). Regenerate any that do
  rather than hand-editing.
- **No regressions.** Existing tracer golden tests and the full frontend suite
  must still pass; the `elide_final_deref = False` default guarantees no change
  to any currently-captured variable.

## Build / deploy

Touches core valgrind (`d3basics.c`, `debuginfo.c`, `pub_tool_debuginfo.h`,
`mc_translate.c`) → full valgrind recompile (the slow Docker layer), one-time.
After `docker build -t cpp-tutor-tracer:dev tracer/`, run
`docker rm -f cpp-tutor-tracer-warm` so the backend stops serving the old image.

## Risks to validate during implementation

- Confirm the `StackBlock` used by `analyse_deps` is the single struct in
  `pub_tool_debuginfo.h` and not a private duplicate that would also need the
  `indirect` field.
- Confirm that under `-O0` the by-value param's location is a simple block (the
  DWARF dump showed a 3-byte simple block) and not a loclist; if a loclist ever
  appears, the `elide_final_deref` threading through `evaluate_GX` already
  covers it.
