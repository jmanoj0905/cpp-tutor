import { describe, it, expect } from "vitest";
import { iteratorDecoder } from "../../src/viz/stl/iterator";
import type { NormalizedCell } from "../../src/viz/memoryModel";

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
