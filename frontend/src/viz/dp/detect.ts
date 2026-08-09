import type { ExecPoint } from "../../types/trace";
import { buildStatements } from "./statements";
import { collectWrites, type TrackedTable, type DpWrite } from "./writes";
import { collectKeyedWrites, type KeyedTrack } from "./keyedWrites";
import { projectKeys, type KeyedProjection } from "./keyedTable";

export type { DpWrite };

export interface DpCandidate {
  cellId: string;
  name: string;
  dims: number[];
  mode: "bottom-up" | "top-down";
  writes: DpWrite[];
  /** Present only for map/unordered_map memo tables. */
  keyed?: { projection: KeyedProjection; keyOrder: string[] };
}

export const MIN_WRITE_STEPS = 2;
export const MIN_SELF_REF_STEPS = 1;

/** The whole-trace tracked-table map, for callers that need both auto-detected
 *  candidates and manual promotion from one scan. Memoize at the call site.
 *  Merges array/vector writes (`writes.ts`) with map/unordered_map keyed
 *  writes (`keyedWrites.ts`) into one id -> table map. */
export function collectTables(trace: ExecPoint[], code: string): Map<string, TrackedTable> {
  const codeLines = code.split("\n");
  const statements = buildStatements(codeLines);
  const tables = collectWrites(trace, codeLines, statements);
  for (const [id, keyed] of collectKeyedWrites(trace, codeLines, statements)) tables.set(id, keyed);
  return tables;
}

/** Whole-trace DP table detection. Sticky: run once per trace (memoize at the
 *  call site) and apply the result at every step. Never lies — anything not
 *  matching a rule cleanly is simply not returned. Pure, no React/DOM. */
export function detectDpTables(trace: ExecPoint[], code: string): DpCandidate[] {
  const tracked = collectTables(trace, code);

  const out: DpCandidate[] = [];
  for (const t of tracked.values()) {
    const c = scoreCandidate(t);
    if (c) out.push(c);
  }
  return out;
}

/** A candidate for any tracked cell id, bypassing the detection thresholds.
 *  This is the user saying "this IS a DP table" — detection is a default, not
 *  a gate. Returns null only when the id was never written during the trace,
 *  which means there is nothing to render. */
export function promoteToDp(
  tracked: Map<string, TrackedTable>, cellId: string,
): DpCandidate | null {
  const t = tracked.get(cellId);
  if (!t || t.writes.length === 0) return null;
  const mode = classify(t) ?? "bottom-up";
  if (isKeyedTrack(t)) return keyedCandidate(t, mode);
  return {
    cellId: t.cellId, name: t.name, dims: t.maxDims,
    mode, writes: t.writes,
  };
}

/** Score one tracked table into a candidate, or null when it is not a DP
 *  table. Shared by auto-detection and manual promote (which bypasses the
 *  thresholds but reuses the mode classification). */
export function scoreCandidate(t: TrackedTable): DpCandidate | null {
  // Counting evidence does not separate DP tables from ordinary arrays —
  // CONTROL DEPENDENCE does, and that judgement already happened when
  // `selfRefSteps` was populated. Every non-DP program in the fixture set
  // scores exactly zero self-referential writes (input-fill's `a`,
  // longest-palindrome-expand's `positionsOdd`/`positionsEven`, map-counter's
  // `freq`, knapsack-stub, house-robber-ii), so count and ratio floors reject
  // nothing real — they only punish small inputs, which is what these
  // problems are actually run on:
  //   minCostStairs on {10,15,20}: 2 writes, BOTH self-referential, was
  //     rejected by a floor of 3 writes.
  //   countSubstrings on "aaa": 6 writes, 1 self-referential, because a
  //     3-character string contains exactly one length-3 substring to recurse
  //     on. A one-third ratio rejected it.
  // So: at least one control-dependent write, and more than a single write
  // overall. A consequence worth naming — an in-place algorithm that tests an
  // array in a loop condition and writes it in the body (insertion sort's
  // `while (arr[j] > key) arr[j+1] = arr[j];`) now scores as a table. The raw
  // chip demotes it in one click, which is the cheaper failure.
  if (t.writeSteps.size < MIN_WRITE_STEPS) return null;
  if (t.selfRefSteps.size < MIN_SELF_REF_STEPS) return null;
  const mode = classify(t);
  if (!mode) return null;
  if (isKeyedTrack(t)) return keyedCandidate(t, mode);
  return { cellId: t.cellId, name: t.name, dims: t.maxDims, mode, writes: t.writes };
}

function isKeyedTrack(t: TrackedTable): t is KeyedTrack {
  return t.keyed === true;
}

/** Project a keyed (map/unordered_map) track's key set onto a grid, and
 *  remap every write's coord (an insertion-order index into `keyOrder`) to
 *  the projection's coord for that key, so the rest of the DP pipeline
 *  (buildDpView etc.) never has to know a table came from a map. */
function keyedCandidate(t: KeyedTrack, mode: DpCandidate["mode"]): DpCandidate {
  const projection = projectKeys(t.keyOrder);
  const writes = t.writes.map((w) => ({
    step: w.step,
    coord: projection.coordOfKey.get(t.keyOrder[w.coord[0]]) ?? w.coord,
  }));
  return { cellId: t.cellId, name: t.name, dims: projection.dims, mode, writes,
           keyed: { projection, keyOrder: t.keyOrder } };
}

/** Bottom-up vs top-down is a question about the SHAPE OF THE STACK at the
 *  writes, not about where the writes sit in the source: one frame depth
 *  throughout = an iterative fill; several depths in one recursive function =
 *  memoization. Source distance between write lines is deliberately not
 *  consulted — textbook 2D DP writes its base cases in separate loops well
 *  above the recurrence (edit distance: lines 8, 9 then 12, 13), and any
 *  line-span cutoff rejects exactly those. Requiring a single writing function
 *  is what keeps a global array poked at from unrelated places out. */
function classify(t: TrackedTable): DpCandidate["mode"] | null {
  // ONE RECURRENCE SITE, not one writer. Requiring `writeFuncs.size === 1`
  // rejected the dominant top-down shape in Striver's sheet, where the driver
  // seeds base cases and the memoized helper holds the recurrence:
  //   uniquePaths: `dp[m-1][n-1] = 0;` in uniquePaths, `dp[i][j] = dfs(...)`
  //     in dfs — 18 writes, 17 of them self-referential, still rejected.
  //   tribonacci: `dp[0..2]` seeded in tribonacci, recurrence in helper.
  // Base-case seeding may come from anywhere; the recurrence may not. The
  // guard this replaces was meant to keep a global poked at from unrelated
  // functions out, and that case is still rejected — such a global has no
  // self-referential writes at all, so it never clears MIN_SELF_REF_STEPS.
  if (t.selfRefFuncs.size !== 1) return null;
  return t.writeDepths.size === 1 ? "bottom-up" : "top-down";
}
