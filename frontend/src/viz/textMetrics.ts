// Text measurement for the pure layout modules. No React, no DOM: every panel
// that sizes a box to its label estimates from the mono advance rather than
// measuring, so layouts stay unit-testable and stable across steps.

/** 12px JetBrains Mono advance (~0.6em) plus a safety margin. Exact enough
 *  because every label these layouts size is pure mono text. */
export const CHAR_W = 7.5;

/**
 * Content-sized box width: the label's estimated width plus horizontal
 * padding, floored at `minWidth`.
 *
 * treeLayout (call tree) and shapeLayout (list/tree/trie panels) each had
 * their own copy of this formula and their own CHAR_W constant, the latter
 * carrying a comment pointing at the former. Their padding and floor differ
 * legitimately, so those stay parameters.
 */
export function boxWidth(label: string, minWidth: number, padX: number): number {
  return Math.max(minWidth, Math.ceil(label.length * CHAR_W + 2 * padX));
}
