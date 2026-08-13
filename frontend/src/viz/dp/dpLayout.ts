import type { Coord } from "./readSet";

/** Grid pitch in px for a table small enough to draw at full size. */
export const CELL_MAX = 36;
/** Smallest pitch drawn. Below this the grid stops shrinking and scrolls. */
export const CELL_MIN = 14;
/** Pitch below which 12px mono digits no longer fit, so cells render as
 *  heat-only swatches and the detail box carries the exact value. */
export const DIGIT_MIN = 20;

/** Roughly the width the panel gives a table before it has to shrink:
 *  CELL_MAX × 12 columns. */
const BUDGET = CELL_MAX * 12;

/** Uniform pitch for a rows × cols table. Sized on the larger dimension, so a
 *  wide table and the same table transposed draw identically, and clamped to
 *  [CELL_MIN, CELL_MAX] — past the floor the grid scrolls rather than
 *  shrinking into invisibility. */
export function gridPitch(rows: number, cols: number): number {
  const n = Math.max(rows, cols);
  if (n <= 0) return CELL_MAX;
  return Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(BUDGET / n)));
}

/** Bezier between two cell centers on a uniform grid of the given pitch. A 1D
 *  coord is row 0. */
export function arrowPath(from: Coord, to: Coord, pitch: number): string {
  const center = (c: Coord) => {
    const [r, col] = c.length === 2 ? c : [0, c[0]];
    return [col * pitch + pitch / 2, r * pitch + pitch / 2];
  };
  const [x1, y1] = center(from);
  const [x2, y2] = center(to);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - pitch / 2;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}
