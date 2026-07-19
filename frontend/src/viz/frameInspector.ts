// Pure call-time variable inspection for the call-tree detail panel — no
// React, no DOM. Given a CallTreeNode, decode the trace point where the
// frame's parameters have settled (see callTree.ts header for the 0-2 step
// <UNALLOCATED>/<UNINITIALIZED> lag after a push) and return the decoded
// cell for one variable, following reference/pointer params to their target
// so `const vector<int>& nums` shows the caller's actual elements.
import type { ExecPoint } from "../types/trace";
import type { CallTreeNode } from "./callTree";
import { isCompilerInternal, normalizeMemory, type NormalizedCell } from "./memoryModel";

export interface InspectedVariable {
  cell: NormalizedCell;
  /** Trace step the values were decoded from (the settled entry step). */
  step: number;
  /** True when the variable was a reference/pointer and `cell` is its target. */
  deref: boolean;
}

interface OptFrame {
  func_name?: string;
  ordered_varnames?: string[];
  encoded_locals?: Record<string, unknown>;
  is_zombie?: boolean;
}

const baseName = (raw: string | undefined): string => (raw ?? "?").replace(/\(.*\)$/, "");

/** The node's frame within a point's full stack_to_render (zombies included),
 *  located by live depth; null when the shape doesn't match the node. */
function frameIndexAt(point: ExecPoint, node: CallTreeNode): number | null {
  const fs = point.stack_to_render as OptFrame[];
  let liveDepth = -1;
  for (let i = 0; i < fs.length; i++) {
    if (fs[i].is_zombie) continue;
    liveDepth++;
    if (liveDepth === node.depth) {
      return baseName(fs[i].func_name) === node.funcName ? i : null;
    }
  }
  return null;
}

function isInitialized(raw: unknown): boolean {
  if (raw === undefined) return false;
  if (Array.isArray(raw) && raw[0] === "C_DATA") {
    const v = raw[3];
    return v !== "<UNALLOCATED>" && v !== "<UNINITIALIZED>";
  }
  return true;
}

/** Earliest step in the frame's pre-first-child window where every parameter
 *  holds a real value — i.e. the values the call received. Falls back to the
 *  window's upper bound if nothing fully settles (pathological trace). */
export function settledEntryStep(trace: ExecPoint[], node: CallTreeNode): number {
  const upper = Math.min(
    node.children[0]?.enterStep ?? Infinity,
    node.exitStep ?? Infinity,
    trace.length - 1,
  );

  // Parameter list snapshotted at entry, before any later-scoped local exists.
  const entryIdx = frameIndexAt(trace[node.enterStep], node);
  const entryFrame =
    entryIdx === null ? null : (trace[node.enterStep].stack_to_render as OptFrame[])[entryIdx];
  const paramNames = (entryFrame?.ordered_varnames ?? []).filter((n) => !isCompilerInternal(n));

  for (let s = node.enterStep; s <= upper; s++) {
    const i = frameIndexAt(trace[s], node);
    if (i === null) continue;
    const locals = (trace[s].stack_to_render as OptFrame[])[i].encoded_locals ?? {};
    if (paramNames.every((n) => isInitialized(locals[n]))) return s;
  }
  return upper;
}

export function inspectVariable(
  trace: ExecPoint[],
  node: CallTreeNode,
  varName: string,
): InspectedVariable | null {
  const step = settledEntryStep(trace, node);
  const point = trace[step];
  const frameIdx = frameIndexAt(point, node);
  if (frameIdx === null) return null;

  const mem = normalizeMemory(point);
  const frame = mem.frames[frameIdx];
  if (!frame) return null;

  let cell = frame.cells.find((c) => c.name === varName);
  if (!cell) return null;

  let deref = false;
  if (cell.kind === "reference" && cell.targetId) {
    const target = findById(
      [...mem.globals, ...mem.frames.flatMap((f) => f.cells), ...mem.heap],
      cell.targetId,
    );
    if (target) {
      // Keep the variable's own name on the shown cell so the expansion reads
      // as "nums" rather than the target's internal name.
      cell = { ...target, name: varName };
      deref = true;
    }
  }

  return { cell: rekey(cell, `ct-inspect-${node.id}-`), step, deref };
}

function findById(cells: NormalizedCell[], id: string): NormalizedCell | null {
  for (const cell of cells) {
    if (cell.id === id) return cell;
    if (cell.children) {
      const hit = findById(cell.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Namespace ids so expansion cells can never collide with the Memory panel's
 *  live cells (data-cell-id is queried document-wide by tests/tools). */
function rekey(cell: NormalizedCell, prefix: string): NormalizedCell {
  return {
    ...cell,
    id: `${prefix}${cell.id}`,
    children: cell.children?.map((c) => rekey(c, prefix)),
  };
}
