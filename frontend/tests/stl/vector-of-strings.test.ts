import { describe, it, expect } from "vitest";
import { normalizeMemory, type NormalizedCell } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";
import vectorOfStringsFixture from "../fixtures/stl/vector-of-strings.json";

// Real backend trace of:
//   std::vector<std::string> words;
//   words.push_back("alpha"); words.push_back("beta"); words.push_back("gamma");
const steps = (vectorOfStringsFixture as { trace: ExecPoint[] }).trace;

/** Decode `name` at the step with the largest recovered length. */
function bestCell(name: string): NormalizedCell {
  let best: NormalizedCell | undefined;
  for (const s of steps) {
    const locs = (s.stack_to_render as { encoded_locals?: Record<string, unknown> }[] | undefined)?.[0]?.encoded_locals;
    if (!locs?.[name]) continue;
    const c = normalizeMemory(s).frames[0].cells.find((x) => x.name === name);
    if (c && (!best || (c.length ?? -1) > (best.length ?? -1))) best = c;
  }
  return best!;
}

describe("std::vector<std::string>", () => {
  it("decodes the outer vector's elements as strings, not scalars", () => {
    const words = bestCell("words");
    expect(words.kind).toBe("container");
    expect(words.containerKind).toBe("vector");
    expect(words.length).toBe(3);

    const elems = words.children ?? [];
    expect(elems).toHaveLength(3);
    for (const e of elems) {
      expect(e.kind).toBe("container");
      expect(e.containerKind).toBe("string");
    }
  });

  it("recovers the string values in insertion order", () => {
    const words = bestCell("words");
    const elems = words.children ?? [];
    expect(elems.map((e) => e.displayValue)).toEqual(['"alpha"', '"beta"', '"gamma"']);
  });

  it("exposes each string's characters as indexed children", () => {
    const words = bestCell("words");
    const [alpha, beta, gamma] = words.children ?? [];

    expect((alpha.children ?? []).map((c) => c.displayValue)).toEqual(["a", "l", "p", "h", "a"]);
    expect((beta.children ?? []).map((c) => c.displayValue)).toEqual(["b", "e", "t", "a"]);
    expect((gamma.children ?? []).map((c) => c.displayValue)).toEqual(["g", "a", "m", "m", "a"]);
  });
});
