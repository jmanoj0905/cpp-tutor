import type { Trace } from "../types/trace";
import { toggleInSet } from "../util";

/** Breakpoint-typed alias of the shared set toggle. */
export const toggleBreakpoint = (set: Set<number>, line: number): Set<number> =>
  toggleInSet(set, line);

// Breakpoint lines the trace never steps on — e.g. lines the tracer cannot
// see or code the program never reaches. Sorted for stable display.
export function deadBreakpointLines(breakpoints: Set<number>, trace: Trace): number[] {
  const visited = new Set(trace.trace.map((p) => p.line));
  return [...breakpoints].filter((line) => !visited.has(line)).sort((a, b) => a - b);
}
