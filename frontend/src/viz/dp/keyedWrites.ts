import type { ExecPoint } from "../../types/trace";
import { memoryAt, type NormalizedCell, type NormalizedMemory } from "../memoryModel";
import { allRoots } from "../cells";
import type { FrameIdentity } from "../callTree";
import { statementAtExecLine } from "./statements";
import { countSubscripts } from "./readSet";
import { keyedRead, selfRefBeforeWrite, type TrackedTable } from "./writes";

/** Ordered key list plus per-key writes for one memo container. */
export interface KeyedTrack extends TrackedTable {
  keyed: true;
  /** Keys in first-write order; a key's index here is its coord in the
   *  fallback (non-integer-key) projection. */
  keyOrder: string[];
}

/** Decoded map container → key string → value string. Children are the
 *  registry's recovered `pair` payloads (relabeled `key`/`value` by
 *  `nodeChain.ts`'s `relabelEntry`); anything without both scalars is
 *  skipped rather than guessed at. */
export function projectPairs(cell: NormalizedCell): Map<string, string> {
  const out = new Map<string, string>();
  for (const kid of cell.children ?? []) {
    if (kid.containerKind !== "pair") continue;
    const [k, v] = kid.children ?? [];
    if (!k || !v) continue;
    out.set(k.displayValue, v.displayValue);
  }
  return out;
}

const isMemoMap = (c: NormalizedCell) =>
  c.containerKind === "map" || c.containerKind === "unordered_map";

/** Whole-trace write collection for map/unordered_map memos, diffed BY KEY.
 *  Decoded map children are positional (`…-memo-0-first`) and shift on insert
 *  and rehash, so the array path's id-based diffing (`collectWrites`) would
 *  report a burst of phantom writes every time the table grows. Diffing the
 *  key -> value projection instead sidesteps that entirely.
 *
 *  Takes `codeLines` and `statements` (same convention as `collectWrites`):
 *  `statementAtExecLine` needs the raw per-line source to walk bracket depth
 *  backward from an exec line, which a pre-joined multi-line statement entry
 *  can't reconstruct.
 *
 *  Pure: no React, no DOM. */
export function collectKeyedWrites(
  trace: ExecPoint[], codeLines: string[], statements: string[],
): Map<string, KeyedTrack> {
  const tracked = new Map<string, KeyedTrack>();
  // Last known value per (cellId, key), carried across the WHOLE trace —
  // mirrors collectWrites' `lastValue` for array leaves. This is load-bearing
  // for map/unordered_map specifically: `operator[]` on the LHS of
  // `memo[n] = expr;` inserts the key with its type's default value (0 for
  // int) BEFORE `expr` is evaluated, so a recursive RHS (e.g. `fib(n-1) +
  // fib(n-2)`) makes that default-valued entry observable for many
  // intervening steps before the real assignment lands. Diffing "now" against
  // only the immediately preceding step would report that insert AND the
  // later real assignment as two separate writes; diffing against the last
  // value ever observed for that key still catches the insert as a
  // materialization (prevVal undefined) and the later assignment as the one
  // real write.
  const lastValue = new Map<string, string>();

  trace.forEach((point, step) => {
    for (const cell of mapCells(memoryAt(point))) {
      const now = projectPairs(cell);

      const written: string[] = [];
      for (const [key, value] of now) {
        const compositeId = `${cell.id}::${key}`;
        const prevVal = lastValue.get(compositeId);
        lastValue.set(compositeId, value);
        if (prevVal === undefined) continue; // key materializing, not a write
        if (prevVal === value) continue;
        written.push(key);
      }
      if (written.length === 0) continue;

      let t = tracked.get(cell.id);
      if (!t) {
        t = { cellId: cell.id, name: cell.name, maxDims: [], writes: [],
              writeSteps: new Set(), selfRefSteps: new Set(), writeDepths: new Set(),
              writeFuncs: new Set(), keyed: true, keyOrder: [] };
        tracked.set(cell.id, t);
      }
      for (const key of written) {
        if (!t.keyOrder.includes(key)) t.keyOrder.push(key);
        t.writes.push({ step, coord: [t.keyOrder.indexOf(key)] });
      }
      t.maxDims = [t.keyOrder.length];
      t.writeSteps.add(step);

      // Same attribution as collectWrites: the write is visible at `step`,
      // but the line that performed it is the previous point's line.
      const writeIdx = step - 1;
      const writeLine = trace[writeIdx]?.line ?? point.line;
      const writeText = statementAtExecLine(codeLines, statements, writeLine);
      // Same floor as the array path (writes.ts): the WRITE STATEMENT itself
      // is evidence of self-reference only when it subscripts the table at
      // least TWICE — once as the assignment target plus at least one read.
      // Using the one-subscript `keyedRead` here would be vacuous: a map
      // write is always `memo[k] = ...` / `memo[k]++`, exactly one subscript,
      // so every written map would score selfRefSteps === writeSteps and the
      // thresholds in detect.ts would discriminate nothing (a plain
      // `freq[v[i]]++` frequency counter rendered as a DP table — see the
      // map-counter fixture). `keyedRead` still belongs on the PRIOR-
      // statement replay below, where `.count(`/`.find(` memo guards live.
      if (countSubscripts(writeText, cell.name) >= 2
          || selfRefBeforeWrite(trace, writeIdx, codeLines, statements, cell.name, keyedRead)) {
        t.selfRefSteps.add(step);
      }
      const prev = trace[writeIdx] ?? point;
      const frames = (prev.stack_to_render ?? []) as FrameIdentity[];
      t.writeDepths.add(frames.length);
      const top = frames.at(-1);
      if (top?.func_name) t.writeFuncs.add(top.func_name);
    }
  });
  return tracked;
}

function mapCells(mem: NormalizedMemory): NormalizedCell[] {
  const out: NormalizedCell[] = [];
  const visit = (c: NormalizedCell) => {
    if (isMemoMap(c)) { out.push(c); return; }
    c.children?.forEach(visit);
  };
  allRoots(mem).forEach(visit);
  return out;
}
