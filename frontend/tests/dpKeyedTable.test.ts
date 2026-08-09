import { describe, expect, it } from "vitest";
import { projectKeys } from "../src/viz/dp/keyedTable";

describe("projectKeys", () => {
  it("lays integer keys out as a sparse 1D grid indexed by the key", () => {
    const p = projectKeys(["2", "3", "6"]);
    expect(p.dims).toEqual([7]);
    expect(p.coordOfKey.get("6")).toEqual([6]);
    expect(p.labelAt.get("6")).toBe("6");
    expect(p.numeric).toBe(true);
  });

  it("lays pair keys out as a sparse 2D grid", () => {
    const p = projectKeys(["(0, 1)", "(2, 3)"]);
    expect(p.dims).toEqual([3, 4]);
    expect(p.coordOfKey.get("(2, 3)")).toEqual([2, 3]);
    expect(p.labelAt.get("2,3")).toBe("(2, 3)");
    expect(p.numeric).toBe(false);
  });

  it("falls back to first-write order for keys of any other shape", () => {
    const p = projectKeys(["abc", "de"]);
    expect(p.dims).toEqual([2]);
    expect(p.coordOfKey.get("de")).toEqual([1]);
    expect(p.labelAt.get("1")).toBe("de");
    expect(p.numeric).toBe(false);
  });

  it("treats negative integer keys as the fallback shape", () => {
    const p = projectKeys(["-1", "2"]);
    expect(p.numeric).toBe(false);
    expect(p.dims).toEqual([2]);
  });

  it("returns an empty projection for no keys", () => {
    const p = projectKeys([]);
    expect(p.dims).toEqual([0]);
    expect(p.coordOfKey.size).toBe(0);
  });
});
