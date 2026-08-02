import { describe, expect, it } from "vitest";
import { isBentoCell } from "../src/viz/memoryModel";
import type { NormalizedCell } from "../src/viz/memoryModel";

const base = (over: Partial<NormalizedCell>): NormalizedCell => ({
  id: "x", name: "x", source: "stack", kind: "scalar", address: null,
  type: null, displayValue: "", rawValue: null, ...over,
});

describe("isBentoCell", () => {
  it("is true for a plain struct", () => {
    expect(isBentoCell(base({ kind: "struct" }))).toBe(true);
  });
  it("is true for a pair container", () => {
    expect(isBentoCell(base({ kind: "container", containerKind: "pair" }))).toBe(true);
  });
  it("is true for a tuple container", () => {
    expect(isBentoCell(base({ kind: "container", containerKind: "tuple" }))).toBe(true);
  });
  it("is false for a vector/array container", () => {
    expect(isBentoCell(base({ kind: "container", containerKind: "vector" }))).toBe(false);
    expect(isBentoCell(base({ kind: "array" }))).toBe(false);
  });
  it("is false for a map container", () => {
    expect(isBentoCell(base({ kind: "container", containerKind: "map" }))).toBe(false);
  });
  it("is false for scalars, references, summaries", () => {
    expect(isBentoCell(base({ kind: "scalar" }))).toBe(false);
    expect(isBentoCell(base({ kind: "reference" }))).toBe(false);
    expect(isBentoCell(base({ kind: "summary" }))).toBe(false);
  });
});
