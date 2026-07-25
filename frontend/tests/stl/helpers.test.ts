import { describe, it, expect } from "vitest";
import { parseAddr, findMember, findPointer, prettyType } from "../../src/viz/stl/helpers";
import type { NormalizedCell } from "../../src/viz/memoryModel";

const cell: NormalizedCell = {
  id: "x", name: "v", source: "stack", kind: "struct", address: "0x10", type: "std::vector<int>",
  displayValue: "", rawValue: null,
  children: [
    { id: "a", name: "_M_impl", source: "stack", kind: "struct", address: "0x10", type: "impl",
      displayValue: "", rawValue: null, children: [
        { id: "s", name: "_M_start", source: "stack", kind: "reference", address: "0x10",
          type: "pointer", displayValue: "", rawValue: null, targetAddress: "0x9000" },
      ] },
  ],
};

describe("stl helpers", () => {
  it("parseAddr parses hex, returns null for junk", () => {
    expect(parseAddr("0x10")).toBe(16);
    expect(parseAddr("nope")).toBeNull();
    expect(parseAddr(null)).toBeNull();
  });
  it("findMember finds a nested member by name", () => {
    expect(findMember(cell, "_M_start")?.name).toBe("_M_start");
  });
  it("findPointer returns a nested pointer's target address", () => {
    expect(findPointer(cell, "_M_start")).toBe("0x9000");
  });
  it("prettyType collapses the verbose basic_string<char> spelling to string", () => {
    expect(prettyType(
      "std::basic_string<char, std::char_traits<char>, std::allocator<char> >",
    )).toBe("string");
    // and when nested inside a template argument
    expect(prettyType(
      "vector<std::basic_string<char, std::char_traits<char>, std::allocator<char> >>",
    )).toBe("vector<string>");
    // leaves unrelated types untouched
    expect(prettyType("int")).toBe("int");
    expect(prettyType("vector<int>")).toBe("vector<int>");
  });
});
