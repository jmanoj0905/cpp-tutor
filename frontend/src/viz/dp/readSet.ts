import { evalIndexExpr } from "./exprEval";

export type Coord = readonly number[];

/** All `name[e1]` / `name[e1][e2]` occurrences on one source line, as raw
 *  index-expression strings. Bracket-balanced so nested subscripts survive
 *  extraction (they are later rejected by the evaluator, not mangled here). */
export function subscriptOccurrences(lineText: string, tableName: string): string[][] {
  const out: string[][] = [];
  const re = new RegExp(`(?<![\\w.])${escapeRe(tableName)}\\s*\\[`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(lineText))) {
    const indices: string[] = [];
    let pos = m.index + m[0].length - 1; // at the "["
    while (lineText[pos] === "[") {
      const close = matchBracket(lineText, pos);
      if (close === -1) break;
      indices.push(lineText.slice(pos + 1, close).trim());
      pos = close + 1;
      while (lineText[pos] === " ") pos++;
    }
    if (indices.length > 0) out.push(indices);
    re.lastIndex = pos;
  }
  return out;
}

export function resolveOccurrences(
  lineText: string,
  tableName: string,
  env: ReadonlyMap<string, number>,
): Coord[] {
  const coords: Coord[] = [];
  for (const indices of subscriptOccurrences(lineText, tableName)) {
    const coord = indices.map((e) => evalIndexExpr(e, env));
    if (coord.every((v): v is number => v !== null)) coords.push(coord);
  }
  return coords;
}

export function countSubscripts(lineText: string, tableName: string): number {
  return subscriptOccurrences(lineText, tableName).length;
}

function matchBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "[") depth++;
    else if (s[i] === "]" && --depth === 0) return i;
  }
  return -1;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
