# By-value class parameter capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tracer capture by-value non-trivially-copyable parameters (`std::string`, `std::vector<T>`, user classes) that GCC passes by invisible reference and currently drops from every frame's locals.

**Architecture:** GCC encodes such a param's DWARF location as `DW_OP_fbreg K; DW_OP_deref`. Valgrind's `analyse_deps` classifies stack locals by evaluating the location under fake probe registers; the trailing `DW_OP_deref` reads unmapped probe memory, fails, and the variable is silently dropped. Fix: teach the location evaluator to optionally elide a *final* `DW_OP_deref` (yielding the pointer-slot address) so `analyse_deps` can classify the slot and mark the block `indirect`; at runtime, dereference the slot with real registers to reach the object. Packaged as one Dockerfile-applied patch, matching the existing Fix 4 / Fix 5 convention.

**Tech Stack:** C (Valgrind 3.11.0 fork in `tracer/opt-cpp-backend` submodule), Docker, Python (backend `pytest` with a `docker` marker), TypeScript/vitest (frontend fixtures).

## Global Constraints

- Valgrind types only in C edits: `Bool`, `True`, `False`, `Addr`, `UWord`, `VG_(...)`, `ML_(...)` — no libc.
- The fix ships as `tracer/cpp-byval-param-capture.patch`, applied in `tracer/Dockerfile` **after** the Fix 5 patch step. The submodule source tree must remain the patch's pristine baseline (generate the patch, then revert the working-tree edits).
- The patch touches only `debuginfo.c`, `d3basics.c`, `priv_d3basics.h`, `pub_tool_debuginfo.h`, `mc_translate.c` — none overlap Fix 4 / Fix 5 (which touch `readdwarf3.c`, `tytypes.c`).
- `ML_(evaluate_Dwarf3_Expr)` / `ML_(evaluate_GX)` signatures must NOT change — every currently-captured variable must trace identically. The elide behavior is gated behind a file-static toggle that is off by default and set only during the `analyse_deps` retry.
- After any change under `tracer/`, rebuild the image and reap the warm container:
  `docker build -t cpp-tutor-tracer:dev tracer/` then `docker rm -f cpp-tutor-tracer-warm`.
- Backend `pytest` must run from `backend/` (cwd import of `app`).
- No new frontend dependencies.

---

## File map

- `backend/tests/test_tracer_service.py` — add one `@pytest.mark.docker` regression test (Task 1).
- `tracer/opt-cpp-backend/valgrind-3.11.0/include/pub_tool_debuginfo.h` — add `Bool indirect;` to `StackBlock` (Task 2).
- `tracer/opt-cpp-backend/valgrind-3.11.0/coregrind/m_debuginfo/priv_d3basics.h` — declare the elide setter (Task 2).
- `tracer/opt-cpp-backend/valgrind-3.11.0/coregrind/m_debuginfo/d3basics.c` — file-static toggle, setter, elide a final `DW_OP_deref` (Task 2).
- `tracer/opt-cpp-backend/valgrind-3.11.0/coregrind/m_debuginfo/debuginfo.c` — `analyse_deps` retry + `indirect` flag (Task 2).
- `tracer/opt-cpp-backend/valgrind-3.11.0/memcheck/mc_translate.c` — runtime indirect deref (Task 2).
- `tracer/cpp-byval-param-capture.patch` — generated diff of the five source files (Task 2).
- `tracer/Dockerfile` — apply the new patch after Fix 5 (Task 2).

---

### Task 1: Failing regression test (backend, Docker)

**Files:**
- Modify: `backend/tests/test_tracer_service.py` (append at end)

**Interfaces:**
- Consumes: `run_trace(code: str, lang: str) -> Trace | CompileError` from `app.tracer_service`; `Trace.trace` is a `list[ExecPoint]`; each `ExecPoint.stack_to_render` is a `list` of raw frame dicts with keys `func_name`, `encoded_locals` (dict name→encoded value), `ordered_varnames`.
- Produces: `test_byval_class_param_is_captured` (docker-marked). Later tasks make it pass.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_tracer_service.py`:

```python
BYVAL_STRING_PARAM_CODE = """\
#include <string>
using namespace std;
int f(string s, int x) {
    return (int)s.length() + x;
}
int main() {
    string a = "abcdef";
    return f(a, 3);
}
"""


@pytest.mark.docker
def test_byval_class_param_is_captured():
    """A by-value std::string parameter is passed by invisible reference
    (DW_OP_fbreg; DW_OP_deref). The tracer must still surface it in the
    callee frame's locals with its real contents, not drop it."""
    result = run_trace(BYVAL_STRING_PARAM_CODE, "cpp")
    assert isinstance(result, Trace)

    # Find any step whose top frame is f, and collect f's local names.
    saw_f = False
    saw_s_with_content = False
    for pt in result.trace:
        for frame in pt.stack_to_render:
            if not isinstance(frame, dict):
                continue
            if not frame.get("func_name", "").startswith("f"):
                continue
            saw_f = True
            locals_ = frame.get("encoded_locals", {})
            if "s" not in locals_:
                continue
            # s decodes as a std::string C_STRUCT; its char buffer holds
            # "abcdef". Assert the bytes are reachable somewhere in the trace.
            import json
            blob = json.dumps([pt.heap, locals_["s"]])
            # 'a','b',... appear as char codes 97.. or glyphs; check the
            # buffer length header (6) plus at least one char code is present.
            if "97" in blob and "98" in blob:
                saw_s_with_content = True

    assert saw_f, "no frame for function f appeared in the trace"
    assert "s" in _all_f_local_names(result), \
        "by-value string param 's' missing from f's locals"
    assert saw_s_with_content, \
        "param 's' present but its 'abcdef' contents were not recoverable"


def _all_f_local_names(result):
    names = set()
    for pt in result.trace:
        for frame in pt.stack_to_render:
            if isinstance(frame, dict) and frame.get("func_name", "").startswith("f"):
                names |= set(frame.get("encoded_locals", {}).keys())
    return names
```

- [ ] **Step 2: Run the test; confirm it FAILS against the current image**

Run (from `backend/`, requires the current `cpp-tutor-tracer:dev` image built):
```bash
cd backend && .venv/bin/pytest tests/test_tracer_service.py::test_byval_class_param_is_captured -v
```
Expected: FAIL — assertion `by-value string param 's' missing from f's locals` (the current tracer drops `s`).

- [ ] **Step 3: Commit the failing test**

```bash
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor
git add backend/tests/test_tracer_service.py
git commit -m "test(tracer): failing regression for by-value class param capture"
```

---

### Task 2: Implement the fix and package as a Dockerfile patch

**Files:**
- Modify (submodule, then revert after generating patch):
  - `.../include/pub_tool_debuginfo.h`
  - `.../coregrind/m_debuginfo/priv_d3basics.h`
  - `.../coregrind/m_debuginfo/d3basics.c`
  - `.../coregrind/m_debuginfo/debuginfo.c`
  - `.../memcheck/mc_translate.c`
- Create: `tracer/cpp-byval-param-capture.patch`
- Modify: `tracer/Dockerfile`

**Interfaces:**
- Consumes: `StackBlock` (in `pub_tool_debuginfo.h`), `ML_(evaluate_GX)`, `ML_(evaluate_Dwarf3_Expr)`, `analyse_deps` (in `debuginfo.c`), the stack-block emission loop (in `mc_translate.c` near line 6475).
- Produces: `StackBlock.indirect` (Bool); file-static toggle `td_elide_final_deref` with setter `void ML_(set_elide_final_deref)(Bool)`; runtime indirect deref at the emission site.

All edits are made against submodule HEAD `9d40098`. Base directory for the paths below:
`tracer/opt-cpp-backend/valgrind-3.11.0/`.

- [ ] **Step 1: Add the `indirect` field to `StackBlock`**

In `include/pub_tool_debuginfo.h`, the `StackBlock` struct (currently ~lines 185-194) — add one field:

```c
typedef
   struct {
      PtrdiffT base;       /* offset from sp or fp */
      SizeT    szB;        /* size in bytes */
      Bool     spRel;      /* True => sp-rel, False => fp-rel */
      Bool     isVec;      /* does block have an array type, or not? */
      Bool     indirect;   /* pgbovine: base points to a POINTER to the object
                              (by-invisible-reference by-value class param) */
      HChar    name[16];   /* first 15 chars of name (asciiz) */
      const HChar* fullname; // pgbovine - full variable name
   }
   StackBlock;
```

- [ ] **Step 2: Declare the elide setter in `priv_d3basics.h`**

In `coregrind/m_debuginfo/priv_d3basics.h`, near the `ML_(evaluate_GX)` / `ML_(evaluate_Dwarf3_Expr)` declarations (~line 662-672), add:

```c
/* pgbovine: when set True, ML_(evaluate_Dwarf3_Expr) treats a DW_OP_deref
   that is the FINAL opcode of an expression as a no-op (leaving the address
   on the stack) instead of reading client memory. Used only by analyse_deps
   to classify by-invisible-reference by-value class params, whose location is
   `DW_OP_fbreg K; DW_OP_deref`. Off by default; must be reset to False by the
   caller immediately after use. */
void ML_(set_elide_final_deref) ( Bool b );
```

- [ ] **Step 3: Add the toggle, setter, and elide logic in `d3basics.c`**

In `coregrind/m_debuginfo/d3basics.c`:

(a) Above `ML_(evaluate_Dwarf3_Expr)` (before line ~481), add the file-static and setter:

```c
/* pgbovine: see priv_d3basics.h. Single-threaded debuginfo analysis, so a
   file-static toggle is safe; analyse_deps sets it True only around its
   retry probes and resets it to False immediately after. */
static Bool td_elide_final_deref = False;

void ML_(set_elide_final_deref) ( Bool b )
{
   td_elide_final_deref = b;
}
```

(b) In the `DW_OP_deref` case (currently ~line 678), add the elide short-circuit as the first lines of the case:

```c
         case DW_OP_deref:
            if (td_elide_final_deref && expr == limit) {
               /* Final deref elided: leave the pointer-slot address on the
                  stack as the expression's result. The outer loop sees
                  expr == limit next and returns top-of-stack. */
               break;
            }
            POP(uw1);
            if (VG_(am_is_valid_for_client)( (Addr)uw1, sizeof(Addr),
                                             VKI_PROT_READ )) {
               uw1 = ML_(read_UWord)((void *)uw1);
               PUSH(uw1);
            } else {
               FAIL("warning: evaluate_Dwarf3_Expr: DW_OP_deref: "
                    "address not valid for client");
            }
            break;
```

(Only the `if (td_elide_final_deref && expr == limit) { break; }` lines are new; the rest is unchanged.)

- [ ] **Step 4: Add the retry + `indirect` classification in `debuginfo.c` `analyse_deps`**

In `coregrind/m_debuginfo/debuginfo.c`, `analyse_deps` (currently ~lines 5382-5506). After the four existing probe evaluations and before the three `vg_assert(res_sp_6k.kind == ...)` asserts (~line 5446), insert the retry block; then set `block.indirect` in both add branches; then reset the toggle at the end.

Insert immediately after the `res_fp_7k = ML_(evaluate_GX)(...)` line (~5444):

```c
   /* pgbovine: by-invisible-reference by-value class params (std::string,
      std::vector, user classes) have location `DW_OP_fbreg K; DW_OP_deref`.
      The trailing deref reads the bogus probe address above and fails, so the
      four probes returned GXR_Failure and the variable would be dropped.
      Retry with the final deref elided: this classifies the POINTER SLOT
      (fbreg K), which is linear in sp/fp, and we record the block as
      indirect so the runtime reader derefs the slot to reach the object. */
   Bool indirect = False;
   if (res_sp_6k.kind != GXR_Addr) {
      ML_(set_elide_final_deref)( True );
      regs.fp = 0;        regs.ip = ip; regs.sp = 6 * 1024;
      res_sp_6k = ML_(evaluate_GX)( var->gexpr, var->fbGX, &regs, di );
      regs.fp = 0;        regs.ip = ip; regs.sp = 7 * 1024;
      res_sp_7k = ML_(evaluate_GX)( var->gexpr, var->fbGX, &regs, di );
      regs.fp = 6 * 1024; regs.ip = ip; regs.sp = 0;
      res_fp_6k = ML_(evaluate_GX)( var->gexpr, var->fbGX, &regs, di );
      regs.fp = 7 * 1024; regs.ip = ip; regs.sp = 0;
      res_fp_7k = ML_(evaluate_GX)( var->gexpr, var->fbGX, &regs, di );
      /* Leave the toggle ON: the base-extraction evaluate_GX calls below must
         also elide. It is reset to False at the end of this function. */
      indirect = True;
   }
```

In the `sp_delta == 1024 && fp_delta == 0` add branch, after `block.spRel = True;` (~line 5473) add:
```c
         block.indirect = indirect;
```
In the `sp_delta == 0 && fp_delta == 1024` add branch, after `block.spRel = False;` (~line 5493) add:
```c
         block.indirect = indirect;
```

Immediately before the closing brace of `analyse_deps` (after the outer `if (res_sp_6k.kind == GXR_Addr) { ... }` block, ~line 5505), add:
```c
   ML_(set_elide_final_deref)( False );
```

Note: the `sp_delta == 0 && fp_delta == 0` ("ignore") case and the `vg_assert(0)` case both leave `indirect` set; the trailing reset covers all paths that reach function end. The early `return`s above the probes (arrays_only / Te_UNKNOWN) run before the toggle is ever set, so they need no reset.

- [ ] **Step 5: Honor `indirect` at the runtime emission site in `mc_translate.c`**

In `memcheck/mc_translate.c`, the stack-block loop (currently ~line 6475). Replace:

```c
          StackBlock* sb = VG_(indexXA)(blocks, j);
          Addr var_addr = sb->spRel ? cur_sp + sb->base : cur_fp + sb->base;
```

with:

```c
          StackBlock* sb = VG_(indexXA)(blocks, j);
          Addr var_addr = sb->spRel ? cur_sp + sb->base : cur_fp + sb->base;
          if (sb->indirect) {
             /* pgbovine: base points to a pointer to the object (by-value
                class param passed by invisible reference). Deref with the
                real registers/memory to reach the object. */
             if (!VG_(am_is_valid_for_client)(var_addr, sizeof(Addr),
                                              VKI_PROT_READ)) {
                continue; /* slot unreadable → skip, as if the var were absent */
             }
             var_addr = *(Addr*)var_addr;
          }
```

Note: the `ordered_varnames` loop later in the same function reads `sb->fullname` only and needs no change; a skipped indirect var will list its name but emit no value, which the frontend already tolerates (the existing `<UNINITIALIZED>` path behaves the same way). If a mismatch surfaces during verification, guard the `ordered_varnames` append with the same `am_is_valid_for_client` check.

- [ ] **Step 6: Build the image with the in-tree edits; iterate until it compiles**

```bash
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor
docker build -t cpp-tutor-tracer:dev tracer/
```
Expected: builds clean. If the Valgrind compile errors, fix the offending edit and rebuild. (Valgrind is the slow layer — expect minutes per rebuild.)

- [ ] **Step 7: Sanity-check the fix before packaging**

```bash
docker rm -f cpp-tutor-tracer-warm
cd backend && .venv/bin/pytest tests/test_tracer_service.py::test_byval_class_param_is_captured -v
```
Expected: PASS.

- [ ] **Step 8: Generate the patch and restore the pristine submodule baseline**

The Dockerfile applies the patch onto the pristine COPY'd source, so the submodule tree must not contain these edits. Generate the diff, then revert:

```bash
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor/tracer/opt-cpp-backend
git diff -- \
  valgrind-3.11.0/include/pub_tool_debuginfo.h \
  valgrind-3.11.0/coregrind/m_debuginfo/priv_d3basics.h \
  valgrind-3.11.0/coregrind/m_debuginfo/d3basics.c \
  valgrind-3.11.0/coregrind/m_debuginfo/debuginfo.c \
  valgrind-3.11.0/memcheck/mc_translate.c \
  > ../cpp-byval-param-capture.patch
git checkout -- \
  valgrind-3.11.0/include/pub_tool_debuginfo.h \
  valgrind-3.11.0/coregrind/m_debuginfo/priv_d3basics.h \
  valgrind-3.11.0/coregrind/m_debuginfo/d3basics.c \
  valgrind-3.11.0/coregrind/m_debuginfo/debuginfo.c \
  valgrind-3.11.0/memcheck/mc_translate.c
```
Verify the patch is non-empty and mentions all five files:
```bash
grep -c '^+++ ' ../cpp-byval-param-capture.patch   # expect 5
```

- [ ] **Step 9: Wire the patch into the Dockerfile**

In `tracer/Dockerfile`, after the Fix 5 block (the `RUN cd /opt/tracer && patch -p1 < /tmp/cpp-stl-node-payload.patch` line, ~line 45) and before `WORKDIR /opt/tracer/valgrind-3.11.0` (~line 46), insert:

```dockerfile
# Fix 6: capture by-value non-trivially-copyable parameters (std::string,
#        std::vector, user classes). The Itanium ABI passes them by invisible
#        reference, so gcc emits their DWARF location as `DW_OP_fbreg K;
#        DW_OP_deref`. Valgrind's analyse_deps classifies stack locals by
#        evaluating the location under fake probe registers; the trailing
#        deref reads unmapped memory and fails, so the variable is dropped.
#        This patch lets analyse_deps elide a final deref to classify the
#        pointer slot (marking the block `indirect`), and derefs the slot at
#        runtime to reach the object.
COPY cpp-byval-param-capture.patch /tmp/cpp-byval-param-capture.patch
RUN cd /opt/tracer && patch -p1 < /tmp/cpp-byval-param-capture.patch
```

- [ ] **Step 10: Rebuild from the patch and confirm the regression test still passes**

```bash
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor
docker build -t cpp-tutor-tracer:dev tracer/ && docker rm -f cpp-tutor-tracer-warm
cd backend && .venv/bin/pytest tests/test_tracer_service.py::test_byval_class_param_is_captured -v
```
Expected: builds clean (patch applies), test PASSES. This proves the patch (not just the in-tree edits) delivers the fix.

- [ ] **Step 11: Commit the patch and Dockerfile**

```bash
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor
git add tracer/cpp-byval-param-capture.patch tracer/Dockerfile
git commit -m "fix(tracer): capture by-value class params passed by invisible reference

GCC encodes std::string/std::vector/user-class by-value params as
DW_OP_fbreg K; DW_OP_deref. analyse_deps classified stack locals by
probing the location under fake registers, where the trailing deref hit
unmapped memory and failed, dropping the variable. Elide a final deref
during classification, mark the block indirect, and deref the pointer
slot at runtime with real registers."
```

---

### Task 3: End-to-end verification and fixture check

**Files:**
- Possibly regenerate: `frontend/tests/fixtures/**` (only if any fixture exercises a by-value class param — expected: none)

**Interfaces:**
- Consumes: the rebuilt `cpp-tutor-tracer:dev` image from Task 2.

- [ ] **Step 1: Manually verify the original "generate parentheses" program**

Write the program to a temp file and trace it, then confirm `intermediate` now appears in `helper` frames with real content:

```bash
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor
cat > /tmp/paren.cpp <<'EOF'
#include <vector>
#include <string>
using namespace std;
void helper(vector<string> &res, string intermediate, int n, int open, int close){
    if (intermediate.length() == 2*n) { res.push_back(intermediate); return; }
    if (open < n)     helper(res, intermediate + '(', n, open + 1, close);
    if (open > close) helper(res, intermediate + ')', n, open, close + 1);
}
int main(){ vector<string> res; helper(res, string(), 3, 0, 0); return 0; }
EOF
CODE=$(cat /tmp/paren.cpp)
docker run --rm -i --net=none --cap-drop all --user=netuser --memory=2g --cpus=1 --pids-limit=128 \
  cpp-tutor-tracer:dev python /opt/tracer/run_cpp_backend.py "$CODE" cpp --jsondump \
  | python3 -c 'import sys,json; t=json.load(sys.stdin); \
print("helper frames with intermediate:", \
 sum(1 for p in t["trace"] for f in p["stack_to_render"] \
     if isinstance(f,dict) and f.get("func_name","").startswith("helper") \
     and "intermediate" in f.get("encoded_locals",{})))'
```
Expected: a non-zero count (previously zero). Spot-check that at a base-case step (`res.push_back`) a `helper` frame's `intermediate` decodes to a 6-char parenthesis string.

- [ ] **Step 2: Check whether any frontend fixture needs regenerating**

```bash
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor/frontend
grep -rl "encoded_locals" tests/fixtures | xargs grep -l "DW_OP_deref\|91 68 06" 2>/dev/null || echo "none reference the raw location; checking for by-value class params in callee frames is manual"
```
Fixtures are real backend traces. If none exercise a by-value class parameter (expected), no regeneration is needed. If one does and its committed values are now richer, regenerate it by re-tracing that fixture's source rather than hand-editing.

- [ ] **Step 3: Run the full backend and frontend suites**

```bash
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor/backend && .venv/bin/pytest -q
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor/frontend && npm test && npm run build && npm run lint
```
Expected: all pass. (Backend runs include the docker-marked tests since the image is built.)

- [ ] **Step 4: Commit any fixture regeneration (only if Step 2 required it)**

```bash
cd /Users/manojj/Documents/CSE-Projects/My-Projects/cpp-tutor
git add frontend/tests/fixtures
git commit -m "test(fixtures): regenerate traces affected by by-value param capture"
```
If Step 2 found nothing to regenerate, skip this commit.

---

## Self-Review notes

- **Spec coverage:** every spec section maps to a task — root-cause fix (Task 2, Steps 1-5), one patch file after Fix 5 (Task 2, Steps 8-9), correctness guards (Step 5's `am_is_valid_for_client`), tracer regression test (Task 1), manual paren verification (Task 3 Step 1), frontend fixture check (Task 3 Step 2), no-regression (Task 3 Step 3), build/deploy note (Task 2 Steps 6, 10).
- **Signatures unchanged:** `ML_(evaluate_Dwarf3_Expr)` and `ML_(evaluate_GX)` keep their signatures; elide is a file-static toggled only in the `analyse_deps` retry and reset before return — satisfies the Global Constraint.
- **Name consistency:** `td_elide_final_deref`, `ML_(set_elide_final_deref)`, `StackBlock.indirect` used identically across Steps 1-5.
