/** Restricted arithmetic evaluator for DP index expressions.
 *  Grammar: expr := term (("+"|"-") term)* ; term := unary (("*"|"/"|"%") unary)* ;
 *  unary := "-" unary | primary ; primary := int | ident | "(" expr ")".
 *  Anything else (calls, casts, subscripts, unknown identifiers, div-by-zero)
 *  returns null — never guess. Pure, no React/DOM. */
export function evalIndexExpr(src: string, env: ReadonlyMap<string, number>): number | null {
  const tokens = tokenize(src);
  if (!tokens) return null;
  const p = new Parser(tokens, env);
  const value = p.expr();
  return value !== null && p.done() ? value : null;
}

type Token = { kind: "num"; value: number } | { kind: "ident"; name: string } | { kind: "op"; op: string };

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  const re = /\s*(?:(\d+)|([A-Za-z_]\w*)|([+\-*/%()]))/y;
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
  constructor(private tokens: Token[], private env: ReadonlyMap<string, number>) {}
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
    if (t.kind === "ident") { this.i++; return this.env.get(t.name) ?? null; }
    if (t.kind === "op" && t.op === "(") {
      this.i++;
      const v = this.expr();
      if (v === null || !this.peekOp(")")) return null;
      this.i++;
      return v;
    }
    return null;
  }
}
