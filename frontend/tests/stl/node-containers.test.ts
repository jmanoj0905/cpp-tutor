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

function displayValues(c: NormalizedCell): string[] {
  return (c.children ?? []).map((ch) => ch.displayValue);
}

function sorted(values: string[]): string[] {
  return [...values].sort();
}

function pairRows(c: NormalizedCell): string[] {
  return (c.children ?? []).map((row) => {
    const first = row.children?.find((ch) => ch.name === "first")?.displayValue;
    const second = row.children?.find((ch) => ch.name === "second")?.displayValue;
    return `${first}->${second}`;
  });
}

describe("node-based STL containers", () => {
  it("recovers std::map as sorted key/value rows", () => {
    const m = bestCell("m");
    expect(m.kind).toBe("container");
    expect(m.containerKind).toBe("map");
    expect(m.length).toBe(2);
    expect(m.placeholders).toBeFalsy();
    expect(m.displayValue).toBe("map<int,int> · 2");
    expect(pairRows(m)).toEqual(["1->10", "2->20"]);
    // raw guts gone:
    expect((m.children ?? []).some((ch) => ch.name === "_M_t")).toBe(false);
  });

  it("recovers std::set as sorted values", () => {
    const s = bestCell("s");
    expect(s.containerKind).toBe("set");
    expect(s.length).toBe(3);
    expect(s.displayValue).toBe("set<int> · 3");
    expect(s.placeholders).toBeFalsy();
    expect(displayValues(s)).toEqual(["7", "8", "9"]);
  });

  it("recovers std::multimap and std::multiset duplicates", () => {
    const mm = bestCell("mm");
    expect(mm.containerKind).toBe("multimap");
    expect(mm.length).toBe(3);
    expect(mm.displayValue).toBe("multimap<int,int> · 3");
    expect(mm.placeholders).toBeFalsy();
    expect(pairRows(mm)).toEqual(["1->10", "1->11", "2->20"]);

    const ms = bestCell("ms");
    expect(ms.containerKind).toBe("multiset");
    expect(ms.length).toBe(3);
    expect(ms.displayValue).toBe("multiset<int> · 3");
    expect(ms.placeholders).toBeFalsy();
    expect(displayValues(ms)).toEqual(["7", "7", "8"]);
  });

  it("recovers std::unordered_map as key/value rows", () => {
    const um = bestCell("um");
    expect(um.containerKind).toBe("unordered_map");
    expect(um.length).toBe(2);
    expect(um.displayValue).toBe("unordered_map<int,int> · 2");
    expect(um.placeholders).toBeFalsy();
    expect(sorted(pairRows(um))).toEqual(["5->50", "6->60"]);
  });

  it("recovers unordered set-like duplicates", () => {
    const us = bestCell("us");
    expect(us.containerKind).toBe("unordered_set");
    expect(us.length).toBe(2);
    expect(us.displayValue).toBe("unordered_set<int> · 2");
    expect(us.placeholders).toBeFalsy();
    expect(sorted(displayValues(us))).toEqual(["10", "11"]);

    const ums = bestCell("ums");
    expect(ums.containerKind).toBe("unordered_multiset");
    expect(ums.length).toBe(3);
    expect(ums.displayValue).toBe("unordered_multiset<int> · 3");
    expect(ums.placeholders).toBeFalsy();
    expect(sorted(displayValues(ums))).toEqual(["10", "10", "11"]);
  });

  it("recovers std::unordered_multimap duplicate-key rows", () => {
    const umm = bestCell("umm");
    expect(umm.containerKind).toBe("unordered_multimap");
    expect(umm.length).toBe(3);
    expect(umm.displayValue).toBe("unordered_multimap<int,int> · 3");
    expect(umm.placeholders).toBeFalsy();
    expect(sorted(pairRows(umm))).toEqual(["5->50", "5->51", "6->60"]);
  });

  it("recovers real values for a populated std::list by walking its node chain", () => {
    const l = bestCell("l");
    expect(l.containerKind).toBe("list");
    expect(l.length).toBe(3);
    expect(l.displayValue).toBe("list<int> · 3");
    expect(l.placeholders).toBeFalsy();
    expect(displayValues(l)).toEqual(["1", "2", "3"]);
  });

  it("renders a default-constructed empty std::list as · 0", () => {
    const e = bestCell("empty");
    expect(e.containerKind).toBe("list");
    expect(e.length).toBe(0);
    expect(e.children ?? []).toEqual([]);
    expect(e.displayValue).toBe("list<int> · 0");
  });

  it("recovers real values for std::forward_list by walking its node chain", () => {
    const fl = bestCell("fl");
    expect(fl.containerKind).toBe("forward_list");
    expect(fl.length).toBe(3);
    expect(fl.displayValue).toBe("forward_list<int> · 3");
    expect(fl.placeholders).toBeFalsy();
    expect(displayValues(fl)).toEqual(["4", "5", "6"]);
  });
});
