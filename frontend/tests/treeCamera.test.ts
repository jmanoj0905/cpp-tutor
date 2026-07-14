import { describe, expect, it } from "vitest";
import { pan, zoomAt, followIfOffscreen, MIN_SCALE, MAX_SCALE, type Camera } from "../src/viz/treeCamera";

const cam = (x = 0, y = 0, scale = 1): Camera => ({ x, y, scale });

describe("pan", () => {
  it("dragging right moves the world right (camera left)", () => {
    const c = pan(cam(100, 50), 30, -10);
    expect(c).toEqual({ x: 70, y: 60, scale: 1 });
  });
  it("respects scale: screen pixels convert to world units", () => {
    const c = pan(cam(0, 0, 2), 30, 0);
    expect(c.x).toBe(-15);
  });
});

describe("zoomAt", () => {
  it("keeps the world point under the anchor fixed", () => {
    const c0 = cam(10, 20, 1);
    const sx = 100, sy = 80;
    const wx = c0.x + sx / c0.scale, wy = c0.y + sy / c0.scale;
    const c1 = zoomAt(c0, 2, sx, sy);
    expect((wx - c1.x) * c1.scale).toBeCloseTo(sx);
    expect((wy - c1.y) * c1.scale).toBeCloseTo(sy);
    expect(c1.scale).toBe(2);
  });
  it("clamps scale to [MIN_SCALE, MAX_SCALE]", () => {
    expect(zoomAt(cam(0, 0, 1), 100, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomAt(cam(0, 0, 1), 0.001, 0, 0).scale).toBe(MIN_SCALE);
  });
});

describe("followIfOffscreen", () => {
  const vp = { w: 400, h: 300 };
  it("returns the same camera when the rect is visible", () => {
    const c = cam(0, 0, 1);
    expect(followIfOffscreen(c, { x: 100, y: 100, w: 50, h: 30 }, vp)).toBe(c);
  });
  it("pans minimally to reveal a rect off the right edge", () => {
    const c = followIfOffscreen(cam(0, 0, 1), { x: 500, y: 100, w: 50, h: 30 }, vp, 24);
    // right edge of rect (550 world = 550 screen) must land at vp.w - margin
    expect((550 - c.x) * c.scale).toBeCloseTo(400 - 24);
    expect(c.y).toBe(0); // no vertical pan needed
  });
  it("pans minimally to reveal a rect above the top edge", () => {
    const c = followIfOffscreen(cam(0, 100, 1), { x: 100, y: 50, w: 50, h: 30 }, vp, 24);
    expect((50 - c.y) * c.scale).toBeCloseTo(24);
    expect(c.x).toBe(0);
  });
});
