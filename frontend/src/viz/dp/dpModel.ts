import type { ExecPoint } from "../../types/trace";
import { memoryAt, type NormalizedCell, type NormalizedMemory } from "../memoryModel";
import { allRoots, findCellById } from "../cells";
import type { DpCandidate } from "./detect";
import type { ArrayEnv, ArrayValue } from "./exprEval";
import { isAssignmentLhs, resolveOccurrences, type Coord } from "./readSet";
import { buildStatements, statementAtExecLine } from "./statements";

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
  const top = (point.stack_to_render ?? []).at(-1) as
    | { encoded_locals?: Record<string, unknown> } | undefined;
  for (const [name, raw] of Object.entries(top?.encoded_locals ?? {})) {
    if (Array.isArray(raw) && raw[0] === "C_DATA" && typeof raw[3] === "number"
        && Number.isInteger(raw[3])) {
      env.set(name, raw[3]);
    }
  }
  return env;
}

/** Integer arrays in scope — globals plus the innermost frame's own cells, the
 *  same scoping as `intEnv` — so index expressions that read through a second
 *  array (`dp[a - coins[k]]`) can be resolved. Values come from the already
 *  decoded memory, so heap-backed containers (`vector<int>`) work the same as
 *  plain C arrays. */
export function arrayEnv(mem: NormalizedMemory): ArrayEnv {
  const env = new Map<string, ArrayValue>();
  const inScope = [...mem.globals, ...(mem.frames.at(-1)?.cells ?? [])];
  for (const cell of inScope) {
    const value = intArrayValue(cell);
    if (value) env.set(cell.name, value);
  }
  return env;
}

/** An array-like cell as nested integers, with null for anything that isn't a
 *  recoverable integer. Non-array cells return null. */
function intArrayValue(cell: NormalizedCell): ArrayValue | null {
  if (cell.kind !== "array" && cell.containerKind !== "vector") return null;
  const kids = cell.children;
  if (!kids?.length) return null;
  return kids.map((kid) => {
    const nested = intArrayValue(kid);
    if (nested) return nested;
    if (kid.children?.length) return null;
    const n = Number(kid.displayValue);
    return kid.displayValue !== "" && Number.isInteger(n) ? n : null;
  });
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
  const statements = buildStatements(codeLines);
  const usePrevPoint = currentWrite !== null && prevPoint !== null;
  const readPoint = usePrevPoint ? prevPoint! : point;
  const lineText = statementAtExecLine(codeLines, statements, readPoint.line);
  const readMem = usePrevPoint ? memoryAt(readPoint) : mem;
  const occ = resolveOccurrences(lineText, candidate.name, intEnv(readPoint), arrayEnv(readMem));
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
  const statements = buildStatements(codeLines);
  trace.forEach((point, step) => {
    const lineText = statementAtExecLine(codeLines, statements, point.line);
    const occ = resolveOccurrences(lineText, candidate.name, intEnv(point),
                                   arrayEnv(memoryAt(point)));
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

const findCell = (mem: NormalizedMemory, id: string): NormalizedCell | null =>
  findCellById(allRoots(mem), id);

function leafAt(table: NormalizedCell | null, coord: Coord): NormalizedCell | null {
  let cell = table;
  for (const i of coord) cell = cell?.children?.[i] ?? null;
  return cell;
}
