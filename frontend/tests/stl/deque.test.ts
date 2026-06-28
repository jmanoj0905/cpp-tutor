import { describe, it, expect } from "vitest";
import { normalizeMemory } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";
import fixture from "../fixtures/stl/deque.json";

describe("deque decoder", () => {
  it("decodes elements front-to-back", () => {
    const steps = (fixture as any).trace as ExecPoint[];
    const step = [...steps].reverse().find(
      (s) => (s.stack_to_render as any)?.[0]?.encoded_locals?.d)!;
    const d = normalizeMemory(step).frames[0].cells.find((c) => c.name === "d")!;
    expect(d.containerKind).toBe("deque");
    expect(d.children?.map((c) => c.displayValue)).toEqual(["0", "1", "2"]);
  });
});
