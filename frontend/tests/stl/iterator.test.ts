import { describe, it, expect } from "vitest";
import { iteratorDecoder } from "../../src/viz/stl/iterator";
import type { NormalizedCell } from "../../src/viz/memoryModel";
import { normalizeMemory } from "../../src/viz/memoryModel";
import type { ExecPoint } from "../../src/types/trace";
import iterFixture from "../fixtures/stl/iterator.json";

function refMember(name: string, target: string): NormalizedCell {
  return { id: name, name, source: "stack", kind: "reference", address: "0x1",
    type: "pointer", displayValue: `-> ${target}`, rawValue: null, targetAddress: target };
}

function iterCell(type: string, ptrName: string, target: string): NormalizedCell {
  return { id: "it", name: "it", source: "stack", kind: "struct", address: "0x1", type,
    displayValue: type, rawValue: null, children: [refMember(ptrName, target)] };
}

const ctx = { heapByAddress: new Map(), consumed: new Set<string>() };

describe("iteratorDecoder", () => {
  it("matches __normal_iterator and targets _M_current", () => {
    const type = "__gnu_cxx::__normal_iterator<int*, std::vector<int> >";
    expect(iteratorDecoder.match(type)).toBe(true);
    const out = iteratorDecoder.decode(iterCell(type, "_M_current", "0x9020"), ctx)!;
    expect(out.kind).toBe("reference");
    expect(out.containerKind).toBe("iterator");
    expect(out.targetAddress).toBe("0x9020");
  });
  it("matches _Deque_iterator and targets _M_cur", () => {
    const type = "std::_Deque_iterator<int, int&, int*>";
    expect(iteratorDecoder.match(type)).toBe(true);
    const out = iteratorDecoder.decode(iterCell(type, "_M_cur", "0x9100"), ctx)!;
    expect(out.targetAddress).toBe("0x9100");
  });
  it("returns null when the pointer is absent or null", () => {
    const type = "__gnu_cxx::__normal_iterator<int*, std::vector<int> >";
    expect(iteratorDecoder.decode(iterCell(type, "_M_current", "0x0"), ctx)).toBeNull();
    const noPtr: NormalizedCell = { id: "it", name: "it", source: "stack", kind: "struct",
      address: "0x1", type, displayValue: type, rawValue: null, children: [] };
    expect(iteratorDecoder.decode(noPtr, ctx)).toBeNull();
  });
  it("does not match unrelated types", () => {
    expect(iteratorDecoder.match("std::vector<int>")).toBe(false);
  });
});

describe("iterator fixture (real trace)", () => {
  it("links it and p to a v element cell", () => {
    const steps = (iterFixture as any).trace as ExecPoint[];
    const point = [...steps].reverse().find(
      (s) => (s.stack_to_render as any)?.[0]?.encoded_locals?.it,
    )!;
    const m = normalizeMemory(point);
    const v = m.frames[0].cells.find((c) => c.name === "v")!;
    const elemIds = new Set((v.children ?? []).map((c) => c.id));
    const itLink = m.links.find((l) => l.fromName === "it");
    const pLink = m.links.find((l) => l.fromName === "p");
    expect(itLink && elemIds.has(itLink.toId)).toBe(true);
    expect(pLink && elemIds.has(pLink.toId)).toBe(true);
  });
});
