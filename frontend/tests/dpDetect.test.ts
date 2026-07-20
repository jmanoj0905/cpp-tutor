import { describe, expect, it } from "vitest";
import climbBottomup from "./fixtures/dp/climb-bottomup.json";
import climbTopdown from "./fixtures/dp/climb-topdown.json";
import gridPaths from "./fixtures/dp/grid-paths.json";
import inputFill from "./fixtures/dp/input-fill.json";
import type { Trace } from "../src/types/trace";
import { detectDpTables } from "../src/viz/dp/detect";

const detect = (t: Trace) => detectDpTables(t.trace, t.code);

describe("detectDpTables", () => {
  it("climb-bottomup: confirms dp as 1D bottom-up with chronological writes", () => {
    const [c, ...rest] = detect(climbBottomup as Trace);
    expect(rest).toEqual([]);
    expect(c.name).toBe("dp");
    expect(c.mode).toBe("bottom-up");
    expect(c.dims).toEqual([7]);
    expect(c.writes.length).toBeGreaterThanOrEqual(5); // dp[2..6] at least
    const steps = c.writes.map((w) => w.step);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(c.writes.at(-1)!.coord).toEqual([6]);
  });

  it("climb-topdown: confirms memo as top-down", () => {
    const [c] = detect(climbTopdown as Trace);
    expect(c.name).toBe("memo");
    expect(c.mode).toBe("top-down");
  });

  it("grid-paths: confirms dp as 2D with [3,4] dims and 2D coords", () => {
    const [c] = detect(gridPaths as Trace);
    expect(c.dims).toEqual([3, 4]);
    expect(c.writes.at(-1)!.coord).toEqual([2, 3]);
  });

  it("input-fill: confirms nothing (no self-reads)", () => {
    expect(detect(inputFill as Trace)).toEqual([]);
  });
});
