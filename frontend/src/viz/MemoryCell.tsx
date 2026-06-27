import { useState } from "react";
import type { NormalizedCell } from "./memoryModel";

const COLLAPSE_AT = 8;

export function MemoryCell({ cell }: { cell: NormalizedCell }) {
  return (
    <div className={`cell cell-${cell.kind}`} data-cell-id={cell.id}>
      <div className="cell-head">
        <span className="cell-name">{cell.name}</span>
        {cell.type && cell.kind !== "vector" && cell.kind !== "array" && <span className="cell-type">{cell.type}</span>}
        <CellValue cell={cell} />
      </div>
      {hasChildren(cell) && <Children cell={cell} />}
    </div>
  );
}

function CellValue({ cell }: { cell: NormalizedCell }) {
  if (cell.kind === "reference") {
    return (
      <span className={`cell-value ref ${cell.unresolved ? "unresolved" : ""}`}>
        {cell.displayValue}
        <span className="port" data-port-id={cell.id} />
      </span>
    );
  }
  if (cell.kind === "vector" || cell.kind === "array" || cell.kind === "struct") {
    return <span className="cell-value summary">{cell.displayValue}</span>;
  }
  return <span className="cell-value">{cell.displayValue}</span>;
}

function hasChildren(cell: NormalizedCell): boolean {
  return Array.isArray(cell.children) && cell.children.length > 0;
}

function Children({ cell }: { cell: NormalizedCell }) {
  const all = cell.children ?? [];
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? all : all.slice(0, COLLAPSE_AT);
  const hidden = all.length - shown.length;
  const grid = cell.kind === "array" || cell.kind === "vector";
  return (
    <div className={`cell-children ${grid ? "grid" : ""}`}>
      {shown.map((child) => <MemoryCell key={child.id} cell={child} />)}
      {hidden > 0 && (
        <button className="more-toggle" onClick={() => setExpanded(true)}>… {hidden} more</button>
      )}
    </div>
  );
}
