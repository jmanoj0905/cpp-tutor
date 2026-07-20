import { useState } from "react";
import type { DpTableView, DpCellView } from "./dpModel";
import type { Coord } from "./readSet";

const CELL = 36; // px, uniform grid pitch for arrow geometry

/** Pure helper (exported for tests): arrow path between two cell centers on
 *  the uniform grid. */
export function arrowPath(from: Coord, to: Coord): string {
  const center = (c: Coord) => {
    const [r, col] = c.length === 2 ? c : [0, c[0]];
    return [col * CELL + CELL / 2, r * CELL + CELL / 2];
  };
  const [x1, y1] = center(from);
  const [x2, y2] = center(to);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - CELL / 2;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

const READ_STEPS_DISPLAY_CAP = 8;

export function DpTablePanel({ view, changedIds, onToggleGeneric, readSteps }: {
  view: DpTableView;
  changedIds?: Set<string>;
  onToggleGeneric: () => void;
  /** Whole-trace read log (coord key "r,c" → steps), from
   *  `collectReadSteps`. When provided, the detail box lists the steps at
   *  which the selected cell was read, capped for display. */
  readSteps?: Map<string, number[]>;
}) {
  const [detail, setDetail] = useState<DpCellView | null>(null);
  const { candidate, cells, currentWrite, reads, maxWriteStep } = view;
  const [rows, cols] = candidate.dims.length === 2 ? candidate.dims : [1, candidate.dims[0]];
  const key = (c: Coord) => c.join(",");
  const readSet = new Set(reads.map(key));
  const writeKey = currentWrite ? key(currentWrite) : null;

  /** Heat: 0 (oldest) → 1 (this step's write). */
  const heat = (w: number | null) =>
    w === null || maxWriteStep === 0 ? 0 : Math.max(0.25, w / maxWriteStep);

  return (
    <div className="dp-panel" data-cell-id={candidate.cellId}>
      <div className="dp-header">
        <span className="dp-name">{candidate.name}</span>
        <span className="dp-mode">{candidate.mode}</span>
        <button className="dp-generic-toggle" onClick={onToggleGeneric}>raw</button>
      </div>
      <div className="dp-grid-wrap" style={{ width: cols * CELL, height: rows * CELL }}>
        <div className="dp-grid" style={{ gridTemplateColumns: `repeat(${cols}, ${CELL}px)` }}>
          {cells.map((cell) => {
            const k = key(cell.coord);
            const ghost = cell.writeStep === null;
            const cls = [
              "dp-cell",
              ghost && "dp-ghost",
              k === writeKey && "dp-write",
              readSet.has(k) && "dp-read",
              changedIds?.has(cell.id) && "cell-changed",
            ].filter(Boolean).join(" ");
            return (
              <div
                key={k}
                className={cls}
                data-coord={k}
                style={ghost ? undefined : { "--dp-heat": heat(cell.writeStep) } as React.CSSProperties}
                onClick={() => setDetail(cell)}
              >
                {cell.value}
              </div>
            );
          })}
        </div>
        {currentWrite && reads.length > 0 && (
          <svg className="dp-arrows" width={cols * CELL} height={rows * CELL}>
            {reads.map((r) => (
              <path key={key(r)} d={arrowPath(r, currentWrite)} />
            ))}
          </svg>
        )}
      </div>
      <div className="dp-indices">
        {candidate.dims.length === 1 &&
          cells.map((c) => <span key={key(c.coord)} style={{ width: CELL }}>{c.coord[0]}</span>)}
      </div>
      {detail && (
        <div className="dp-detail">
          <span>{candidate.name}[{detail.coord.join("][")}] = {detail.value}</span>
          <span>{detail.writeStep === null ? "not yet written" : `written at step ${detail.writeStep}`}</span>
          {(() => {
            const steps = readSteps?.get(key(detail.coord));
            if (!steps || steps.length === 0) return null;
            const shown = steps.slice(0, READ_STEPS_DISPLAY_CAP);
            const more = steps.length > READ_STEPS_DISPLAY_CAP;
            return <span>read at steps {shown.join(", ")}{more ? ", …" : ""}</span>;
          })()}
          <button onClick={() => setDetail(null)}>×</button>
        </div>
      )}
    </div>
  );
}
