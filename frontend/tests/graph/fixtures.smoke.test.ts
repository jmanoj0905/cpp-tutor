import { describe, it, expect } from "vitest";
import dfsList from "../fixtures/graph/dfs_list.json";
import graphs from "../fixtures/graph/graphs.json";
import islands from "../fixtures/graph/islands.json";
import rotting from "../fixtures/graph/rotting.json";

describe("graph fixtures", () => {
  it.each([
    ["dfs_list", dfsList],
    ["graphs", graphs],
    ["islands", islands],
    ["rotting", rotting],
  ])("%s parses with a non-empty trace", (_name, fx: any) => {
    expect(typeof fx.code).toBe("string");
    expect(Array.isArray(fx.trace)).toBe(true);
    expect(fx.trace.length).toBeGreaterThan(0);
    expect(fx.trace[0]).toHaveProperty("line");
  });
});
