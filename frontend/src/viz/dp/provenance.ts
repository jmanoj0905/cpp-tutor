import type { ExecPoint } from "../../types/trace";
import { memoryAt } from "../memoryModel";
import { escapeRe } from "../../util";
import type { DpCandidate } from "./detect";
import { arrayEnv, findTableCell, intEnv, leafAt } from "./dpModel";
import { evalIndexExpr, type ArrayEnv } from "./exprEval";
import { matchBracket, subscriptOccurrences, type Coord } from "./readSet";
import { buildStatements, statementAtExecLine } from "./statements";
import { projectPairs } from "./keyedWrites";

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
  const written = writtenValue(candidate, coord, at);

  const { op, parts } = splitOperands(split.rhs);
  const operands: Operand[] = parts.map((part) => ({
    text: resolveSubscripts(part, candidate.name, env, arrays),
    value: evalIndexExpr(part, env, arrays),
  }));

  const selfRef = subscriptOccurrences(split.rhs, candidate.name).length > 0;
  const rhs = resolveSubscripts(split.rhs, candidate.name, env, arrays);

  return {
    lhs: keyedLhs(candidate, coord),
    assign: split.assign,
    rhs,
    op,
    operands,
    written,
    winner: pickWinner(op, operands, written),
    baseCase: !selfRef && operands.every((o) => o.value !== null),
  };
}

/** The RHS's branch structure. See the shape rules in the S2 spec. Exported
 *  for unit test; the only production caller is `explainWrite`. */
export function splitOperands(rhs: string): { op: Provenance["op"]; parts: string[] } {
  const call = findCall(rhs);
  if (call) return { op: call.name, parts: splitTop(call.inner, ",") };
  const arms = splitTernary(rhs);
  if (arms) return { op: "ternary", parts: arms };
  return { op: null, parts: [rhs] };
}

/** The first depth-0 `max(`/`min(` call and its argument text. */
function findCall(src: string): { name: "max" | "min"; inner: string } | null {
  const re = /(?<![\w.])(?:std::)?(max|min)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (depthAt(src, m.index) !== 0) continue;
    const open = m.index + m[0].length - 1;
    const close = matchParen(src, open);
    if (close === -1) continue;
    return { name: m[1] as "max" | "min", inner: src.slice(open + 1, close) };
  }
  return null;
}

/** Two arms of a depth-0 ternary, or null. `::` is skipped so `std::max` in an
 *  arm is not mistaken for the `:` separator. */
function splitTernary(src: string): [string, string] | null {
  const q = indexAtTop(src, "?", 0);
  if (q === -1) return null;
  for (let i = q + 1; i < src.length; i++) {
    if (src[i] === ":" && depthAt(src, i) === 0) {
      if (src[i + 1] === ":") { i++; continue; }
      if (src[i - 1] === ":") continue;
      return [src.slice(q + 1, i).trim(), src.slice(i + 1).trim()];
    }
  }
  return null;
}

/** Split at depth-0 occurrences of a single-character separator. */
function splitTop(src: string, sep: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === sep && depthAt(src, i) === 0) {
      parts.push(src.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(src.slice(start).trim());
  return parts;
}

function indexAtTop(src: string, ch: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === ch && depthAt(src, i) === 0) return i;
  }
  return -1;
}

/** Paren + bracket nesting depth at `i`. O(i), which is fine on statements. */
function depthAt(src: string, i: number): number {
  let depth = 0;
  for (let k = 0; k < i; k++) {
    const c = src[k];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
  }
  return depth;
}

function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Which branch produced the value. Exported for unit test. */
export function pickWinner(
  op: Provenance["op"], operands: readonly Operand[], written: string,
): number | null {
  const live = operands
    .map((o, i) => [i, o.value] as const)
    .filter((e): e is readonly [number, number] => e[1] !== null);
  if (live.length < 2) return null;
  if (op === "max" || op === "min") {
    // The extremum, NOT the arm equal to `written`: the call may be a
    // sub-expression of the RHS (`1 + min(a, b)`), so no arm equals the value
    // that landed in the cell. The extremum is what the call returned either
    // way. Strict comparison keeps a tie on the first arm, which is what
    // max/min themselves return.
    return live.reduce((best, cur) =>
      (op === "max" ? cur[1] > best[1] : cur[1] < best[1]) ? cur : best)[0];
  }
  if (op === "ternary") {
    const w = Number(written);
    if (!Number.isFinite(w) || written.trim() === "") return null;
    return live.find(([, v]) => v === w)?.[0] ?? null;
  }
  return null;
}

/** Grid coord -> the map key it projects from, for keyed tables. */
function keyOfCoord(candidate: DpCandidate, coord: Coord): string | null {
  if (!candidate.keyed) return null;
  const want = coord.join(",");
  for (const [key, c] of candidate.keyed.projection.coordOfKey) {
    if (c.join(",") === want) return key;
  }
  return null;
}

/** "memo[7]" for a keyed table (the KEY, which is what the source subscripted),
 *  "dp[3][4]" otherwise. */
function keyedLhs(candidate: DpCandidate, coord: Coord): string {
  const key = keyOfCoord(candidate, coord);
  return key !== null
    ? `${candidate.name}[${key}]`
    : `${candidate.name}[${coord.join("][")}]`;
}

/** The table's value at `coord` as of `point`. */
function writtenValue(candidate: DpCandidate, coord: Coord, point: ExecPoint): string {
  const table = findTableCell(memoryAt(point), candidate.cellId);
  if (candidate.keyed) {
    const key = keyOfCoord(candidate, coord);
    return (key !== null && table ? projectPairs(table).get(key) : "") ?? "";
  }
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
    }
    if (!ok) break;
    out += text.slice(last, m.index) + name + chain;
    last = pos;
    re.lastIndex = pos;
  }
  return out + text.slice(last);
}
