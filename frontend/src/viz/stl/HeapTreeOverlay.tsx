import type { NormalizedCell } from "../memoryModel";
import { HeapTreePanel } from "./HeapTreePanel";
import { CloseButton } from "../CloseButton";

/** Docked host for a priority_queue's heap-tree view. Consistent with the
 *  call-tree .ct-detail inspector: a bottom-right dotted panel with no dimming
 *  backdrop, so you can keep stepping the trace while it stays open. Closes via
 *  the × button or Escape (Escape is handled globally by the keymap). */
export function HeapTreeOverlay({ cell, step, onClose, highlightedIds, changedIds, onCharViewToggle }: {
  cell: NormalizedCell;
  step: number;
  onClose: () => void;
  highlightedIds?: Set<string>;
  changedIds?: Set<string>;
  onCharViewToggle?: (cellId: string) => void;
}) {
  const badge = cell.heapKind === "min" ? "min-heap" : cell.heapKind === "max" ? "max-heap" : "heap";
  return (
    <div
      className="heap-overlay-panel"
      role="dialog"
      aria-label={`${cell.name} heap tree`}
    >
      <div className="heap-overlay-head">
        <span className="cell-name">{cell.name}</span>
        <span className="heap-badge">{badge}</span>
        <span className="heap-overlay-step">step {step}</span>
        <CloseButton onClick={onClose} label="Close heap tree" />
      </div>
      <HeapTreePanel
        cell={cell}
        highlightedIds={highlightedIds}
        changedIds={changedIds}
        onCharViewToggle={onCharViewToggle}
      />
    </div>
  );
}
