import { useState } from "react";
import { CloseButton } from "../CloseButton";
import { useEscape } from "../useEscape";
import { fillOrder, readCounts, type DpTableView, type DpCellView } from "./dpModel";
import type { Coord } from "./readSet";
import type { Provenance } from "./provenance";
import type { DpCone } from "./cone";
import { DIGIT_MIN, arrowPath, gridPitch } from "./dpLayout";

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

export function DpTablePanel({ view, changedIds, onToggleGeneric, readSteps, explain, cone }: {
  view: DpTableView;
  changedIds?: Set<string>;
  onToggleGeneric: () => void;
  /** The table's recurrence graph (see `buildCone`). When provided, selecting
   *  a cell tints the cells it was computed from and the cells computed from
   *  it, one level in each direction. */
  cone?: DpCone;
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
  // Which quantity the cell background encodes: how recently a cell was
  // written (the default — fill order) or how often it has been read so far
  // (which subproblems the recurrence actually reuses).
  const [heatMode, setHeatMode] = useState<"writes" | "reads">("writes");
  // What the cell prints: its value, or its position in the fill order.
  const [showMode, setShowMode] = useState<"value" | "order">("value");
  useEscape(detail !== null, () => setDetail(null));
  const { candidate, cells, currentWrite, reads, maxWriteStep } = view;
  const [rows, cols] = candidate.dims.length === 2 ? candidate.dims : [1, candidate.dims[0]];
  const key = (c: Coord) => c.join(",");
  const readSet = new Set(reads.filter((r) => r.hit).map((r) => key(r.coord)));
  // Misses draw no arrow: an arrow points at the write a read fed, and a miss
  // by definition fed nothing — it found no value and sent the solution off to
  // compute one.
  const missSet = new Set(reads.filter((r) => !r.hit).map((r) => key(r.coord)));
  const hitReads = reads.filter((r) => r.hit).map((r) => r.coord);
  const writeKey = currentWrite ? key(currentWrite) : null;

  /** Heat: 0 (oldest) → 1 (this step's write). */
  const heat = (w: number | null) =>
    w === null || maxWriteStep === 0 ? 0 : Math.max(0.25, w / maxWriteStep);

  // Read-count shading. Counted only up to this step, so the table never
  // shows heat from a read that hasn't executed yet. In this mode ghosting
  // means "not read yet" rather than "not written yet", so the whole grid
  // reads as one quantity instead of mixing two.
  const readMode = heatMode === "reads";
  const counts = readMode && readSteps ? readCounts(readSteps, view.step) : null;
  const maxCount = counts ? Math.max(0, ...counts.values()) : 0;
  const order = showMode === "order" ? fillOrder(cells) : null;

  // One level of the recurrence graph around the selected cell: what it was
  // computed from, and what was computed from it. Tied to the detail box, so
  // it appears and clears with the selection.
  const selectedEdges = detail && cone ? cone.get(key(detail.coord)) : undefined;
  const operandSet = new Set(selectedEdges?.operands.map(key));
  const dependentSet = new Set(selectedEdges?.dependents.map(key));

  // Crosshair: the headers of the row and column being written, so a wide
  // table still tells you where the write landed without counting cells.
  const [writeRow, writeCol] = currentWrite
    ? (currentWrite.length === 2 ? currentWrite : [0, currentWrite[0]])
    : [null, null];

  // Pitch shrinks with the table so a large grid still reads as one shape;
  // past the floor `.dp-headed` scrolls instead (see index.css). Below
  // DIGIT_MIN the digits no longer fit, so cells become heat-only swatches and
  // the detail box carries the exact value.
  const pitch = gridPitch(rows, cols);
  const dense = pitch < DIGIT_MIN;

  const twoD = candidate.dims.length === 2;
  const headers = twoD && !view.keyed;

  return (
    <div className="dp-panel" data-cell-id={candidate.cellId}>
      <div className="dp-header">
        <span className="dp-name">{candidate.name}</span>
        <span className="dp-mode">{candidate.mode}</span>
        <button
          className={`cell-chip dp-heat-toggle${readMode ? " is-on" : ""}`}
          onClick={() => setHeatMode((m) => (m === "writes" ? "reads" : "writes"))}
        >
          heat: {heatMode}
        </button>
        <button
          className={`cell-chip dp-show-toggle${order ? " is-on" : ""}`}
          onClick={() => setShowMode((m) => (m === "value" ? "order" : "value"))}
        >
          show: {showMode}
        </button>
        <button className="cell-chip dp-generic-toggle" onClick={onToggleGeneric}>raw</button>
      </div>
      <div className={`${headers ? "dp-headed" : ""}${dense ? " dp-dense" : ""}`.trim() || undefined}>
        {headers && (
          <div className="dp-col-head" style={{ marginLeft: pitch }}>
            {Array.from({ length: cols }, (_, c) => (
              <span key={c} className={c === writeCol ? "dp-head-active" : undefined}
                    style={{ width: pitch }}>{c}</span>
            ))}
          </div>
        )}
        <div className="dp-headed-row">
          {headers && (
            <div className="dp-row-head" style={{ width: pitch }}>
              {Array.from({ length: rows }, (_, r) => (
                <span key={r} className={r === writeRow ? "dp-head-active" : undefined}
                      style={{ height: pitch }}>{r}</span>
              ))}
            </div>
          )}
          <div className="dp-grid-wrap" style={{ width: cols * pitch, height: rows * pitch }}>
            <div className="dp-grid" style={{ gridTemplateColumns: `repeat(${cols}, ${pitch}px)` }}>
              {cells.map((cell) => {
                const k = key(cell.coord);
                const count = counts?.get(k) ?? 0;
                const ghost = readMode ? count === 0 : cell.writeStep === null;
                const shade = readMode
                  ? (maxCount === 0 ? 0 : count / maxCount)
                  : heat(cell.writeStep);
                const cls = [
                  "dp-cell",
                  ghost && "dp-ghost",
                  k === writeKey && "dp-write",
                  readSet.has(k) && "dp-read",
                  missSet.has(k) && "dp-read-miss",
                  operandSet.has(k) && "dp-cone-operand",
                  dependentSet.has(k) && "dp-cone-dependent",
                  changedIds?.has(cell.id) && "cell-changed",
                ].filter(Boolean).join(" ");
                return (
                  <div
                    key={k}
                    className={cls}
                    data-coord={k}
                    title={view.keyed && candidate.dims.length === 2 ? cell.label : undefined}
                    style={{ width: pitch, height: pitch,
                             ...(ghost ? {} : { "--dp-heat": shade }) } as React.CSSProperties}
                    onClick={() => setDetail(cell)}
                  >
                    {dense ? "" : order ? (order.get(k) ?? "") : cell.value}
                  </div>
                );
              })}
            </div>
            {currentWrite && hitReads.length > 0 && (
              <svg className="dp-arrows" width={cols * pitch} height={rows * pitch}>
                {hitReads.map((r) => (
                  <path key={key(r)} d={arrowPath(r, currentWrite, pitch)} />
                ))}
              </svg>
            )}
          </div>
        </div>
      </div>
      <div className="dp-indices">
        {candidate.dims.length === 1 && !view.keyed &&
          cells.map((c) => <span key={key(c.coord)} style={{ width: pitch }}>{c.coord[0]}</span>)}
        {candidate.dims.length === 1 && view.keyed &&
          cells.map((c) => (
            <span key={key(c.coord)} className="dp-key-label" style={{ width: pitch }}>
              {c.label ?? ""}
            </span>
          ))}
      </div>
      {detail && (
        <div className="dp-detail">
          <span>
            {candidate.name}[{view.keyed && detail.label !== undefined ? detail.label : detail.coord.join("][")}] = {detail.value}
          </span>
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
