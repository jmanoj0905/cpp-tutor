import { useState } from "react";
import type { NormalizedCell } from "./memoryModel";
import { collectionDepth, gridShape } from "./memoryModel";
import type { DpTableView } from "./dp/dpModel";
import { DpTablePanel } from "./dp/DpTablePanel";

const COLLAPSE_AT = 8;

interface MemoryCellProps {
  cell: NormalizedCell;
  highlightedIds?: Set<string>;
  changedIds?: Set<string>;
  forceLinear?: boolean;
  /** Skip data-port-id ports on reference cells — for read-only inspection
   *  contexts (call-tree detail expansions) that draw no connector lines. */
  noPorts?: boolean;
  /** Detected DP tables keyed by cell id, and the toggle to escape to the raw
   *  array view for a given cell. When `dpViews` has this cell's id, render a
   *  DpTablePanel instead of the plain array cell. */
  dpViews?: Map<string, DpTableView>;
  onDpToggle?: (cellId: string) => void;
}

export function MemoryCell({ cell, highlightedIds, changedIds, forceLinear = false, noPorts = false, dpViews, onDpToggle }: MemoryCellProps) {
  const dpView = dpViews?.get(cell.id);
  if (dpView && onDpToggle) {
    return <DpTablePanel view={dpView} changedIds={changedIds} onToggleGeneric={() => onDpToggle(cell.id)} />;
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
      </div>
      {hasKids && <Children cell={cell} highlightedIds={highlightedIds} changedIds={changedIds} forceLinear={forceLinear} noPorts={noPorts} dpViews={dpViews} onDpToggle={onDpToggle} />}
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

function Children({ cell, highlightedIds, changedIds, forceLinear, noPorts, dpViews, onDpToggle }: MemoryCellProps) {
  const all = cell.children ?? [];
  const [expanded, setExpanded] = useState(false);

  const depth = collectionDepth(cell);
  const linear = forceLinear || depth >= 4;
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
              <MemoryCell key={el.id} cell={el} highlightedIds={highlightedIds} changedIds={changedIds} noPorts={noPorts} dpViews={dpViews} onDpToggle={onDpToggle} />
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
        <button className="more-toggle" onClick={() => setExpanded(true)}>show {all.length} chars</button>
      </div>
    );
  }

  if (depth === 3 && !linear) {
    return (
      <div className="matrix-slices">
        {shown.map((slice) => (
          <MemoryCell
            key={slice.id}
            cell={slice}
            highlightedIds={highlightedIds} changedIds={changedIds} noPorts={noPorts}
            dpViews={dpViews} onDpToggle={onDpToggle}
          />
        ))}
        {hidden > 0 && (
          <button className="more-toggle" onClick={() => setExpanded(true)}>… {hidden} more</button>
        )}
      </div>
    );
  }

  const grid = !linear && !kv && (cell.kind === "array" || cell.kind === "container");
  return (
    <div className={`cell-children ${kv ? "kv" : grid ? "grid" : linear ? "linear" : ""}`}>
      {shown.map((child) => (
        <MemoryCell
          key={child.id}
          cell={child}
          highlightedIds={highlightedIds}
          changedIds={changedIds}
          forceLinear={linear}
          noPorts={noPorts}
          dpViews={dpViews}
          onDpToggle={onDpToggle}
        />
      ))}
      {hidden > 0 && (
        <button className="more-toggle" onClick={() => setExpanded(true)}>… {hidden} more</button>
      )}
    </div>
  );
}
