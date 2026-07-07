import { useRef } from "react";
import { splitFromPointer } from "./divider";

export function Divider({
  onResize,
  container = ".workspace",
  defaultPct = 50,
  orientation = "vertical",
  min = 20,
  max = 80,
}: {
  onResize: (pct: number) => void;
  container?: string;
  defaultPct?: number;
  orientation?: "vertical" | "horizontal";
  min?: number;
  max?: number;
}) {
  const dragging = useRef(false);
  const axis = orientation === "vertical" ? "x" : "y";
  return (
    <div
      className={orientation === "vertical" ? "divider" : "divider divider-h"}
      role="separator"
      aria-orientation={orientation}
      onDoubleClick={() => onResize(defaultPct)}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const ws = e.currentTarget.closest(container);
        if (!ws) return;
        const client = axis === "x" ? e.clientX : e.clientY;
        onResize(splitFromPointer(client, ws.getBoundingClientRect(), axis, min, max));
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }}
      onPointerCancel={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }}
    />
  );
}
