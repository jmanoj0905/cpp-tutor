import type { ExecPoint } from "../../types/trace";
import { memoryAt, type NormalizedCell, type NormalizedMemory } from "../memoryModel";
import { countSubscripts, isAssignmentLhs, type Coord } from "./readSet";
import { escapeRe } from "../../util";
import { allRoots } from "../cells";
import { frameKey, type FrameIdentity } from "../callTree";
import { statementAtExecLine } from "./statements";

export interface DpWrite { step: number; coord: Coord; }

export interface TrackedTable {
  cellId: string;
  name: string;
  maxDims: number[];
  writes: DpWrite[];
  writeSteps: Set<number>;
  selfRefSteps: Set<number>;
  writeDepths: Set<number>;
  writeFuncs: Set<string>;
  /** true for map/unordered_map memos (Task 8) */
  keyed: boolean;
}

type StackFrameLike = FrameIdentity;

/** A read-detection predicate: given a candidate statement's text and the
 *  table's name, does the statement read the table in a way that counts as
 *  self-reference evidence? Shared between the array path (`subscriptRead`)
 *  and the map/unordered_map path (`keyedRead`, which additionally accepts
 *  `.count(`/`.find(` lookups) so `selfRefBeforeWrite` doesn't have to know
 *  which kind of table it's replaying for. */
export type ReadMatcher = (statementText: string, name: string) => boolean;

/** Array-path read evidence: at least one subscript of `name` on the line.
 *  Reproduces exactly the inline `countSubscripts(text, name) >= 1` check
 *  `selfRefBeforeWrite` used before the matcher was extracted. */
export const subscriptRead: ReadMatcher = (text, name) => countSubscripts(text, name) >= 1;

/** Map-path read evidence: a subscript read, OR a `name.count(...)` /
 *  `name.find(...)` lookup — the idiomatic memo-guard read for
 *  map/unordered_map that never subscripts the table at all
 *  (`if (memo.count(n)) return memo[n];`). */
export const keyedRead: ReadMatcher = (text, name) =>
  countSubscripts(text, name) >= 1
  || new RegExp(`\\b${escapeRe(name)}\\s*\\.(count|find)\\s*\\(`).test(text);

/** Whole-trace scan that tracks every array-like cell's writes across a
 *  trace, keyed by cell id. Shared by auto-detection and manual promote, so
 *  it lives independently of the scoring thresholds in detect.ts. Pure, no
 *  React/DOM.
 *
 *  Takes both `codeLines` (raw source, one entry per physical line) and
 *  `statements` (buildStatements(codeLines)) rather than just `statements`:
 *  statementAtExecLine needs the raw per-line text to walk bracket depth
 *  backward from an exec line, which a pre-joined multi-line statement
 *  entry can't reconstruct. */
export function collectWrites(trace: ExecPoint[], codeLines: string[], statements: string[]): Map<string, TrackedTable> {
  const tracked = new Map<string, TrackedTable>();
  // Last known displayValue per leaf id, carried across the WHOLE trace (not
  // just the immediately preceding step). Recursive traces can momentarily
  // drop a caller frame from `stack_to_render` mid-unwind (observed in the
  // climb-topdown fixture: `main` disappears for exactly one step while
  // `solve` finishes returning), which would make a naive step-to-step diff
  // (e.g. changedCellIds(prev, curr)) see every leaf as "newly appeared" once
  // the frame reappears — a false write burst with no real value change.
  // Diffing against the last value ever observed for that id sidesteps this.
  const lastValue = new Map<string, string>();

  trace.forEach((point, step) => {
    const mem = memoryAt(point);
    const leafOwners = indexArrayLeaves(mem);

    const writtenByArray = new Map<string, Coord[]>();
    for (const [id, owner] of leafOwners) {
      const prevVal = lastValue.get(id);
      lastValue.set(id, owner.value);
      if (prevVal === undefined) continue; // first appearance = materialization, not a write
      if (prevVal === owner.value) continue;
      // A cell materializing as "<UNINITIALIZED>" is not a real DP write.
      if (owner.value === "<UNINITIALIZED>") continue;
      const list = writtenByArray.get(owner.arrayId) ?? [];
      list.push(owner.coord);
      writtenByArray.set(owner.arrayId, list);
    }

    for (const [arrayId, coords] of writtenByArray) {
      const info = leafOwners.arrays.get(arrayId)!;
      let t = tracked.get(arrayId);
      if (!t) {
        t = { cellId: arrayId, name: info.name, maxDims: [], writes: [],
              writeSteps: new Set(), selfRefSteps: new Set(),
              writeDepths: new Set(), writeFuncs: new Set(), keyed: false };
        tracked.set(arrayId, t);
      }
      t.maxDims = maxDims(t.maxDims, info.dims);
      for (const coord of coords) t.writes.push({ step, coord });
      t.writeSteps.add(step);
      // The write is visible at `step`, but the line that PERFORMED it is the
      // previous point's line (trace records state after each line executes).
      const writeLine = trace[step - 1]?.line ?? point.line;
      const lineText = statementAtExecLine(codeLines, statements, writeLine);
      // Self-reference evidence must come from a single line that actually
      // EXECUTED — never from summing occurrences across source-adjacent
      // lines (that would confirm a plain fill loop whose write line happens
      // to sit under an unrelated read line). Two accepted witnesses:
      //   (a) the write line itself has >= 2 occurrences (bottom-up:
      //       "dp[i] = dp[i-1] + dp[i-2];"), or
      //   (b) a read of the table in a conditional/return statement the same
      //       frame invocation already executed before the write (see
      //       selfRefBeforeWrite).
      let selfRef = countSubscripts(lineText, info.name) >= 2;
      if (!selfRef) selfRef = selfRefBeforeWrite(trace, step - 1, codeLines, statements, info.name, subscriptRead);
      if (selfRef) t.selfRefSteps.add(step);
      const prev = trace[step - 1] ?? point;
      const prevFrames = prev.stack_to_render ?? [];
      t.writeDepths.add(prevFrames.length);
      const top = prevFrames.at(-1) as StackFrameLike | undefined;
      if (top?.func_name) t.writeFuncs.add(top.func_name);
    }
  });

  return tracked;
}

/** True when the table is read (subscripted, and not as an assignment LHS) in
 *  a CONDITIONAL or RETURN statement that this write's own frame invocation
 *  already executed before the write. That is control dependence on the
 *  table's own prior values — the property that actually separates a
 *  recurrence from a fill.
 *
 *  Restricting to conditionals and returns is load-bearing, not cosmetic.
 *  Accepting any earlier read would make a plain fill loop self-referential
 *  whenever an unrelated read happens to precede the write — exactly the
 *  printf-fill false positive that tests/dpDetect.test.ts guards.
 *
 *  Execution adjacency, not source adjacency: the frame's executed lines are
 *  replayed from the trace via frameKey, because the point literally before
 *  the write can be a callee's return artifact.
 *
 *  `matcher` supplies the plain-read check at the end (a `ReadMatcher`, see
 *  above) so this function is shared between the array path (`subscriptRead`)
 *  and the map/unordered_map path (`keyedRead`) without duplicating the frame
 *  replay. */
export function selfRefBeforeWrite(
  trace: ExecPoint[], writeIdx: number, codeLines: string[], statements: string[], name: string,
  matcher: ReadMatcher,
): boolean {
  if (writeIdx < 1) return false;
  const writePoint = trace[writeIdx];
  const writeFrame = (writePoint.stack_to_render ?? []).at(-1) as StackFrameLike | undefined;
  if (!writeFrame) return false;
  const key = frameKey(writeFrame);

  for (let j = writeIdx - 1; j >= 0; j--) {
    const frames = (trace[j].stack_to_render ?? []) as StackFrameLike[];
    if (!frames.some((f) => frameKey(f) === key)) break; // before frame entry
    const top = frames.at(-1);
    if (!top || frameKey(top) !== key) continue;
    const text = statementAtExecLine(codeLines, statements, trace[j].line);
    if (!isControlStatement(text)) continue;
    if (isAssignmentLhs(text, name)) continue;
    // A statement containing "return" is narrowed further: a bounds/sentinel
    // guard (`if (arr[n] < 0 || arr[n] > 100) return -1;`) has the same shape
    // as a memo short-circuit — a conditional reading the array with "return"
    // somewhere on the line — but hands back a sentinel, not the array's own
    // value, so it is not evidence of a recurrence. Only a return that hands
    // the array's own subscripted value straight back (`return dp[n];`, or
    // embedded as in a single-line `if (...) return dp[n];`) counts. A
    // conditional with no "return" at all (`if (dp[n] != -1) {`, or
    // count-substrings' `if (s[i] == s[j] && dp[i+1][j-1]) {`) is not subject
    // to this narrowing: reading the table to decide whether to enter the
    // branch that performs the write IS the recurrence.
    if (/\breturn\b/.test(text)) {
      if (returnsOwnSubscript(text, name)) return true;
      continue;
    }
    if (matcher(text, name)) return true;
  }
  return false;
}

/** A statement whose subscripts express control dependence: if / while / for /
 *  ternary / return. */
export function isControlStatement(text: string): boolean {
  return /^(if|while|for|return)\b/.test(text.trimStart()) || text.includes("?");
}

/** True when `text` contains the literal pattern `return <ws>* name[` — i.e.
 *  the "return" keyword immediately (modulo whitespace) followed by a
 *  subscript of this array. See selfRefBeforeWrite's doc for why this
 *  narrowing exists only for statements that contain "return". */
function returnsOwnSubscript(text: string, name: string): boolean {
  const re = new RegExp(`\\breturn\\s*${escapeRe(name)}\\s*\\[`);
  return re.test(text);
}

// Frame identity is shared with the call tree so both agree on what "the
// same frame" means across modules.

interface LeafOwner { arrayId: string; coord: Coord; value: string; }
interface ArrayInfo { name: string; dims: number[]; }
type LeafIndex = Map<string, LeafOwner> & { arrays: Map<string, ArrayInfo> };

/** Map every scalar leaf id inside a 1D/2D array-like cell to its owning
 *  array id + coordinate. Array-like: kind "array", or containerKind "vector"
 *  with scalar or nested vector children. */
function indexArrayLeaves(mem: NormalizedMemory): LeafIndex {
  const index = new Map() as LeafIndex;
  index.arrays = new Map();
  for (const cell of allRoots(mem)) visit(cell, index);
  return index;
}

function visit(cell: NormalizedCell, index: LeafIndex) {
  if (isArrayLike(cell)) {
    const dims = registerLeaves(cell, index);
    if (dims) index.arrays.set(cell.id, { name: cell.name, dims });
    return; // don't descend further; leaves already registered
  }
  cell.children?.forEach((c) => visit(c, index));
}

function isArrayLike(cell: NormalizedCell): boolean {
  return cell.kind === "array" || cell.containerKind === "vector";
}

/** Returns dims if the cell is a clean 1D scalar array or 2D array-of-arrays. */
function registerLeaves(cell: NormalizedCell, index: LeafIndex): number[] | null {
  const kids = cell.children ?? [];
  if (kids.length === 0) return null;
  if (kids.every((k) => !k.children?.length)) {
    kids.forEach((k, i) => index.set(k.id, { arrayId: cell.id, coord: [i], value: k.displayValue }));
    return [kids.length];
  }
  if (kids.every((k) => isArrayLike(k) && (k.children ?? []).every((g) => !g.children?.length))) {
    let cols = 0;
    kids.forEach((row, i) =>
      (row.children ?? []).forEach((k, j) => {
        index.set(k.id, { arrayId: cell.id, coord: [i, j], value: k.displayValue });
        cols = Math.max(cols, j + 1);
      }),
    );
    return [kids.length, cols];
  }
  return null;
}

function maxDims(a: number[], b: number[]): number[] {
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) => Math.max(a[i] ?? 0, b[i] ?? 0));
}
