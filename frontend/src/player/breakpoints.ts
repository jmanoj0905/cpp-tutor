export function toggleBreakpoint(set: Set<number>, line: number): Set<number> {
  const next = new Set(set);
  if (next.has(line)) next.delete(line);
  else next.add(line);
  return next;
}
