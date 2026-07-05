import { useState, useCallback } from "react";
import type { Trace } from "../types/trace";

export function usePlayer(trace: Trace) {
  const total = trace.trace.length;
  const [index, setIndex] = useState(0);
  const clamp = (i: number) => Math.max(0, Math.min(total - 1, i));
  const goto = useCallback(
    (i: number) => setIndex(Math.max(0, Math.min(total - 1, i))),
    [total],
  );
  const lineAt = (i: number) => (i >= 0 && i < total ? trace.trace[i].line : null);

  const hitSteps = useCallback(
    (breakpoints: Set<number>) =>
      trace.trace.reduce<number[]>((acc, p, i) => {
        if (breakpoints.has(p.line)) acc.push(i);
        return acc;
      }, []),
    [trace],
  );

  const nextHit = useCallback(
    (breakpoints: Set<number>) =>
      setIndex((i) => {
        for (let j = i + 1; j < total; j++) {
          if (breakpoints.has(trace.trace[j].line)) return j;
        }
        return Math.max(0, Math.min(total - 1, i + 1)); // no hit ahead: single-step
      }),
    [trace, total],
  );

  return {
    index,
    total,
    point: trace.trace[index],
    prevLine: lineAt(index - 1),
    nextLine: lineAt(index + 1),
    first: () => setIndex(0),
    last: () => setIndex(total - 1),
    next: () => setIndex((i) => clamp(i + 1)),
    prev: () => setIndex((i) => clamp(i - 1)),
    goto,
    hitSteps,
    nextHit,
  };
}
