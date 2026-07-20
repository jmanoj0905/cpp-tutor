import type { ExecPoint } from "../../types/trace";
import { normalizeMemory, type NormalizedCell, type NormalizedMemory } from "../memoryModel";
import { countSubscripts, type Coord } from "./readSet";

export interface DpWrite { step: number; coord: Coord; }

export interface DpCandidate {
  cellId: string;
  name: string;
  dims: number[];
  mode: "bottom-up" | "top-down";
  writes: DpWrite[];
}

export const MIN_WRITE_STEPS = 3;
const MAX_BOTTOMUP_LINE_SPAN = 4;

interface Tracked {
  cellId: string;
  name: string;
  maxDims: number[];
  writes: DpWrite[];
  writeSteps: Set<number>;
  selfRefSteps: Set<number>;
  writeLines: Set<number>;
  writeDepths: Set<number>;
  writeFuncs: Set<string>;
}

interface StackFrameLike {
  func_name?: string;
  frame_id?: string;
  unique_hash?: string;
}

/** Whole-trace DP table detection. Sticky: run once per trace (memoize at the
 *  call site) and apply the result at every step. Never lies — anything not
 *  matching a rule cleanly is simply not returned. Pure, no React/DOM. */
export function detectDpTables(trace: ExecPoint[], code: string): DpCandidate[] {
  const codeLines = code.split("\n");
  const tracked = new Map<string, Tracked>();
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
    const mem = normalizeMemory(point);
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
              writeSteps: new Set(), selfRefSteps: new Set(), writeLines: new Set(),
              writeDepths: new Set(), writeFuncs: new Set() };
        tracked.set(arrayId, t);
      }
      t.maxDims = maxDims(t.maxDims, info.dims);
      for (const coord of coords) t.writes.push({ step, coord });
      t.writeSteps.add(step);
      // The write is visible at `step`, but the line that PERFORMED it is the
      // previous point's line (trace records state after each line executes).
      const writeLine = trace[step - 1]?.line ?? point.line;
      t.writeLines.add(writeLine);
      const lineText = codeLines[writeLine - 1] ?? "";
      // Self-reference evidence must come from a single line that actually
      // EXECUTED — never from summing occurrences across source-adjacent
      // lines (that would confirm a plain fill loop whose write line happens
      // to sit under an unrelated read line). Two accepted witnesses:
      //   (a) the write line itself has >= 2 occurrences (bottom-up:
      //       "dp[i] = dp[i-1] + dp[i-2];"), or
      //   (b) the guard line — the line the write's own frame executed
      //       immediately before the write line first began, recovered from
      //       the trace, not from source position — has >= 2 occurrences on
      //       that one line (top-down: "if (memo[n] != -1) return memo[n];").
      let selfRef = countSubscripts(lineText, info.name) >= 2;
      if (!selfRef) {
        const guardLine = guardLineBeforeWrite(trace, step - 1);
        if (guardLine !== null &&
            countSubscripts(codeLines[guardLine - 1] ?? "", info.name) >= 2) {
          selfRef = true;
        }
      }
      if (selfRef) t.selfRefSteps.add(step);
      const prev = trace[step - 1] ?? point;
      t.writeDepths.add(prev.stack_to_render.length);
      const top = prev.stack_to_render.at(-1) as StackFrameLike | undefined;
      if (top?.func_name) t.writeFuncs.add(top.func_name);
    }
  });

  const out: DpCandidate[] = [];
  for (const t of tracked.values()) {
    if (t.writeSteps.size < MIN_WRITE_STEPS) continue;
    if (t.selfRefSteps.size * 2 <= t.writeSteps.size) continue; // majority self-ref
    const mode = classify(t);
    if (!mode) continue;
    out.push({ cellId: t.cellId, name: t.name, dims: t.maxDims, mode, writes: t.writes });
  }
  return out;
}

/** Line executed by the write's own frame invocation immediately before the
 *  write line FIRST began executing — the "guard" in the memoization idiom.
 *  Execution adjacency, not source adjacency: replay the frame's step_line
 *  history from the trace (identified by unique_hash/frame_id) and take the
 *  line preceding the first occurrence of the write line. The point literally
 *  before the write can be a callee's return artifact (observed in
 *  climb-topdown: a step at the callee's closing brace attributed to the
 *  caller frame mid-unwind), so trace[writeIdx - 1] alone is not usable.
 *  Returns null when there is no unambiguous guard line — never guesses. */
function guardLineBeforeWrite(trace: ExecPoint[], writeIdx: number): number | null {
  if (writeIdx < 1) return null;
  const writePoint = trace[writeIdx];
  const writeFrame = writePoint.stack_to_render.at(-1) as StackFrameLike | undefined;
  if (!writeFrame) return null;
  const key = frameKey(writeFrame);
  const writeLine = writePoint.line;

  // Lines executed with this exact frame invocation on top, oldest-first,
  // stopping (backward) where the invocation no longer exists on the stack.
  const history: number[] = [];
  for (let j = writeIdx - 1; j >= 0; j--) {
    const frames = trace[j].stack_to_render as StackFrameLike[];
    if (!frames.some((f) => frameKey(f) === key)) break; // before frame entry
    const top = frames.at(-1);
    if (top && frameKey(top) === key) history.push(trace[j].line);
  }
  history.reverse();

  const first = history.indexOf(writeLine);
  if (first > 0) return history[first - 1];
  if (first === -1) return history.at(-1) ?? null; // writeIdx is the first time at writeLine
  return null; // write line is the first thing the frame executed — no guard
}

function frameKey(frame: StackFrameLike): string {
  return frame.unique_hash ?? frame.frame_id ?? frame.func_name ?? "?";
}

function classify(t: Tracked): DpCandidate["mode"] | null {
  const lines = [...t.writeLines];
  const span = Math.max(...lines) - Math.min(...lines);
  if (t.writeDepths.size === 1 && span <= MAX_BOTTOMUP_LINE_SPAN) return "bottom-up";
  if (t.writeDepths.size > 1 && t.writeFuncs.size === 1) return "top-down";
  return null;
}

interface LeafOwner { arrayId: string; coord: Coord; value: string; }
interface ArrayInfo { name: string; dims: number[]; }
type LeafIndex = Map<string, LeafOwner> & { arrays: Map<string, ArrayInfo> };

/** Map every scalar leaf id inside a 1D/2D array-like cell to its owning
 *  array id + coordinate. Array-like: kind "array", or containerKind "vector"
 *  with scalar or nested vector children. */
function indexArrayLeaves(mem: NormalizedMemory): LeafIndex {
  const index = new Map() as LeafIndex;
  index.arrays = new Map();
  const allCells = [
    ...mem.globals,
    ...mem.frames.flatMap((f) => f.cells),
    ...mem.heap,
  ];
  for (const cell of allCells) visit(cell, index);
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
