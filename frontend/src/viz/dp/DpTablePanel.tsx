import { useState } from "react";
import { CloseButton } from "../CloseButton";
import { useEscape } from "../useEscape";
import type { DpTableView, DpCellView } from "./dpModel";
import type { Coord } from "./readSet";
import type { Provenance } from "./provenance";

const CELL = 36; // px, uniform grid pitch for arrow geometry

/** Pure helper: arrow path between two cell centers on the uniform grid. */
function arrowPath(from: Coord, to: Coord): string {
  const center = (c: Coord) => {
    const [r, col] = c.length === 2 ? c : [0, c[0]];
    return [col * CELL + CELL / 2, r * CELL + CELL / 2];
  };
  const [x1, y1] = center(from);
  const [x2, y2] = center(to);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - CELL / 2;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

const val = (o: { value: number | null }) => (o.value === null ? "?" : String(o.value));

/** The "= max(6, 7) → 7" line, or null when nothing evaluated. */
function valuesLine(p: Provenance): string | null {
  if (p.operands.every((o) => o.value === null)) return null;
  const vals = p.operands.map(val);
  const arrow = p.winner === null ? "" : ` → ${val(p.operands[p.winner])}`;
  if (p.op === "max" || p.op === "min") return `${p.op}(${vals.join(", ")})${arrow}`;
  if (p.op === "ternary") return `? ${vals[0]} : ${vals[1]}${arrow}`;
  return `= ${vals[0]}`;
}

const READ_STEPS_DISPLAY_CAP = 8;

export function DpTablePanel({ view, changedIds, onToggleGeneric, readSteps, explain }: {
  view: DpTableView;
  changedIds?: Set<string>;
  onToggleGeneric: () => void;
  /** Whole-trace read log (coord key "r,c" → steps), from
   *  `collectReadSteps`. When provided, the detail box lists the steps at
   *  which the selected cell was read, capped for display. */
  readSteps?: Map<string, number[]>;
  /** Why the selected cell holds its value (see `explainWrite`). Called only
   *  for a cell that was actually written, and only while its detail box is
   *  open — provenance is lazy by design. */
  explain?: (cell: DpCellView) => Provenance | null;
}) {
  const [detail, setDetail] = useState<DpCellView | null>(null);
  useEscape(detail !== null, () => setDetail(null));
  const { candidate, cells, currentWrite, reads, maxWriteStep } = view;
  const [rows, cols] = candidate.dims.length === 2 ? candidate.dims : [1, candidate.dims[0]];
  const key = (c: Coord) => c.join(",");
  const readSet = new Set(reads.map(key));
  const writeKey = currentWrite ? key(currentWrite) : null;

  /** Heat: 0 (oldest) → 1 (this step's write). */
  const heat = (w: number | null) =>
    w === null || maxWriteStep === 0 ? 0 : Math.max(0.25, w / maxWriteStep);

  const twoD = candidate.dims.length === 2;
  const headers = twoD && !view.keyed;

  return (
    <div className="dp-panel" data-cell-id={candidate.cellId}>
      <div className="dp-header">
        <span className="dp-name">{candidate.name}</span>
        <span className="dp-mode">{candidate.mode}</span>
        <button className="cell-chip dp-generic-toggle" onClick={onToggleGeneric}>raw</button>
      </div>
      <div className={headers ? "dp-headed" : undefined}>
        {headers && (
          <div className="dp-col-head" style={{ marginLeft: CELL }}>
            {Array.from({ length: cols }, (_, c) => (
              <span key={c} style={{ width: CELL }}>{c}</span>
            ))}
          </div>
        )}
        <div className="dp-headed-row">
          {headers && (
            <div className="dp-row-head" style={{ width: CELL }}>
              {Array.from({ length: rows }, (_, r) => (
                <span key={r} style={{ height: CELL }}>{r}</span>
              ))}
            </div>
          )}
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
                    title={view.keyed && candidate.dims.length === 2 ? cell.label : undefined}
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
        </div>
      </div>
      <div className="dp-indices">
        {candidate.dims.length === 1 && !view.keyed &&
          cells.map((c) => <span key={key(c.coord)} style={{ width: CELL }}>{c.coord[0]}</span>)}
        {candidate.dims.length === 1 && view.keyed &&
          cells.map((c) => (
            <span key={key(c.coord)} className="dp-key-label" style={{ width: CELL }}>
              {c.label ?? ""}
            </span>
          ))}
      </div>
      {detail && (
        <div className="dp-detail">
          <span>{candidate.name}[{detail.coord.join("][")}] = {detail.value}</span>
          <span>{detail.writeStep === null ? "not yet written" : `written at step ${detail.writeStep}`}</span>
          {detail.writeStep !== null && (() => {
            const p = explain?.(detail) ?? null;
            if (!p) return null;
            const values = valuesLine(p);
            return (
              <>
                <span className="dp-stmt">
                  {p.lhs} {p.assign} {p.rhs}
                  {p.baseCase && <span className="dp-base-case">base case</span>}
                </span>
                {values && <span className="dp-values">{values}</span>}
                {p.winner !== null && (
                  <span className="dp-won">won: {p.operands[p.winner].text}</span>
                )}
              </>
            );
          })()}
          {(() => {
            const steps = readSteps?.get(key(detail.coord));
            if (!steps || steps.length === 0) return null;
            const shown = steps.slice(0, READ_STEPS_DISPLAY_CAP);
            const more = steps.length > READ_STEPS_DISPLAY_CAP;
            return <span>read at steps {shown.join(", ")}{more ? ", …" : ""}</span>;
          })()}
          <CloseButton onClick={() => setDetail(null)} />
        </div>
      )}
    </div>
  );
}
