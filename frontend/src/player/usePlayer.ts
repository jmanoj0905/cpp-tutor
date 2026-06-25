import { useState, useCallback } from "react";
import type { Trace } from "../types/trace";

export function usePlayer(trace: Trace) {
  const total = trace.trace.length;
  const [index, setIndex] = useState(0);
  const clamp = (i: number) => Math.max(0, Math.min(total - 1, i));
  const goto = useCallback((i: number) => setIndex(clamp(i)), [total]);
  return {
    index,
    total,
    point: trace.trace[index],
    first: () => setIndex(0),
    last: () => setIndex(total - 1),
    next: () => setIndex((i) => clamp(i + 1)),
    prev: () => setIndex((i) => clamp(i - 1)),
    goto,
  };
}
