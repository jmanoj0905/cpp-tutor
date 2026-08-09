import type { Coord } from "./readSet";

export interface KeyedProjection {
  dims: number[];
  coordOfKey: Map<string, Coord>;
  labelAt: Map<string, string>;
  numeric: boolean;
}

const INT = /^\d+$/;
const PAIR = /^\(\s*(\d+)\s*,\s*(\d+)\s*\)$/;

/** A memo's key set as a grid. Integer keys become a sparse 1D grid indexed BY
 *  THE KEY (not by insertion order) so a top-down memo looks like the array a
 *  bottom-up solution would have filled — the whole point of drawing memos as
 *  tables. Pair keys become a sparse 2D grid. Anything else falls back to
 *  first-write order with the raw key as the label.
 *
 *  `numeric` tells callers whether a resolved subscript value IS a coordinate,
 *  which is what read arrows need; only the integer-key shape can support them.
 *
 *  Pure: no React, no DOM. */
export function projectKeys(keyOrder: readonly string[]): KeyedProjection {
  const coordOfKey = new Map<string, Coord>();
  const labelAt = new Map<string, string>();

  if (keyOrder.length > 0 && keyOrder.every((k) => INT.test(k))) {
    let max = 0;
    for (const k of keyOrder) {
      const n = Number(k);
      max = Math.max(max, n);
      coordOfKey.set(k, [n]);
      labelAt.set(String(n), k);
    }
    return { dims: [max + 1], coordOfKey, labelAt, numeric: true };
  }

  const pairs = keyOrder.map((k) => PAIR.exec(k));
  if (keyOrder.length > 0 && pairs.every((m) => m !== null)) {
    let rows = 0, cols = 0;
    keyOrder.forEach((k, i) => {
      const [, a, b] = pairs[i]!;
      const r = Number(a), c = Number(b);
      rows = Math.max(rows, r + 1);
      cols = Math.max(cols, c + 1);
      coordOfKey.set(k, [r, c]);
      labelAt.set(`${r},${c}`, k);
    });
    return { dims: [rows, cols], coordOfKey, labelAt, numeric: false };
  }

  keyOrder.forEach((k, i) => {
    coordOfKey.set(k, [i]);
    labelAt.set(String(i), k);
  });
  return { dims: [keyOrder.length], coordOfKey, labelAt, numeric: false };
}
