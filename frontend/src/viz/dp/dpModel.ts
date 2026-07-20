import type { ExecPoint } from "../../types/trace";
import type { NormalizedCell, NormalizedMemory } from "../memoryModel";
import type { DpCandidate } from "./detect";
import { resolveOccurrences, type Coord } from "./readSet";

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

  const lineText = codeLines[point.line - 1] ?? "";
  const occ = resolveOccurrences(lineText, candidate.name, intEnv(point));
  const reads = [...occ];
  if (currentWrite) {
    const i = reads.findIndex((c) => c.join(",") === currentWrite!.join(","));
    if (i !== -1) reads.splice(i, 1);
  }
  // The write performed by the line about to execute at this step isn't
  // visible until `step + 1` (detect.ts records a write's coord one step
  // after the line that produced it runs). Exclude that upcoming write's
  // coord from the read set too, so the write target never leaks in as a
  // spurious "read" on the line that is about to write it.
  const nextWrite = candidate.writes.find((w) => w.step === step + 1);
  if (nextWrite) {
    const i = reads.findIndex((c) => c.join(",") === nextWrite.coord.join(","));
    if (i !== -1) reads.splice(i, 1);
  }

  return { candidate, cells, currentWrite, reads, maxWriteStep };
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
