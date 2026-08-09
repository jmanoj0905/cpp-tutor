import { describe, expect, it } from "vitest";
import { buildStatements, statementAtExecLine } from "../src/viz/dp/statements";

const lines = (s: string) => s.split("\n");

describe("buildStatements", () => {
  it("returns a single-line statement unchanged apart from whitespace", () => {
    const out = buildStatements(lines("  dp[i] = dp[i-1] + dp[i-2];"));
    expect(out[0]).toBe("dp[i] = dp[i-1] + dp[i-2];");
  });

  it("joins a recurrence split across lines", () => {
    const src = lines([
      "dp[i] = min(",
      "    dp[i-1] + abs(h[i] - h[i-1]),",
      "    dp[i-2] + abs(h[i] - h[i-2])",
      ");",
    ].join("\n"));
    expect(buildStatements(src)[0])
      .toBe("dp[i] = min( dp[i-1] + abs(h[i] - h[i-1]), dp[i-2] + abs(h[i] - h[i-2]) );");
  });

  it("terminates a control statement at its opening brace", () => {
    const src = lines("if (dp[n] != -1) {\n    return dp[n];\n}");
    expect(buildStatements(src)[0]).toBe("if (dp[n] != -1) {");
    expect(buildStatements(src)[1]).toBe("return dp[n];");
  });

  it("joins a condition split across lines", () => {
    const src = lines("if (s[i] == s[j]\n    && dp[i+1][j-1]) {\n  dp[i][j] = true;\n}");
    expect(buildStatements(src)[0]).toBe("if (s[i] == s[j] && dp[i+1][j-1]) {");
  });

  it("stops after 8 lines rather than running away on unbalanced source", () => {
    const src = lines(["f(", "1,", "2,", "3,", "4,", "5,", "6,", "7,", "8,", "9,"].join("\n"));
    expect(buildStatements(src)[0].split(" ").length).toBeLessThanOrEqual(9);
    expect(buildStatements(src)).toHaveLength(10);
  });

  it("ignores brackets inside string and char literals", () => {
    const src = lines('printf("dp[%d) = ", i);\nnext();');
    expect(buildStatements(src)[0]).toBe('printf("dp[%d) = ", i);');
  });

  it("drops a trailing comment so its subscripts never count as code", () => {
    const src = lines("dp[i] = 1; // dp[i-1] + dp[i-2]\ndp[j] = 2;");
    expect(buildStatements(src)[0]).toBe("dp[i] = 1;");
  });

  it("joins a recurrence split by a bare operator continuation, no bracket ever open", () => {
    const src = lines("dp[i] = dp[i-1]\n      + dp[i-2];");
    expect(buildStatements(src)[0]).toBe("dp[i] = dp[i-1] + dp[i-2];");
  });
});

describe("statementAtExecLine", () => {
  it("resolves the closing line of a paren-continued recurrence to the full statement", () => {
    const src = lines([
      "dp[i] = min(",
      "    dp[i-1] + abs(h[i] - h[i-1]),",
      "    dp[i-2] + abs(h[i] - h[i-2])",
      ");",
    ].join("\n"));
    const statements = buildStatements(src);
    expect(statementAtExecLine(src, statements, 4))
      .toBe("dp[i] = min( dp[i-1] + abs(h[i] - h[i-1]), dp[i-2] + abs(h[i] - h[i-2]) );");
  });

  it("resolves the continuation line of a bare operator split to the full statement", () => {
    const src = lines("dp[i] = dp[i-1]\n      + dp[i-2];");
    const statements = buildStatements(src);
    expect(statementAtExecLine(src, statements, 2)).toBe("dp[i] = dp[i-1] + dp[i-2];");
  });

  it("does not fuse a bodyless if-header into the independent statement that follows it", () => {
    const src = lines([
      "if (coins[k] <= a && dp[a - coins[k]] + 1 < dp[a])",
      "  dp[a] = dp[a - coins[k]] + 1;",
    ].join("\n"));
    const statements = buildStatements(src);
    // statements[0] (buildStatements' own, unmodified text for the header's
    // start) legitimately fuses the two — that's the guard idiom. But
    // resolving the ASSIGNMENT's own exec line must return just the
    // assignment, not the fused header+assignment text.
    expect(statementAtExecLine(src, statements, 2)).toBe("dp[a] = dp[a - coins[k]] + 1;");
  });

  it("falls back to the line's own statement when no earlier start reaches it", () => {
    const src = lines("dp[i] = 1;\ndp[j] = 2;");
    const statements = buildStatements(src);
    expect(statementAtExecLine(src, statements, 2)).toBe("dp[j] = 2;");
  });
});
