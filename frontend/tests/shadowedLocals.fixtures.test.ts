import { describe, expect, it } from "vitest";
import lcs2d from "./fixtures/dp/lcs-2d.json";
import { normalizeMemory } from "../src/viz/memoryModel";
import type { Trace } from "../src/types/trace";

/** lcs-2d.cpp declares `i`/`j` twice: once per nested for-loop, once at
 *  function scope for the traceback walk. Valgrind reports one DWARF lexical
 *  block at a time, so both declarations used to reach the trace -- as
 *  duplicate `locals` keys (last, i.e. outermost, won in json.loads) and as
 *  repeated `ordered_varnames` entries (one wrong cell rendered per repeat).
 *  See the _dup_aware_pairs hook in vg_to_opt_trace.py. */
const trace = (lcs2d as Trace).trace;

describe("shadowed locals (lcs-2d fixture)", () => {
  it("lists every local name at most once per frame", () => {
    for (const point of trace) {
      for (const frame of point.stack_to_render ?? []) {
        const names = frame.ordered_varnames ?? [];
        expect(new Set(names).size).toBe(names.length);
      }
    }
  });

  it("renders one cell per local name", () => {
    for (const point of trace) {
      for (const frame of normalizeMemory(point).frames) {
        const ids = frame.cells.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it("reports the innermost declaration's value inside the loops", () => {
    // Line 12 is the `dp[i][j] = 1+dp[i-1][j-1]` body of the inner loop, so
    // both counters are live and initialized there. The pre-fix trace showed
    // the function-scope pair instead, i.e. <UNINITIALIZED>.
    const bodies = trace.filter((p) => p.line === 12);
    expect(bodies.length).toBeGreaterThan(0);
    for (const point of bodies) {
      const frame = point.stack_to_render!.at(-1)!;
      for (const name of ["i", "j"]) {
        const value = (frame.encoded_locals[name] as unknown[])[3];
        expect(typeof value).toBe("number");
        expect(value).toBeGreaterThan(0);
      }
    }
  });
});
