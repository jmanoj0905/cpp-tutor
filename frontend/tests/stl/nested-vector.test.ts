import { describe, it, expect } from "vitest";
import { normalizeMemory, type NormalizedCell } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";
import matrixFixture from "../fixtures/stl/matrix.json";

// Real backend trace of: std::vector<std::vector<int>> m = {{1,2,3},{4,5,6}};
const steps = (matrixFixture as { trace: ExecPoint[] }).trace;

/** Decode `name` at the step with the largest recovered outer length. */
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

describe("nested std::vector<std::vector<int>>", () => {
  it("decodes the outer vector's elements as inner vectors, not scalars", () => {
    const m = bestCell("m");
    expect(m.containerKind).toBe("vector");
    expect(m.length).toBe(2);
    // Each outer element is itself a vector<int>, NOT a scalar int.
    const rows = m.children ?? [];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.containerKind).toBe("vector");
      expect(row.kind).toBe("container");
    }
  });

  it("recovers the inner row values {1,2,3} and {4,5,6}", () => {
    const m = bestCell("m");
    const rows = m.children ?? [];
    expect((rows[0].children ?? []).map((c) => c.displayValue)).toEqual(["1", "2", "3"]);
    expect((rows[1].children ?? []).map((c) => c.displayValue)).toEqual(["4", "5", "6"]);
  });
});
