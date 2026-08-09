// Traversal primitives for NormalizedCell trees. Pure: no React, no DOM.
//
// These four operations were previously reimplemented per module (three
// separate by-id searches, four separate DFS walks, two separate id-rewriting
// recursions). They are collected here so every consumer agrees on traversal
// order and on how an absent `children` is handled.
import type { NormalizedCell, NormalizedMemory } from "./memoryModel";

/** Depth-first search for a cell by id. Null when nothing matches. */
export function findCellById(
  cells: NormalizedCell[],
  id: string,
): NormalizedCell | null {
  for (const cell of cells) {
    if (cell.id === id) return cell;
    if (cell.children) {
      const hit = findCellById(cell.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Every cell in the forest, pre-order (a parent precedes its children). */
export function flattenCells(cells: NormalizedCell[]): NormalizedCell[] {
  return cells.flatMap((cell) => [cell, ...flattenCells(cell.children ?? [])]);
}

/**
 * Rebuild a cell tree with every id passed through `next`. Used to namespace a
 * subtree (call-tree inspector) and to rebase heap-backed container children
 * onto stable logical ids. Structurally shared except for `id`; the input is
 * never mutated.
 */
export function mapCellIds(
  cell: NormalizedCell,
  next: (id: string) => string,
): NormalizedCell {
  return {
    ...cell,
    id: next(cell.id),
    children: cell.children?.map((child) => mapCellIds(child, next)),
  };
}

/** The three root forests of a step, in display order: globals, frames, heap. */
export function allRoots(memory: NormalizedMemory): NormalizedCell[] {
  return [
    ...memory.globals,
    ...memory.frames.flatMap((f) => f.cells),
    ...memory.heap,
  ];
}
