import type { Trace } from "../types/trace";

export function toggleBreakpoint(set: Set<number>, line: number): Set<number> {
  const next = new Set(set);
  if (next.has(line)) next.delete(line);
  else next.add(line);
  return next;
}

// Breakpoint lines the trace never steps on — e.g. lines the tracer cannot
// see or code the program never reaches. Sorted for stable display.
export function deadBreakpointLines(breakpoints: Set<number>, trace: Trace): number[] {
  const visited = new Set(trace.trace.map((p) => p.line));
  return [...breakpoints].filter((line) => !visited.has(line)).sort((a, b) => a - b);
}
