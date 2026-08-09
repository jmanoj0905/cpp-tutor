import { describe, expect, it } from "vitest";
import mapMemo from "./fixtures/dp/map-memo.json";
import type { Trace } from "../src/types/trace";
import { collectKeyedWrites } from "../src/viz/dp/keyedWrites";
import { keyedRead } from "../src/viz/dp/writes";
import { buildStatements } from "../src/viz/dp/statements";

const t = mapMemo as Trace;
const collect = () => {
  const codeLines = t.code.split("\n");
  return collectKeyedWrites(t.trace, codeLines, buildStatements(codeLines));
};

describe("collectKeyedWrites", () => {
  it("tracks the memo map by key, not by positional cell id", () => {
    const memo = [...collect().values()].find((k) => k.name === "memo");
    expect(memo).toBeDefined();
    expect(memo!.keyed).toBe(true);
    // fixture runs fib(4): memoizes n = 2..4 exactly once each
    expect(memo!.keyOrder).toEqual(["2", "3", "4"]);
    expect(memo!.writes).toHaveLength(3);
  });

  it("reports each key written exactly once despite rehashing", () => {
    const memo = [...collect().values()].find((k) => k.name === "memo")!;
    const coords = memo.writes.map((w) => w.coord.join(","));
    expect(new Set(coords).size).toBe(coords.length);
  });

  // What actually makes map-memo self-referential is line 7's guard,
  // `if (memo.count(n)) return memo[n];` — a control statement the frame
  // already executed before the write, which hands the memo's OWN subscript
  // straight back. The write statement itself (`memo[n] = fib(n-1) +
  // fib(n-2);`) carries exactly one subscript and is deliberately NOT
  // evidence (see keyedWrites.ts's countSubscripts >= 2 floor).
  it("takes its self-reference from the memo guard, not from the write statement", () => {
    const memo = [...collect().values()].find((k) => k.name === "memo")!;
    expect(memo.selfRefSteps.size).toBe(3);

    // Blank the guard line and the evidence disappears entirely — proof the
    // guard is what carries it, and that the write statement alone does not.
    const codeLines = t.code.split("\n");
    expect(codeLines[6]).toContain("memo.count(n)");
    const withoutGuard = [...codeLines];
    withoutGuard[6] = "";
    const neutered = collectKeyedWrites(t.trace, withoutGuard, buildStatements(withoutGuard));
    const memoNoGuard = [...neutered.values()].find((k) => k.name === "memo")!;
    expect(memoNoGuard.writeSteps.size).toBe(3);   // same writes...
    expect(memoNoGuard.selfRefSteps.size).toBe(0); // ...but no self-reference
  });

  // The `.count(`/`.find(` arm of `keyedRead` is the map-specific part of the
  // matcher: a memo guard that never subscripts the table at all. map-memo's
  // own guard also contains `return memo[n]`, so it is accepted by the
  // return-narrowing branch before the matcher runs — this unit test is what
  // pins the lookup-only arm.
  it("keyedRead accepts a lookup-only guard that never subscripts the table", () => {
    expect(keyedRead("if (memo.count(n)) {", "memo")).toBe(true);
    expect(keyedRead("if (memo.find(n) != memo.end()) {", "memo")).toBe(true);
    expect(keyedRead("if (other.count(n)) {", "memo")).toBe(false);
    expect(keyedRead("memo[n] = 1;", "memo")).toBe(true);
  });
});
