import { useEffect, useState } from "react";

// Whole seconds since `active` last became true. Resets to 0 on each rising
// edge; freezes at its last value while inactive. Used to show the learner a
// live "tracing... Ns" counter so a multi-second trace does not look hung.
export function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) return;
    setSeconds(0);
    const started = Date.now();
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  return seconds;
}
