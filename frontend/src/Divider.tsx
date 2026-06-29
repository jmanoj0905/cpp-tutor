import { useRef } from "react";
import { splitFromPointer } from "./divider";

export function Divider({ onResize }: { onResize: (pct: number) => void }) {
  const dragging = useRef(false);
  return (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const ws = e.currentTarget.closest(".workspace");
        if (!ws) return;
        onResize(splitFromPointer(e.clientX, ws.getBoundingClientRect()));
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    />
  );
}
