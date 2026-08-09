import { describe, expect, it } from "vitest";
import frogJump from "./fixtures/dp/frog-jump.json";
import houseRobberIi from "./fixtures/dp/house-robber-ii.json";
import type { Trace } from "../src/types/trace";
import { collectWrites } from "../src/viz/dp/writes";
import { buildStatements } from "../src/viz/dp/statements";

const collect = (t: Trace) => {
  const codeLines = t.code.split("\n");
  return collectWrites(t.trace, codeLines, buildStatements(codeLines));
};

describe("collectWrites", () => {
  it("tracks the dp array with its writes, dims and writing function", () => {
    const tracked = [...collect(frogJump as Trace).values()];
    const dp = tracked.find((t) => t.name === "dp");
    expect(dp).toBeDefined();
    expect(dp!.maxDims).toEqual([5]);
    expect(dp!.writes.length).toBeGreaterThanOrEqual(5);
    expect(dp!.writeFuncs.size).toBe(1);
    expect(dp!.keyed).toBe(false);
  });

  it("records self-referential write steps as a subset of write steps", () => {
    const dp = [...collect(frogJump as Trace).values()].find((t) => t.name === "dp")!;
    expect(dp.selfRefSteps.size).toBeGreaterThan(0);
    expect(dp.selfRefSteps.size).toBeLessThanOrEqual(dp.writeSteps.size);
    for (const s of dp.selfRefSteps) expect(dp.writeSteps.has(s)).toBe(true);
  });

  it("tracks nothing for a program with no array writes", () => {
    const tracked = [...collect(houseRobberIi as Trace).values()];
    expect(tracked.every((t) => t.name !== "dp")).toBe(true);
  });
});
