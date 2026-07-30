// Pure fold-state resolution for the Call Log view — no React, no DOM.
import type { CallTreeNode } from "./callTree";

/** Total nodes in the subtree rooted at `node`, excluding `node` itself. */
export function countDescendants(node: CallTreeNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

/**
 * Whether `node`'s children are hidden at `step`.
 * Leaves are never collapsed. An explicit user override wins; otherwise the
 * auto rule collapses a subtree that has fully returned before the current
 * step (exitStep !== null && exitStep < step) and expands it while live/future.
 */
export function isCollapsed(
  node: CallTreeNode,
  step: number,
  overrides: Map<number, boolean>,
): boolean {
  if (node.children.length === 0) return false;
  const override = overrides.get(node.id);
  if (override !== undefined) return override;
  return node.exitStep !== null && node.exitStep < step;
}
