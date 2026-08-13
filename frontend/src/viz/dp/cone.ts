import type { ExecPoint } from "../../types/trace";
import { memoryAt } from "../memoryModel";
import type { DpCandidate } from "./detect";
import { arrayEnv, intEnv } from "./dpModel";
import { isAssignmentLhs, resolveOccurrences, type Coord } from "./readSet";
import { buildStatements, statementAtExecLine } from "./statements";

export interface DpConeEdges {
  /** Cells this one was computed from, in source order. */
  operands: Coord[];
  /** Cells later computed from this one, in write order. */
  dependents: Coord[];
}

/** Coord key "r,c" → the recurrence edges into and out of that cell. */
export type DpCone = Map<string, DpConeEdges>;

/**
 * The recurrence graph of one table, as a whole-trace pass.
 *
 * A write's operands are the table reads resolved on the statement that
 * produced it — the same resolution `collectReadSteps` performs, taken at
 * `write.step - 1` because a write's coord is not visible until the step after
 * the line that performed it (see detect.ts). The LHS subscript is dropped
 * structurally, exactly as `buildDpView` drops it, so `dp[i] = dp[i-1] +
 * dp[i-2]` yields operands [i-1] and [i-2] and never [i] itself.
 *
 * Both directions come out of that single pass: an operand edge from a read to
 * the write it fed is a dependent edge read in reverse.
 *
 * Pure: no React, no DOM. Memoize per candidate at the call site — this walks
 * every write in the trace.
 */
export function buildCone(
  candidate: DpCandidate,
  trace: ExecPoint[],
  codeLines: string[],
): DpCone {
  const cone: DpCone = new Map();
  // A keyed memo's coords come from projecting its key set onto a grid, so a
  // subscript expression in the source cannot evaluate to one unless the
  // projection is numeric — the same guard `buildDpView` applies to reads.
  if (candidate.keyed && !candidate.keyed.projection.numeric) return cone;

  const statements = buildStatements(codeLines);
  const edges = (coordKey: string) => {
    const existing = cone.get(coordKey);
    if (existing) return existing;
    const fresh: DpConeEdges = { operands: [], dependents: [] };
    cone.set(coordKey, fresh);
    return fresh;
  };

  for (const write of candidate.writes) {
    const prev = trace[write.step - 1];
    if (!prev) continue;
    const lineText = statementAtExecLine(codeLines, statements, prev.line);
    const occ = resolveOccurrences(lineText, candidate.name, intEnv(prev),
                                   arrayEnv(memoryAt(prev)));
    const operands = occ.filter((coord, i) => {
      if (isAssignmentLhs(lineText, candidate.name) && i === 0) return false;
      return coord.join(",") !== write.coord.join(",");
    });

    const target = write.coord.join(",");
    const seen = new Set<string>();
    for (const operand of operands) {
      const key = operand.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      edges(target).operands.push(operand);
      edges(key).dependents.push(write.coord);
    }
    edges(target); // a base case still gets an entry, with no operands
  }
  return cone;
}
