import type { ExecPoint } from "../../types/trace";
import type { NormalizedCell, NormalizedMemory } from "../memoryModel";
import type { DpCandidate } from "./detect";
import { isAssignmentLhs, resolveOccurrences, type Coord } from "./readSet";

export interface DpCellView {
  coord: Coord;
  id: string;
  value: string;
  writeStep: number | null;
}

export interface DpTableView {
  candidate: DpCandidate;
  cells: DpCellView[];
  currentWrite: Coord | null;
  reads: Coord[];
  maxWriteStep: number;
}

/** Integer locals of the innermost frame, for index-expression evaluation. */
export function intEnv(point: ExecPoint): Map<string, number> {
  const env = new Map<string, number>();
  const top = point.stack_to_render.at(-1) as
    | { encoded_locals?: Record<string, unknown> } | undefined;
  for (const [name, raw] of Object.entries(top?.encoded_locals ?? {})) {
    if (Array.isArray(raw) && raw[0] === "C_DATA" && typeof raw[3] === "number"
        && Number.isInteger(raw[3])) {
      env.set(name, raw[3]);
    }
  }
  return env;
}

export function buildDpView(
  candidate: DpCandidate,
  step: number,
  point: ExecPoint,
  mem: NormalizedMemory,
  codeLines: string[],
  prevPoint: ExecPoint | null = null,
): DpTableView {
  const writeStepAt = new Map<string, number>();
  let currentWrite: Coord | null = null;
  let maxWriteStep = 0;
  for (const w of candidate.writes) {
    if (w.step > step) break;
    writeStepAt.set(w.coord.join(","), w.step);
    maxWriteStep = w.step;
    if (w.step === step) currentWrite = w.coord;
  }

  const table = findCell(mem, candidate.cellId);
  const cells: DpCellView[] = [];
  const [rows, cols] = candidate.dims.length === 2 ? candidate.dims : [1, candidate.dims[0]];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const coord: Coord = candidate.dims.length === 2 ? [r, c] : [c];
      const leaf = leafAt(table, coord);
      cells.push({
        coord,
        id: leaf?.id ?? `${candidate.cellId}[${coord.join(",")}]`,
        value: leaf?.displayValue ?? "?",
        writeStep: writeStepAt.get(coord.join(",")) ?? null,
      });
    }
  }

  // When a write just landed this step, the operand reads that produced it
  // were resolved on the PREVIOUS trace point's line (the write's coord
  // isn't visible until the step after the line that performed it runs — see
  // detect.ts). Re-resolve against `prevPoint`'s line/locals in that case, so
  // the read-set lines up with the write it's paired with in the UI. When no
  // write landed this step (the already-correct "upcoming reads" case) or no
  // previous point is available, keep resolving against the current point.
  const usePrevPoint = currentWrite !== null && prevPoint !== null;
  const readPoint = usePrevPoint ? prevPoint! : point;
  const lineText = codeLines[readPoint.line - 1] ?? "";
  const occ = resolveOccurrences(lineText, candidate.name, intEnv(readPoint));
  const reads = [...occ];
  // Structural primary defense: on an assignment line `name[...] = expr;`,
  // the LHS subscript occurrence is always the write target, independent of
  // when (or whether, within this step) the trace records the write as
  // visible. This is required to generalize across bottom-up (write visible
  // immediately) and top-down/recursive DP (write visibility can be delayed
  // by many steps while the RHS's recursive calls execute) — timing-based
  // exclusion (currentWrite / "next step" heuristics below) cannot catch the
  // top-down case at all, since the write may not land for dozens of steps.
  if (isAssignmentLhs(lineText, candidate.name) && occ.length > 0) {
    const i = reads.findIndex((c) => c.join(",") === occ[0].join(","));
    if (i !== -1) reads.splice(i, 1);
  }
  if (currentWrite) {
    const i = reads.findIndex((c) => c.join(",") === currentWrite!.join(","));
    if (i !== -1) reads.splice(i, 1);
  }
  // The write performed by the line about to execute at this step isn't
  // visible until `step + 1` (detect.ts records a write's coord one step
  // after the line that produced it runs). Exclude that upcoming write's
  // coord from the read set too, so the write target never leaks in as a
  // spurious "read" on the line that is about to write it. (Bottom-up
  // safety net; the structural check above is the primary defense and
  // already covers this case, but this is kept for the case where the
  // write's step happens to land beyond a simple +1 offset.)
  if (!usePrevPoint) {
    const nextWrite = candidate.writes.find((w) => w.step === step + 1);
    if (nextWrite) {
      const i = reads.findIndex((c) => c.join(",") === nextWrite.coord.join(","));
      if (i !== -1) reads.splice(i, 1);
    }
  }

  return { candidate, cells, currentWrite, reads, maxWriteStep };
}

/** Whole-trace read log: coord key "r,c" → steps whose executing line resolved
 *  a read of that coord. Memoize at the call site alongside detectDpTables. */
export function collectReadSteps(
  trace: ExecPoint[],
  candidate: DpCandidate,
  codeLines: string[],
): Map<string, number[]> {
  const log = new Map<string, number[]>();
  trace.forEach((point, step) => {
    const lineText = codeLines[point.line - 1] ?? "";
    const occ = resolveOccurrences(lineText, candidate.name, intEnv(point));
    const reads = [...occ];
    if (isAssignmentLhs(lineText, candidate.name) && occ.length > 0) {
      const i = reads.findIndex((c) => c.join(",") === occ[0].join(","));
      if (i !== -1) reads.splice(i, 1);
    }
    for (const coord of reads) {
      const k = coord.join(",");
      const list = log.get(k) ?? [];
      list.push(step);
      log.set(k, list);
    }
  });
  return log;
}

function findCell(mem: NormalizedMemory, id: string): NormalizedCell | null {
  const stack: NormalizedCell[] = [
    ...mem.globals, ...mem.frames.flatMap((f) => f.cells), ...mem.heap,
  ];
  while (stack.length) {
    const cell = stack.pop()!;
    if (cell.id === id) return cell;
    if (cell.children) stack.push(...cell.children);
  }
  return null;
}

function leafAt(table: NormalizedCell | null, coord: Coord): NormalizedCell | null {
  let cell = table;
  for (const i of coord) cell = cell?.children?.[i] ?? null;
  return cell;
}
