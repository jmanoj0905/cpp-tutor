import { describe, expect, it } from "vitest";
import { sourcePoint, targetPoint, bezierPath } from "../src/viz/connectorGeometry";

describe("connectorGeometry", () => {
  it("anchors source at right-center and target at left-center", () => {
    expect(sourcePoint({ left: 0, top: 0, right: 10, bottom: 20 })).toEqual({ x: 10, y: 10 });
    expect(targetPoint({ left: 30, top: 10, right: 50, bottom: 30 })).toEqual({ x: 30, y: 20 });
  });

  it("builds a cubic bezier path string between two points", () => {
    const d = bezierPath({ x: 10, y: 10 }, { x: 30, y: 20 });
    expect(d.startsWith("M 10 10 C")).toBe(true);
    expect(d).toContain("30 20");
  });
});
