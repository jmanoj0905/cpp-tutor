import { describe, it, expect } from "vitest";
import { findCellById, flattenCells, mapCellIds, allRoots } from "../src/viz/cells";
import type { NormalizedCell, NormalizedMemory } from "../src/viz/memoryModel";

const leaf = (id: string, name = id): NormalizedCell =>
  ({ id, name, kind: "scalar", displayValue: id }) as NormalizedCell;

const withKids = (id: string, children: NormalizedCell[]): NormalizedCell =>
  ({ id, name: id, kind: "struct", displayValue: "", children }) as NormalizedCell;

describe("findCellById", () => {
  it("finds a top-level cell", () => {
    expect(findCellById([leaf("a"), leaf("b")], "b")?.id).toBe("b");
  });

  it("descends into children", () => {
    const tree = [withKids("v", [leaf("v-0"), withKids("v-1", [leaf("deep")])])];
    expect(findCellById(tree, "deep")?.id).toBe("deep");
  });

  it("returns null when absent", () => {
    expect(findCellById([leaf("a")], "missing")).toBeNull();
  });
});

describe("flattenCells", () => {
  it("returns every cell, parents before their children", () => {
    const tree = [withKids("p", [leaf("c1"), withKids("c2", [leaf("g")])])];
    expect(flattenCells(tree).map((c) => c.id)).toEqual(["p", "c1", "c2", "g"]);
  });

  it("handles cells with no children key", () => {
    expect(flattenCells([leaf("a")]).map((c) => c.id)).toEqual(["a"]);
  });
});

describe("mapCellIds", () => {
  it("rewrites a whole subtree with the derived id", () => {
    const tree = withKids("v", [leaf("v-0"), withKids("v-1", [leaf("v-1-x")])]);
    const out = mapCellIds(tree, (id) => `pfx:${id}`);
    expect(out.id).toBe("pfx:v");
    expect(out.children![0].id).toBe("pfx:v-0");
    expect(out.children![1].children![0].id).toBe("pfx:v-1-x");
  });

  it("does not mutate the source tree", () => {
    const tree = withKids("v", [leaf("v-0")]);
    mapCellIds(tree, (id) => `x${id}`);
    expect(tree.id).toBe("v");
    expect(tree.children![0].id).toBe("v-0");
  });

  it("preserves every non-id field", () => {
    const out = mapCellIds(leaf("a", "myName"), (id) => `p${id}`);
    expect(out.name).toBe("myName");
    expect(out.displayValue).toBe("a");
  });
});

describe("allRoots", () => {
  it("concatenates globals, every frame's cells, and the heap", () => {
    const mem = {
      globals: [leaf("g")],
      frames: [{ id: "f0", name: "main", cells: [leaf("a")] },
               { id: "f1", name: "fib", cells: [leaf("b")] }],
      heap: [leaf("h")],
      links: [],
    } as unknown as NormalizedMemory;
    expect(allRoots(mem).map((c) => c.id)).toEqual(["g", "a", "b", "h"]);
  });
});
