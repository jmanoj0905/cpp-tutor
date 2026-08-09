import { useEffect } from "react";

/**
 * Close-on-Escape for an inspector panel. The listener only exists while
 * `active` is true, so a page with four inspectors still has at most one
 * handler bound.
 *
 * Every detail panel (call tree, shape, DP table, graph) is dismissable the
 * same way; previously only two of the four listened for Escape.
 */
export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}
