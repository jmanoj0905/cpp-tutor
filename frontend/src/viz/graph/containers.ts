import type { NormalizedCell, NormalizedMemory } from "../memoryModel";

/** Depth-first collect every container/array cell in globals + all frames. */
export function findContainers(mem: NormalizedMemory): NormalizedCell[] {
  const out: NormalizedCell[] = [];
  const walk = (c: NormalizedCell) => {
    if (c.kind === "container" || c.kind === "array") out.push(c);
    c.children?.forEach(walk);
  };
  mem.globals.forEach(walk);
  mem.frames.forEach((f) => f.cells.forEach(walk));
  return out;
}
