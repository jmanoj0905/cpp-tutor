import { useLayoutEffect, useState, type RefObject } from "react";
import type { MemoryLink } from "./memoryModel";
import { sourcePoint, targetPoint, bezierPath, type Rect } from "./connectorGeometry";

interface Drawn { id: string; d: string }

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

function relRect(el: Element, origin: DOMRect): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top };
}

export function Connectors({
  containerRef, links, stepKey,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  links: MemoryLink[];
  stepKey: number;
}) {
  const [paths, setPaths] = useState<Drawn[]>([]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const origin = container.getBoundingClientRect();
      const drawn: Drawn[] = [];
      for (const link of links) {
        const port = container.querySelector(`[data-port-id="${cssEscape(link.fromId)}"]`);
        const target = container.querySelector(`[data-cell-id="${cssEscape(link.toId)}"]`);
        if (!port || !target) continue;
        const d = bezierPath(sourcePoint(relRect(port, origin)), targetPoint(relRect(target, origin)));
        drawn.push({ id: `${link.fromId}->${link.toId}`, d });
      }
      setPaths(drawn);
    };

    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(container);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [containerRef, links, stepKey]);

  return (
    <svg className="connectors" aria-hidden>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {paths.map((p) => (
        <path key={p.id} className="connector resolved" d={p.d} markerEnd="url(#arrow)" />
      ))}
    </svg>
  );
}
