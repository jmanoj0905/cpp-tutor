import { describe, expect, it } from "vitest";
import climbBottomup from "./fixtures/dp/climb-bottomup.json";
import gridPaths from "./fixtures/dp/grid-paths.json";
import type { Trace } from "../src/types/trace";
import { detectDpTables } from "../src/viz/dp/detect";
import { buildCone } from "../src/viz/dp/cone";

// dp[i] = dp[i - 1] + dp[i - 2]
const t = climbBottomup as Trace;
const codeLines = t.code.split("\n");
const [cand] = detectDpTables(t.trace, t.code);
const cone = buildCone(cand, t.trace, codeLines);

describe("buildCone", () => {
  it("records the operands a written cell was computed from", () => {
    expect(cone.get("4")?.operands).toEqual([[3], [2]]);
  });

  it("records the cells that were later computed from a given cell", () => {
    expect(cone.get("2")?.dependents).toEqual([[3], [4]]);
  });

  it("gives a base case no operands", () => {
    expect(cone.get("0")?.operands ?? []).toEqual([]);
  });

  it("never lists a cell as its own operand", () => {
    for (const [coordKey, edges] of cone) {
      expect(edges.operands.map((c) => c.join(","))).not.toContain(coordKey);
    }
  });
});

describe("buildCone: 2D table (grid-paths fixture)", () => {
  const g = gridPaths as Trace;
  const gCand = detectDpTables(g.trace, g.code)[0];
  const gCone = buildCone(gCand, g.trace, g.code.split("\n"));

  it("resolves 2D operands as the cell above and the cell to the left", () => {
    expect(gCone.get("2,3")?.operands).toEqual([[1, 3], [2, 2]]);
  });

  it("makes the dependent edge the mirror of the operand edge", () => {
    expect(gCone.get("1,3")?.dependents).toContainEqual([2, 3]);
  });
});
