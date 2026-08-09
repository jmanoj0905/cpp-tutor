import { describe, expect, it } from "vitest";
import mapMemo from "./fixtures/dp/map-memo.json";
import type { Trace } from "../src/types/trace";
import { collectKeyedWrites } from "../src/viz/dp/keyedWrites";
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

  it("marks the memo writes self-referential via the count guard", () => {
    const memo = [...collect().values()].find((k) => k.name === "memo")!;
    expect(memo.selfRefSteps.size).toBeGreaterThanOrEqual(2);
  });
});
