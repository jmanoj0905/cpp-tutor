import { useState } from "react";
import type { NormalizedCell } from "./memoryModel";
import { collectionDepth, gridShape, isBentoCell } from "./memoryModel";
import type { DpTableView } from "./dp/dpModel";
import { DpTablePanel } from "./dp/DpTablePanel";

const COLLAPSE_AT = 8;

/**
 * Everything a cell subtree needs that is the same for every cell in it.
 * MemoryCell recurses, so these have to reach the leaves; passing them
 * individually meant retyping the same nine names at every recursion site and
 * at every call site in MemoryView (eleven places in total), where forgetting
 * one silently disabled a feature for that branch of the tree.
 */
export interface CellView {
  highlightedIds?: Set<string>;
  changedIds?: Set<string>;
  /** Detected DP tables keyed by cell id, and the toggle to escape to the raw
   *  array view for a given cell. When `dpViews` has this cell's id, render a
   *  DpTablePanel instead of the plain array cell. */
  dpViews?: Map<string, DpTableView>;
  onDpToggle?: (cellId: string) => void;
  /** Flip a string / vector-of-strings cell between string and char-array view
   *  (see `charView.ts`). Rendered as a header button on cells whose
   *  `charViewToggle` is set. */
  onCharViewToggle?: (cellId: string) => void;
  /** Per-candidate whole-trace read logs, keyed the same as `dpViews` (by the
   *  DP table's own cell id), each a "r,c" coord key → steps map from
   *  `collectReadSteps`. Passed straight through to the matching
   *  DpTablePanel's detail box. */
  dpReadSteps?: Map<string, Map<string, number[]>>;
  /** Open the binary-tree popup for a priority_queue cell (see HeapTreeOverlay). */
  onHeapOpen?: (cellId: string) => void;
}

interface MemoryCellProps {
  cell: NormalizedCell;
  /** Shared across the whole subtree; see CellView. */
  view?: CellView;
  /** Layout-only, and recomputed per level, so NOT part of CellView. */
  forceLinear?: boolean;
  /** Skip data-port-id ports on reference cells — for read-only inspection
   *  contexts (call-tree detail expansions) that draw no connector lines. */
  noPorts?: boolean;
}

export function MemoryCell({ cell, view = {}, forceLinear = false, noPorts = false }: MemoryCellProps) {
  const { highlightedIds, changedIds, dpViews, onDpToggle, onCharViewToggle, dpReadSteps, onHeapOpen } = view;
  const dpView = dpViews?.get(cell.id);
  if (dpView && onDpToggle) {
    return (
      <DpTablePanel
        view={dpView}
        changedIds={changedIds}
        onToggleGeneric={() => onDpToggle(cell.id)}
        readSteps={dpReadSteps?.get(cell.id)}
      />
    );
  }
  const hot = highlightedIds?.has(cell.id) ? " cell-highlight" : "";
  const changed = changedIds?.has(cell.id) ?? false;
  const hasKids = hasChildren(cell);
  const cellChanged = changed && !hasKids ? " cell-changed" : "";
  const headChanged = changed && hasKids ? " cell-changed" : "";
  return (
    <div className={`cell cell-${cell.kind}${hot}${cellChanged}${cell.internal ? " cell-internal" : ""}`} data-cell-id={cell.id}>
      <div className={`cell-head${headChanged}`}>
        <span className="cell-name">{cell.name}</span>
        {cell.type && cell.kind !== "array" && cell.kind !== "container" && <span className="cell-type">{cell.type}</span>}
        <CellValue cell={cell} noPorts={noPorts} />
        {cell.charViewToggle && onCharViewToggle && (
          <button
            className={`cell-chip char-view-toggle${cell.charViewToggle === "on" ? " is-on" : ""}`}
            title={cell.charViewToggle === "on" ? "Show as string" : "Show as char array"}
            onClick={(e) => { e.stopPropagation(); onCharViewToggle(cell.id); }}
          >
            {cell.charViewToggle === "on" ? "⇄ string" : "⇄ chars"}
          </button>
        )}
        {cell.containerKind === "priority_queue" && (
          <span className="heap-badge">
            {cell.heapKind === "min" ? "min-heap" : cell.heapKind === "max" ? "max-heap" : "heap"}
          </span>
        )}
        {cell.containerKind === "priority_queue" && onHeapOpen && (
          <button
            className="cell-chip heap-view-toggle"
            title="Show as heap tree"
            onClick={(e) => { e.stopPropagation(); onHeapOpen(cell.id); }}
          >
            ⇄ tree
          </button>
        )}
      </div>
      {hasKids && <Children cell={cell} view={view} forceLinear={forceLinear} noPorts={noPorts} />}
    </div>
  );
}

function CellValue({ cell, noPorts }: { cell: NormalizedCell; noPorts?: boolean }) {
  if (cell.kind === "reference") {
    return (
      <span className={`cell-value ref ${cell.unresolved ? "unresolved" : ""}`}>
        {cell.displayValue}
        {cell.note ? <em className="cell-note"> {cell.note}</em> : null}
        {!noPorts && <span className="port" data-port-id={cell.id} />}
      </span>
    );
  }
  if (cell.kind === "array" || cell.kind === "struct" || cell.kind === "container") {
    return (
      <span className="cell-value summary">
        {cell.displayValue}{cell.note ? <em className="cell-note"> {cell.note}</em> : null}
      </span>
    );
  }
  return <span className="cell-value">{cell.displayValue}</span>;
}

function hasChildren(cell: NormalizedCell): boolean {
  return Array.isArray(cell.children) && cell.children.length > 0;
}

function Children({ cell, view = {}, forceLinear, noPorts }: MemoryCellProps) {
  const { highlightedIds, changedIds } = view;
  const all = cell.children ?? [];
  const [expanded, setExpanded] = useState(false);

  const depth = collectionDepth(cell);
  const linear = forceLinear || depth >= 4;
  if (isBentoCell(cell) && !linear) {
    return (
      <div className="cell-children bento">
        {all.map((child) => (
          <MemoryCell key={child.id} cell={child} view={view} noPorts={noPorts} />
        ))}
      </div>
    );
  }
  const kv = !cell.placeholders
    && ["map", "unordered_map", "multimap", "unordered_multimap"].includes(cell.containerKind ?? "");
  const isString = cell.containerKind === "string";
  const hasMarkedChild = all.some((child) => changedIds?.has(child.id) || highlightedIds?.has(child.id));
  const shape = linear || kv ? null : gridShape(cell);
  if (shape) {
    return (
      <div className="matrix" style={{ gridTemplateColumns: `repeat(${shape.cols}, auto)` }}>
        {all.map((rowCell) => (
          <div className="matrix-row" key={rowCell.id} style={{ display: "contents" }}>
            {(rowCell.children ?? []).map((el) => (
              <MemoryCell key={el.id} cell={el} view={view} noPorts={noPorts} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  const shown = expanded ? all : all.slice(0, COLLAPSE_AT);
  const hidden = all.length - shown.length;

  if (isString && all.length > 0 && !expanded && !hasMarkedChild) {
    return (
      <div className="cell-children string-collapsed">
        <button className="cell-chip more-toggle" onClick={() => setExpanded(true)}>show {all.length} chars</button>
      </div>
    );
  }

  if (depth === 3 && !linear) {
    return (
      <div className="matrix-slices">
        {shown.map((slice) => (
          <MemoryCell key={slice.id} cell={slice} view={view} noPorts={noPorts} />
        ))}
        {hidden > 0 && (
          <button className="cell-chip more-toggle" onClick={() => setExpanded(true)}>… {hidden} more</button>
        )}
      </div>
    );
  }

  const grid = !linear && !kv && (cell.kind === "array" || cell.kind === "container");
  return (
    <div className={`cell-children ${kv ? "kv" : grid ? "grid" : linear ? "linear" : ""}`}>
      {shown.map((child) => (
        <MemoryCell key={child.id} cell={child} view={view} forceLinear={linear} noPorts={noPorts} />
      ))}
      {hidden > 0 && (
        <button className="cell-chip more-toggle" onClick={() => setExpanded(true)}>… {hidden} more</button>
      )}
    </div>
  );
}
