import { describe, it, expect } from "vitest";
import { normalizeMemory, type NormalizedCell } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";
import fixture from "../fixtures/stl/node-containers.json";

const steps = (fixture as any).trace as ExecPoint[];

/** Decode `name` at every step; return the cell with the largest recovered
 *  length (dodges partial heap snapshots that under-count). */
function bestCell(name: string): NormalizedCell {
  let best: NormalizedCell | undefined;
  for (const s of steps) {
    const locs = (s.stack_to_render as any)?.[0]?.encoded_locals;
    if (!locs?.[name]) continue;
    const c = normalizeMemory(s).frames[0].cells.find((x) => x.name === name);
    if (c && (!best || (c.length ?? -1) > (best.length ?? -1))) best = c;
  }
  return best!;
}

const allPlaceholders = (c: NormalizedCell) =>
  (c.children ?? []).every((ch) => /^\[\d+\]$/.test(ch.name) && ch.displayValue === "?");

describe("node-based STL containers", () => {
  it("collapses std::map into a sized container with placeholder entries", () => {
    const m = bestCell("m");
    expect(m.kind).toBe("container");
    expect(m.containerKind).toBe("map");
    expect(m.length).toBe(2);
    expect(m.placeholders).toBe(true);
    expect(m.displayValue).toBe("map<int,int> · 2");
    expect(allPlaceholders(m)).toBe(true);
    // raw guts gone:
    expect((m.children ?? []).some((ch) => ch.name === "_M_t")).toBe(false);
  });

  it("collapses std::set into a sized container", () => {
    const s = bestCell("s");
    expect(s.containerKind).toBe("set");
    expect(s.length).toBe(3);
    expect(s.displayValue).toBe("set<int> · 3");
    expect(allPlaceholders(s)).toBe(true);
  });

  it("collapses std::unordered_map into a sized container", () => {
    const um = bestCell("um");
    expect(um.containerKind).toBe("unordered_map");
    expect(um.length).toBe(2);
    expect(um.displayValue).toBe("unordered_map<int,int> · 2");
    expect(allPlaceholders(um)).toBe(true);
  });

  it("collapses a populated std::list by walking its node chain", () => {
    const l = bestCell("l");
    expect(l.containerKind).toBe("list");
    expect(l.length).toBe(3);
    expect(l.displayValue).toBe("list<int> · 3");
    expect(allPlaceholders(l)).toBe(true);
  });

  it("renders a default-constructed empty std::list as · 0", () => {
    const e = bestCell("empty");
    expect(e.containerKind).toBe("list");
    expect(e.length).toBe(0);
    expect(e.children ?? []).toEqual([]);
    expect(e.displayValue).toBe("list<int> · 0");
  });
});
