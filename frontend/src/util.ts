// Tiny cross-cutting helpers. No React, no DOM, no project types — anything
// that needs those belongs in the layer that owns them (viz/cells.ts for
// NormalizedCell trees, viz/callTree.ts for frame identity).

/** Escape a string so it matches literally inside a RegExp. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Add `item` if absent, remove it if present, in a NEW set. Every "which ids
 * are toggled on" piece of view state (breakpoints, expanded frames, disabled
 * shapes, disabled DP tables, char-view cells, expanded call-tree vars) is a
 * `Set` in React state, so it must never be mutated in place.
 */
export function toggleInSet<T>(set: Set<T>, item: T): Set<T> {
  const next = new Set(set);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next;
}
