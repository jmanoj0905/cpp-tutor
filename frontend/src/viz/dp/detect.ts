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

export const MIN_WRITE_STEPS = 3;
export const MIN_SELF_REF_STEPS = 2;

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
  if (t.writeSteps.size < MIN_WRITE_STEPS) return null;
  // Base cases are never self-referential and dominate at small n
  // (house-robber on {1,2,3}: 4 writes, 2 self-referential), so a strict
  // majority rejects real tables on the tiny inputs these problems run on.
  if (t.selfRefSteps.size < MIN_SELF_REF_STEPS) return null;
  if (t.selfRefSteps.size * 3 < t.writeSteps.size) return null;
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
  if (t.writeFuncs.size !== 1) return null;
  return t.writeDepths.size === 1 ? "bottom-up" : "top-down";
}
