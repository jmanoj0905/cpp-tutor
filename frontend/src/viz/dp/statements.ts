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
