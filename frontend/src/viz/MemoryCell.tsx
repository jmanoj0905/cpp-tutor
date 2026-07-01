import { useState } from "react";
import type { NormalizedCell } from "./memoryModel";
import { gridShape } from "./memoryModel";

const COLLAPSE_AT = 8;

export function MemoryCell({ cell, highlightedIds }: { cell: NormalizedCell; highlightedIds?: Set<string> }) {
  const hot = highlightedIds?.has(cell.id) ? " cell-highlight" : "";
  return (
    <div className={`cell cell-${cell.kind}${hot}${cell.internal ? " cell-internal" : ""}`} data-cell-id={cell.id}>
      <div className="cell-head">
        <span className="cell-name">{cell.name}</span>
        {cell.type && cell.kind !== "array" && cell.kind !== "container" && <span className="cell-type">{cell.type}</span>}
        <CellValue cell={cell} />
      </div>
      {hasChildren(cell) && <Children cell={cell} highlightedIds={highlightedIds} />}
    </div>
  );
}

function CellValue({ cell }: { cell: NormalizedCell }) {
  if (cell.kind === "reference") {
    return (
      <span className={`cell-value ref ${cell.unresolved ? "unresolved" : ""}`}>
        {cell.displayValue}
        {cell.note ? <em className="cell-note"> {cell.note}</em> : null}
        <span className="port" data-port-id={cell.id} />
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

function Children({ cell, highlightedIds }: { cell: NormalizedCell; highlightedIds?: Set<string> }) {
  const all = cell.children ?? [];
  const [expanded, setExpanded] = useState(false);

  const shape = gridShape(cell);
  if (shape) {
    return (
      <div className="matrix" style={{ gridTemplateColumns: `repeat(${shape.cols}, auto)` }}>
        {all.map((rowCell) => (
          <div className="matrix-row" key={rowCell.id} style={{ display: "contents" }}>
            {(rowCell.children ?? []).map((el) => (
              <MemoryCell key={el.id} cell={el} highlightedIds={highlightedIds} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  const shown = expanded ? all : all.slice(0, COLLAPSE_AT);
  const hidden = all.length - shown.length;
  const kv = !cell.placeholders && ["map", "unordered_map", "multimap"].includes(cell.containerKind ?? "");
  const grid = !kv && (cell.kind === "array" || cell.kind === "container");
  return (
    <div className={`cell-children ${kv ? "kv" : grid ? "grid" : ""}`}>
      {shown.map((child) => <MemoryCell key={child.id} cell={child} highlightedIds={highlightedIds} />)}
      {hidden > 0 && (
        <button className="more-toggle" onClick={() => setExpanded(true)}>… {hidden} more</button>
      )}
    </div>
  );
}
