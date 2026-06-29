import { describe, it, expect } from "vitest";
import { splitFromPointer } from "../src/divider";

const rect = (left: number, width: number) => ({ left, width } as DOMRect);

describe("splitFromPointer", () => {
  it("returns 50 at the midpoint", () => {
    expect(splitFromPointer(500, rect(0, 1000))).toBe(50);
  });
  it("maps an interior point to its percentage", () => {
    expect(splitFromPointer(300, rect(0, 1000))).toBe(30);
  });
  it("clamps to 20 at or under the left edge", () => {
    expect(splitFromPointer(0, rect(0, 1000))).toBe(20);
  });
  it("clamps to 80 at or over the right edge", () => {
    expect(splitFromPointer(1000, rect(0, 1000))).toBe(80);
  });
  it("accounts for rect.left offset", () => {
    expect(splitFromPointer(700, rect(200, 1000))).toBe(50);
  });
});
