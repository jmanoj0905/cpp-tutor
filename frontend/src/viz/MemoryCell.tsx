import { useState } from "react";
import type { NormalizedCell } from "./memoryModel";
import { collectionDepth, gridShape, isBentoCell } from "./memoryModel";
import type { DpTableView, DpCellView } from "./dp/dpModel";
import { DpTablePanel } from "./dp/DpTablePanel";
import type { Provenance } from "./dp/provenance";
import type { DpCone } from "./dp/cone";

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
   *  `charViewToggle` is set. Takes ids rather than one id because a string
   *  sequence's button flips all of its elements at once (`charViewGroup`). */
  onCharViewToggle?: (cellIds: string[]) => void;
  /** Per-candidate whole-trace read logs, keyed the same as `dpViews` (by the
   *  DP table's own cell id), each a "r,c" coord key → steps map from
   *  `collectReadSteps`. Passed straight through to the matching
   *  DpTablePanel's detail box. */
  dpReadSteps?: Map<string, Map<string, number[]>>;
  /** Open the binary-tree popup for a priority_queue cell (see HeapTreeOverlay). */
  onHeapOpen?: (cellId: string) => void;
  /** Manually promote a tracked-but-undetected array/map cell to a DP table
   *  view. Detection is a default, not a gate: this bypasses the scoring
   *  thresholds entirely. Rendered as a header chip beside the char-view
   *  toggle, only for cells in `promotableDpIds` that aren't already showing
   *  a DP panel. */
  onDpPromote?: (cellId: string) => void;
  /** Cell ids that were written during the trace and so are eligible for
   *  manual promotion (see `collectTables`/`promoteToDp` in detect.ts). */
  promotableDpIds?: Set<string>;
  /** Per-candidate lazy provenance lookups, keyed the same as `dpViews` (by
   *  the DP table's own cell id). Called only when a cell's detail box is
   *  open — nothing is computed for a table the user never inspects. */
  dpExplain?: Map<string, (cell: DpCellView) => Provenance | null>;
  /** Per-candidate recurrence graphs (see `buildCone`), keyed the same as
   *  `dpViews`. Drives the operand/dependent tint around a selected DP cell. */
  dpCones?: Map<string, DpCone>;
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
  const { highlightedIds, changedIds, dpViews, onDpToggle, onCharViewToggle, dpReadSteps, onHeapOpen, onDpPromote, promotableDpIds, dpExplain, dpCones } = view;
  const dpView = dpViews?.get(cell.id);
  if (dpView && onDpToggle) {
    return (
      <DpTablePanel
        view={dpView}
        changedIds={changedIds}
        onToggleGeneric={() => onDpToggle(cell.id)}
        readSteps={dpReadSteps?.get(cell.id)}
        explain={dpExplain?.get(cell.id)}
        cone={dpCones?.get(cell.id)}
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
            onClick={(e) => { e.stopPropagation(); onCharViewToggle(cell.charViewGroup ?? [cell.id]); }}
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
        {onDpPromote && promotableDpIds?.has(cell.id) && isDpPromotable(cell) && (
          <button
            className="cell-chip dp-promote-toggle"
            title="View as DP table"
            onClick={(e) => { e.stopPropagation(); onDpPromote(cell.id); }}
          >
            ⇄ dp
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

/** Array-likes and keyed memos are the shapes DpTablePanel can draw. */
function isDpPromotable(cell: NormalizedCell): boolean {
  return cell.kind === "array"
    || cell.containerKind === "vector"
    || cell.containerKind === "map"
    || cell.containerKind === "unordered_map";
}

/**
 * A string's characters, as the glyph run they read as in source: no `[i]`
 * index, no repeated `char` type. That's the whole point of the char-view
 * toggle — flipped to `vector<char>`, the same characters render through the
 * normal indexed-array path instead, so the two views are told apart by their
 * children and not just by the header. Each glyph still carries its cell id so
 * per-character diff and selection highlighting land exactly as before.
 */
function StringChars({ cell, view = {} }: { cell: NormalizedCell; view?: CellView }) {
  const { highlightedIds, changedIds } = view;
  return (
    <div className="cell-children string-chars">
      {(cell.children ?? []).map((ch) => (
        <span
          key={ch.id}
          data-cell-id={ch.id}
          className={`char-box${highlightedIds?.has(ch.id) ? " cell-highlight" : ""}${changedIds?.has(ch.id) ? " cell-changed" : ""}`}
        >
          {ch.displayValue}
        </span>
      ))}
    </div>
  );
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

  if (isString && all.length > 0) {
    // A glyph run is cheap to show, so only long strings stay behind the
    // collapse chip; short ones read as their characters straight away.
    if (all.length > COLLAPSE_AT && !expanded && !hasMarkedChild) {
      return (
        <div className="cell-children string-collapsed">
          <button className="cell-chip more-toggle" onClick={() => setExpanded(true)}>show {all.length} chars</button>
        </div>
      );
    }
    return <StringChars cell={cell} view={view} />;
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
