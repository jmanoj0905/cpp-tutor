/** An integer array visible at the current step. Elements that are not
 *  recoverable integers (uninitialized, non-numeric) are null, so indexing
 *  into them fails instead of inventing a value. */
export type ArrayValue = ReadonlyArray<number | ArrayValue | null>;
export type ArrayEnv = ReadonlyMap<string, ArrayValue>;

/** Restricted arithmetic evaluator for DP index expressions.
 *  Grammar: expr := term (("+"|"-") term)* ; term := unary (("*"|"/"|"%") unary)* ;
 *  unary := "-" unary | primary ;
 *  primary := int | ident | ident ("[" expr "]")+ | "(" expr ")".
 *  A subscript resolves only against `arrays` — an array whose live values are
 *  known at this step — and only down to a scalar element that is in range.
 *  This is what lets the common DP recurrences that index through a second
 *  array (`dp[a - coins[k]]`, `dp[i-1][c-w[i-1]]`) resolve their reads.
 *  Anything else (calls, casts, unknown identifiers or arrays, out-of-range or
 *  partial subscripts, div-by-zero) returns null — never guess.
 *  Pure, no React/DOM. */
export function evalIndexExpr(
  src: string,
  env: ReadonlyMap<string, number>,
  arrays: ArrayEnv = new Map(),
): number | null {
  const tokens = tokenize(src);
  if (!tokens) return null;
  const p = new Parser(tokens, env, arrays);
  const value = p.expr();
  return value !== null && p.done() ? value : null;
}

type Token = { kind: "num"; value: number } | { kind: "ident"; name: string } | { kind: "op"; op: string };

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  const re = /\s*(?:(\d+)|([A-Za-z_]\w*)|([+\-*/%()[\]]))/y;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m || re.lastIndex === pos) return null;
    if (m[1] !== undefined) tokens.push({ kind: "num", value: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ kind: "ident", name: m[2] });
    else tokens.push({ kind: "op", op: m[3] });
    pos = re.lastIndex;
  }
  return tokens.length > 0 ? tokens : null;
}

class Parser {
  private i = 0;
  private tokens: Token[];
  private env: ReadonlyMap<string, number>;
  private arrays: ArrayEnv;
  constructor(tokens: Token[], env: ReadonlyMap<string, number>, arrays: ArrayEnv) {
    this.tokens = tokens;
    this.env = env;
    this.arrays = arrays;
  }
  done() { return this.i === this.tokens.length; }
  private peekOp(...ops: string[]): string | null {
    const t = this.tokens[this.i];
    return t?.kind === "op" && ops.includes(t.op) ? t.op : null;
  }
  expr(): number | null {
    let left = this.term();
    let op;
    while (left !== null && (op = this.peekOp("+", "-"))) {
      this.i++;
      const right = this.term();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  private term(): number | null {
    let left = this.unary();
    let op;
    while (left !== null && (op = this.peekOp("*", "/", "%"))) {
      this.i++;
      const right = this.unary();
      if (right === null) return null;
      if ((op === "/" || op === "%") && right === 0) return null;
      left = op === "*" ? left * right : op === "/" ? Math.trunc(left / right) : left % right;
    }
    return left;
  }
  private unary(): number | null {
    if (this.peekOp("-")) { this.i++; const v = this.unary(); return v === null ? null : -v; }
    return this.primary();
  }
  private primary(): number | null {
    const t = this.tokens[this.i];
    if (!t) return null;
    if (t.kind === "num") { this.i++; return t.value; }
    if (t.kind === "ident") {
      this.i++;
      if (this.peekOp("[")) return this.subscript(t.name);
      return this.env.get(t.name) ?? null;
    }
    if (t.kind === "op" && t.op === "(") {
      this.i++;
      const v = this.expr();
      if (v === null || !this.peekOp(")")) return null;
      this.i++;
      return v;
    }
    return null;
  }
  /** `name` followed by one or more `[expr]`, evaluated against the array env.
   *  Must land exactly on a scalar: a partial subscript (`grid[0]`, still a
   *  row) and an over-subscript (`coins[0][0]`) both fail rather than guess. */
  private subscript(name: string): number | null {
    let value: number | ArrayValue | null | undefined = this.arrays.get(name);
    while (this.peekOp("[")) {
      this.i++;
      const index = this.expr();
      if (index === null || !this.peekOp("]")) return null;
      this.i++;
      if (!Array.isArray(value) || index < 0 || index >= value.length) return null;
      value = value[index];
    }
    return typeof value === "number" ? value : null;
  }
}
