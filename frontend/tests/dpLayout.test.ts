import { describe, expect, it } from "vitest";
import { CELL_MAX, CELL_MIN, DIGIT_MIN, arrowPath, gridPitch } from "../src/viz/dp/dpLayout";

describe("gridPitch", () => {
  it("keeps the full pitch for a table that already fits", () => {
    expect(gridPitch(1, 7)).toBe(CELL_MAX);
    expect(gridPitch(3, 4)).toBe(CELL_MAX);
  });

  it("shrinks as the table grows", () => {
    const medium = gridPitch(20, 20);
    expect(medium).toBeLessThan(CELL_MAX);
    expect(medium).toBeGreaterThan(gridPitch(40, 40));
  });

  it("never shrinks below the floor, however large the table", () => {
    expect(gridPitch(100, 100)).toBe(CELL_MIN);
    expect(gridPitch(1, 5000)).toBe(CELL_MIN);
  });

  it("sizes on the larger of the two dimensions", () => {
    expect(gridPitch(1, 40)).toBe(gridPitch(40, 1));
  });

  it("stops fitting digits before it reaches the floor", () => {
    // Otherwise the smallest tables would render unreadable clipped digits
    // rather than falling back to heat-only swatches.
    expect(CELL_MIN).toBeLessThan(DIGIT_MIN);
  });
});

describe("arrowPath", () => {
  it("connects cell centers on the given pitch", () => {
    expect(arrowPath([0], [2], 36)).toBe("M 18 18 Q 54 0 90 18");
  });

  it("scales with the pitch", () => {
    expect(arrowPath([0], [2], 14)).toBe("M 7 7 Q 21 0 35 7");
  });

  it("treats a 1D coord as row 0", () => {
    expect(arrowPath([0], [2], 36)).toBe(arrowPath([0, 0], [0, 2], 36));
  });
});
