import type { ExecPoint } from "../../types/trace";
import { memoryAt } from "../memoryModel";
import { escapeRe } from "../../util";
import type { DpCandidate } from "./detect";
import { arrayEnv, findTableCell, intEnv, leafAt } from "./dpModel";
import { evalIndexExpr, type ArrayEnv } from "./exprEval";
import { matchBracket, subscriptOccurrences, type Coord } from "./readSet";
import { buildStatements, statementAtExecLine } from "./statements";

export interface Operand {
  /** Source text with the table's own subscripts resolved: "dp[3][3] + 1". */
  text: string;
  /** Value at the write, or null when not evaluable. */
  value: number | null;
}

export interface Provenance {
  lhs: string;
  assign: string;
  rhs: string;
  op: "max" | "min" | "ternary" | null;
  operands: Operand[];
  written: string;
  winner: number | null;
  baseCase: boolean;
}

/** Why one DP cell holds the value it holds: the statement that wrote it, with
 *  the table's own subscripts resolved to concrete indices, and each operand
 *  evaluated against the memory as it stood immediately before the write.
 *
 *  A write's coord is not visible until the step AFTER the line that performed
 *  it (see detect.ts), so the statement and the operand values both come from
 *  `writeStep - 1` — the same convention `buildDpView` applies when it
 *  re-resolves reads against `prevPoint`. The written value comes from
 *  `writeStep` itself, never from the step being inspected: the cell may have
 *  been overwritten many steps later.
 *
 *  Returns null rather than guessing whenever the statement is not an
 *  assignment whose LHS subscripts this table.
 *
 *  Pure: no React, no DOM. */
export function explainWrite(
  candidate: DpCandidate,
  coord: Coord,
  writeStep: number,
  trace: ExecPoint[],
  codeLines: string[],
): Provenance | null {
  const prev = trace[writeStep - 1];
  const at = trace[writeStep];
  if (writeStep < 1 || !prev || !at) return null;

  const text = statementAtExecLine(codeLines, buildStatements(codeLines), prev.line);
  const split = splitAssignment(text, candidate.name);
  if (!split) return null;

  const env = intEnv(prev);
  const arrays = arrayEnv(memoryAt(prev));
  const rhs = resolveSubscripts(split.rhs, candidate.name, env, arrays);
  const operands: Operand[] = [
    { text: rhs, value: evalIndexExpr(split.rhs, env, arrays) },
  ];
  const selfRef = subscriptOccurrences(split.rhs, candidate.name).length > 0;

  return {
    lhs: `${candidate.name}[${coord.join("][")}]`,
    assign: split.assign,
    rhs,
    op: null,
    operands,
    written: writtenValue(candidate, coord, at),
    winner: null,
    baseCase: !selfRef && operands.every((o) => o.value !== null),
  };
}

/** The table's value at `coord` as of `point`. */
function writtenValue(candidate: DpCandidate, coord: Coord, point: ExecPoint): string {
  const table = findTableCell(memoryAt(point), candidate.cellId);
  return leafAt(table, coord)?.displayValue ?? "";
}

/** Split a statement at the assignment whose LHS subscripts `name`.
 *  Scans at bracket/paren depth 0 so the `=` inside `for (int j = 0; ...)` is
 *  skipped — a seed write's statement is routinely the whole for-loop, because
 *  the tracer attributes `for (...) dp[0][j] = 1;` to its single line.
 *  Exported for unit test; the only production caller is `explainWrite`. */
export function splitAssignment(text: string, name: string): { assign: string; rhs: string } | null {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "=" && depth === 0 && text[i + 1] !== "=" && !"=<>!".includes(text[i - 1] ?? "")) {
      const compound = "+-*/%|&^".includes(text[i - 1] ?? "");
      const lhs = text.slice(0, compound ? i - 1 : i);
      if (!lhsTargets(lhs, name)) return null;
      return {
        assign: compound ? `${text[i - 1]}=` : "=",
        rhs: text.slice(i + 1).trim().replace(/;$/, "").trim(),
      };
    }
  }
  return null;
}

/** True when the assignment's LHS ends in a subscript chain of `name`. */
function lhsTargets(lhs: string, name: string): boolean {
  const t = lhs.trimEnd();
  return t.endsWith("]") && new RegExp(`(?<![\\w.])${escapeRe(name)}\\s*\\[`).test(t);
}

/** Rewrite every `name[expr]...` in `text` with its resolved indices:
 *  `dp[i-1][j]` -> `dp[2][4]`. Subscripts of OTHER arrays are left as source
 *  text (`coins[k]` stays `coins[k]`): resolving those would need a general
 *  expression rewriter, and it is the table's own indices that connect the
 *  statement to the grid the learner is looking at. An index that does not
 *  evaluate is left as written rather than dropped. */
function resolveSubscripts(
  text: string, name: string, env: ReadonlyMap<string, number>, arrays: ArrayEnv,
): string {
  const re = new RegExp(`(?<![\\w.])${escapeRe(name)}\\s*\\[`, "g");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let pos = m.index + m[0].length - 1; // at the "["
    let chain = "";
    let ok = true;
    while (text[pos] === "[") {
      const close = matchBracket(text, pos);
      if (close === -1) { ok = false; break; }
      const src = text.slice(pos + 1, close).trim();
      const v = evalIndexExpr(src, env, arrays);
      chain += `[${v === null ? src : v}]`;
      pos = close + 1;
      while (text[pos] === " ") pos++;
    }
    if (!ok) break;
    out += text.slice(last, m.index) + name + chain;
    last = pos;
    re.lastIndex = pos;
  }
  return out + text.slice(last);
}
