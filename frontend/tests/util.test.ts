import { describe, it, expect } from "vitest";
import { escapeRe, toggleInSet } from "../src/util";

describe("escapeRe", () => {
  it("escapes every regex metacharacter", () => {
    expect(escapeRe("a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o")).toBe(
      "a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o",
    );
  });

  it("makes a C++ identifier safe to embed in a RegExp", () => {
    // dp[i][j] as a literal, not "dp" followed by a character class
    const re = new RegExp(escapeRe("dp[i]"));
    expect(re.test("dp[i]")).toBe(true);
    expect(re.test("dpi")).toBe(false);
  });

  it("leaves plain identifiers untouched", () => {
    expect(escapeRe("memo_1")).toBe("memo_1");
  });
});

describe("toggleInSet", () => {
  it("adds a missing member", () => {
    expect([...toggleInSet(new Set<number>(), 5)]).toEqual([5]);
  });

  it("removes a present member", () => {
    expect([...toggleInSet(new Set([5]), 5)]).toEqual([]);
  });

  it("returns a new set and never mutates the input", () => {
    const input = new Set([1, 2]);
    const out = toggleInSet(input, 2);
    expect(out).not.toBe(input);
    expect([...input]).toEqual([1, 2]);
    expect([...out]).toEqual([1]);
  });

  it("works for string members too", () => {
    expect([...toggleInSet(new Set(["a"]), "b")]).toEqual(["a", "b"]);
  });
});
