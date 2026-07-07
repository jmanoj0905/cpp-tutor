import { useRef } from "react";
import { splitFromPointer } from "./divider";

export function Divider({ onResize, container = ".workspace", defaultPct = 50 }: {
  onResize: (pct: number) => void;
  container?: string;
  defaultPct?: number;
}) {
  const dragging = useRef(false);
  return (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      onDoubleClick={() => onResize(defaultPct)}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const ws = e.currentTarget.closest(container);
        if (!ws) return;
        onResize(splitFromPointer(e.clientX, ws.getBoundingClientRect()));
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
