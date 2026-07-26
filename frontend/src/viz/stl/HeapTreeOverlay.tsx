import type { NormalizedCell } from "../memoryModel";
import { HeapTreePanel } from "./HeapTreePanel";

/** Modal host for a priority_queue's heap-tree view. Mirrors HelpOverlay:
 *  backdrop click and × close it; Escape is handled globally by the keymap. */
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
    <div className="heap-overlay-backdrop" onClick={onClose}>
      <div
        className="heap-overlay-panel"
        role="dialog"
        aria-label={`${cell.name} heap tree`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="heap-overlay-head">
          <span className="cell-name">{cell.name}</span>
          <span className="heap-badge">{badge}</span>
          <span className="heap-overlay-step">step {step}</span>
          <button className="help-close heap-overlay-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <HeapTreePanel
          cell={cell}
          highlightedIds={highlightedIds}
          changedIds={changedIds}
          onCharViewToggle={onCharViewToggle}
        />
      </div>
    </div>
  );
}
