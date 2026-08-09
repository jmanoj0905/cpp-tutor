import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import { parseTraceJson } from "../../src/api/client";
import type { ExecPoint, Trace } from "../../src/types/trace";
// Raw import + parseTraceJson: vector<bool> packs bits into 64-bit _Bit_type
// words that can exceed Number.MAX_SAFE_INTEGER, so a plain JSON import would
// corrupt them exactly as fetch().json() would.
import raw from "../fixtures/stl/vector-vector-bool.json?raw";

const fixture = parseTraceJson(raw) as Trace;

// `vector<vector<bool>> visited(4, vector<bool>(4, false)); visited[1][2] = true;`
// The inner vectors are copy-constructed from a temporary, so each 64-bit word
// has only its 4 live bits defined and the padding bits undefined. Before the
// tracer's partial-defined fix, the whole word came back "<UNINITIALIZED>" and
// every element rendered as "?". Select the final step where `visited` is live.
function lastStepWithVisited(): ExecPoint {
  const steps = fixture.trace as ExecPoint[];
  return [...steps]
    .reverse()
    .find((s) => (s.stack_to_render as any)?.[0]?.encoded_locals?.visited)!;
}

describe("vector<vector<bool>> decoder", () => {
  it("decodes each inner vector<bool> to concrete true/false values", () => {
    const m = normalizeMemory(lastStepWithVisited());
    const visited = m.frames[0].cells.find((c) => c.name === "visited")!;
    expect(visited.containerKind).toBe("vector");
    expect(visited.length).toBe(4);

    const rows = visited.children!.map((row) =>
      row.children!.map((c) => c.displayValue),
    );
    // 4x4 grid, all false except visited[1][2].
    expect(rows).toEqual([
      ["false", "false", "false", "false"],
      ["false", "false", "true", "false"],
      ["false", "false", "false", "false"],
      ["false", "false", "false", "false"],
    ]);
  });

  it("renders no ? placeholders (padding bits must not poison live bits)", () => {
    const m = normalizeMemory(lastStepWithVisited());
    const visited = m.frames[0].cells.find((c) => c.name === "visited")!;
    const all = visited.children!.flatMap((row) =>
      row.children!.map((c) => c.displayValue),
    );
    expect(all).not.toContain("?");
  });
});
