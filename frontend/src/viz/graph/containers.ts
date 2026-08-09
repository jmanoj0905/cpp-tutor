import type { NormalizedCell, NormalizedMemory } from "../memoryModel";

// graphModel calls findContainers 18 times per scene build (once per detector:
// grid, dist, frontier, visited, pair-queue, …), and each call used to re-walk
// the entire cell forest. The result depends only on the NormalizedMemory, and
// NormalizedMemory objects are themselves memoized per ExecPoint, so caching
// on identity collapses those 18 walks into one.
const cache = new WeakMap<NormalizedMemory, NormalizedCell[]>();

/** Depth-first collect every container/array cell in globals + all frames. */
export function findContainers(mem: NormalizedMemory): NormalizedCell[] {
  const hit = cache.get(mem);
  if (hit) return hit;
  const out: NormalizedCell[] = [];
  const walk = (c: NormalizedCell) => {
    if (c.kind === "container" || c.kind === "array") out.push(c);
    c.children?.forEach(walk);
  };
  mem.globals.forEach(walk);
  mem.frames.forEach((f) => f.cells.forEach(walk));
  cache.set(mem, out);
  return out;
}
