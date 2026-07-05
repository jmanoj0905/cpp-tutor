import type { NormalizedCell, NormalizedMemory } from "./memoryModel";

/** Ids of leaf-level cells whose displayValue changed (or newly appeared)
 *  between two normalized snapshots. Pure — no React/DOM. */
export function changedCellIds(
  prev: NormalizedMemory | null,
  curr: NormalizedMemory,
): Set<string> {
  if (!prev) return new Set();

  const prevValues = collectValues(prev);
  const changed = new Set<string>();
  for (const [id, value] of collectValues(curr)) {
    if (prevValues.get(id) !== value) changed.add(id);
  }
  return changed;
}

function collectValues(memory: NormalizedMemory): Map<string, string> {
  const values = new Map<string, string>();
  const visit = (cell: NormalizedCell) => {
    if (cell.children?.length) {
      cell.children.forEach(visit);
    } else {
      values.set(cell.id, cell.displayValue);
    }
  };
  for (const cell of [...memory.globals, ...memory.frames.flatMap((f) => f.cells), ...memory.heap]) {
    visit(cell);
  }
  return values;
}
