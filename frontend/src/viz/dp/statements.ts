const MAX_LINES = 8;

/** Per source line (0-based, so line n is index n - 1), the full statement
 *  BEGINNING at that line: following lines are appended until parentheses and
 *  brackets balance and the text ends in ";" or "{". Whitespace is collapsed
 *  to single spaces so callers can regex over the result the way they used to
 *  regex over a single line.
 *
 *  Why this exists: DP detection judges self-reference from source text, and
 *  real recurrences and memo guards routinely span lines
 *  ("dp[i] = min(\n dp[i-1]…,\n dp[i-2]…\n);"). Reading one line saw
 *  "dp[i] = min(" — one subscript — and rejected the table.
 *
 *  Pure: no React, no DOM. */
export function buildStatements(codeLines: string[]): string[] {
  return codeLines.map((_, i) => joinFrom(codeLines, i));
}

/** Resolve a 1-based execution line, as reported by a trace point, to the
 *  full statement it belongs to.
 *
 *  Why this exists: the tracer/GDB attributes a multi-line statement to
 *  whichever physical line it was stopped at, which for `dp[i] = min(\n ...\n
 *  );` is the CLOSING line (the one carrying the semicolon), not the line the
 *  statement started on. `statements[line - 1]` alone answers "the statement
 *  beginning at this line" — for a closing line, that's just the trailing
 *  fragment ");" with none of the recurrence's subscripts. This walks
 *  backward from `line` for the earliest start whose own bracket-balanced
 *  span reaches exactly through `line`, i.e. the true enclosing statement.
 *
 *  `openEndLine` below extends a candidate span past a line for exactly the
 *  two reasons `joinFrom` itself would refuse to stop there: (1) brackets
 *  opened on that line are still unclosed (e.g. the open "(" of
 *  "dp[i] = min("), or (2) the line has no unclosed bracket but the NEXT
 *  physical line opens with a token that cannot begin a new statement — a
 *  binary operator or comma, as in a bare continuation split
 *  ("dp[i] = dp[i-1]\n + dp[i-2];"). Both cases end up producing the exact
 *  span `joinFrom` would produce for that start, so the text returned
 *  (`statements[s]`) is always consistent with what `buildStatements` itself
 *  says that start's statement is.
 *
 *  Condition (2) is also what keeps a bodyless control header ("if (cond)"
 *  with no brace, body on the next line) from being treated as reaching
 *  into that body: the body's line ("dp[a] = ...;") begins with an
 *  identifier, not a continuation token, so the header does not "reach"
 *  forward here even though `joinFrom` itself (lacking a ";"/"{" terminator
 *  on the header line) would keep reading past it when building `statements`
 *  for the header's OWN start index — that's correct behavior for
 *  `buildStatements`' guard-idiom use ("if (memo[n] != -1) return
 *  memo[n];"), just not for resolving which statement a LATER, unrelated
 *  line belongs to.
 *
 *  Pure: no React, no DOM. */
export function statementAtExecLine(codeLines: string[], statements: string[], line: number): string {
  const idx = line - 1;
  for (let s = Math.max(0, idx - MAX_LINES + 1); s < idx; s++) {
    if (openEndLine(codeLines, s) === idx) return statements[s] ?? "";
  }
  return statements[idx] ?? "";
}

/** A leading token that can only be continuing an expression from the
 *  previous line — never the start of a new C/C++ statement. */
const CONTINUATION_START = /^[-+*/%<>=!&|^?:,]/;

/** Index of the last physical line a statement starting at `start` (0-based)
 *  reaches — see `statementAtExecLine`'s doc for the two conditions that
 *  extend a span, both of which reproduce spans `joinFrom` itself would
 *  produce. */
function openEndLine(codeLines: string[], start: number): number {
  let text = "";
  let depth = 0;
  for (let i = start; i < codeLines.length && i - start < MAX_LINES; i++) {
    const line = stripComment(codeLines[i]).trim();
    text = text ? `${text} ${line}` : line;
    depth += netDepth(line);
    if (depth <= 0 && /[;{]$/.test(text)) return i;
    if (depth <= 0) {
      const next = i + 1 < codeLines.length ? stripComment(codeLines[i + 1]).trim() : "";
      if (!CONTINUATION_START.test(next)) return i;
    }
  }
  return Math.min(start + MAX_LINES, codeLines.length) - 1;
}

function joinFrom(codeLines: string[], start: number): string {
  let text = "";
  let depth = 0;
  for (let i = start; i < codeLines.length && i - start < MAX_LINES; i++) {
    const line = stripComment(codeLines[i]).trim();
    text = text ? `${text} ${line}` : line;
    depth += netDepth(line);
    if (depth <= 0 && /[;{]$/.test(text)) break;
  }
  return text.replace(/\s+/g, " ").trim();
}

/** Bracket depth contributed by one line, ignoring string and char literals. */
function netDepth(line: string): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
  }
  return depth;
}

/** Drop a trailing // comment, unless the // sits inside a literal. */
function stripComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}
