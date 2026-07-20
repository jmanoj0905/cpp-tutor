import { describe, expect, it } from "vitest";
import climbBottomup from "./fixtures/dp/climb-bottomup.json";
import climbTopdown from "./fixtures/dp/climb-topdown.json";
import gridPaths from "./fixtures/dp/grid-paths.json";
import inputFill from "./fixtures/dp/input-fill.json";
import type { Trace } from "../src/types/trace";

const fixtures: [string, Trace][] = [
  ["climb-bottomup", climbBottomup as Trace],
  ["climb-topdown", climbTopdown as Trace],
  ["grid-paths", gridPaths as Trace],
  ["input-fill", inputFill as Trace],
];

describe("dp fixtures", () => {
  it.each(fixtures)("%s traces to completion with >10 steps", (_n, t) => {
    expect(t.trace.length).toBeGreaterThan(10);
    expect(t.code.length).toBeGreaterThan(0);
    expect(t.trace.some((p) => p.event === "return" || p.event === "step_line")).toBe(true);
  });
});
