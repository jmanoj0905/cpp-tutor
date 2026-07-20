import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ExecPoint } from "../types/trace";
import { normalizeMemory, type NormalizedFrame } from "./memoryModel";
import { changedCellIds } from "./memoryDiff";
import { MemoryCell } from "./MemoryCell";
import { Connectors, type ConnectorSelection } from "./Connectors";
import { Divider } from "../Divider.tsx";
import { applyShapes, confirmShapeTypes } from "./shapes";
import { ShapePanel } from "./ShapePanel";
import { detectDpTables } from "./dp/detect";
import { buildDpView, type DpTableView } from "./dp/dpModel";

export function MemoryView({ point, prevPoint, trace, code }: {
  point: ExecPoint;
  prevPoint?: ExecPoint | null;
  trace: ExecPoint[];
  code: string;
}) {
  // Intentionally recomputed every render (not memoized on [point]): the
  // per-frame internals toggle relies on `memory.links` getting a fresh array
  // identity so the Connectors effect re-measures after newly-revealed internal
  // ports mount. A useMemo here would silently break connector redraw on expand.
  const memory = normalizeMemory(point);
  const changedIds = changedCellIds(prevPoint ? normalizeMemory(prevPoint) : null, memory);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ConnectorSelection | null>(null);
  const [expandedFrames, setExpandedFrames] = useState<Set<string>>(new Set());
  const [split, setSplit] = useState(50);
  const shapeInfo = useMemo(() => confirmShapeTypes(trace), [trace]);
  const [disabledShapes, setDisabledShapes] = useState<Set<string>>(new Set());
  const { memory: shaped, shapes } = applyShapes(memory, shapeInfo.confirmed, disabledShapes, shapeInfo.selfNames);
  const toggleShape = (typeName: string) =>
    setDisabledShapes((prev) => {
      const next = new Set(prev);
      if (next.has(typeName)) next.delete(typeName); else next.add(typeName);
      return next;
    });

  const dpCandidates = useMemo(() => detectDpTables(trace, code), [trace, code]);
  const [disabledDp, setDisabledDp] = useState<Set<string>>(new Set());
  const step = trace.indexOf(point);
  const codeLines = useMemo(() => code.split("\n"), [code]);
  const dpViews = useMemo(() => {
    const m = new Map<string, DpTableView>();
    for (const c of dpCandidates) {
      if (disabledDp.has(c.cellId)) continue;
      m.set(c.cellId, buildDpView(c, step, point, memory, codeLines));
    }
    return m;
    // memory identity changes every render; safe: views derive from point
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpCandidates, disabledDp, step, point, codeLines]);
  const toggleDp = (cellId: string) =>
    setDisabledDp((prev) => {
      const n = new Set(prev);
      if (n.has(cellId)) n.delete(cellId); else n.add(cellId);
      return n;
    });

  useEffect(() => { setSelected(null); }, [point]);
  const highlightedIds = selected ? new Set([selected.fromId, selected.toId]) : undefined;

  const toggleFrame = (id: string) =>
    setExpandedFrames((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="memory" ref={containerRef} onClick={() => setSelected(null)}>
      <div className="panes" style={{ "--mem-split": `${split}%` } as CSSProperties}>
        <section className="stack-pane">
          <h3>Stack</h3>
          {memory.globals.length > 0 && (
            <div className="frame">
              <div className="frame-name">Globals</div>
              <div className="frame-cells">
                {memory.globals.map((c) => <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} changedIds={changedIds} dpViews={dpViews} onDpToggle={toggleDp} />)}
              </div>
            </div>
          )}
          {memory.frames.map((frame, i) => (
            <FrameView
              key={frame.id}
              frame={frame}
              current={i === memory.frames.length - 1}
              expanded={expandedFrames.has(frame.id)}
              onToggle={() => toggleFrame(frame.id)}
              highlightedIds={highlightedIds}
              changedIds={changedIds}
              dpViews={dpViews}
              onDpToggle={toggleDp}
            />
          ))}
          {disabledDp.size > 0 && (
            <button className="internals-toggle" onClick={() => setDisabledDp(new Set())}>
              ▸ DP view off for {dpCandidates.filter((c) => disabledDp.has(c.cellId)).map((c) => c.name).join(", ")} — restore
            </button>
          )}
        </section>
        <Divider container=".panes" onResize={setSplit} />
        <section className="heap-pane">
          <h3>Heap</h3>
          {shapes.map((s) => (
            <ShapePanel
              key={s.typeName}
              shape={s}
              changedIds={changedIds}
              firstSeen={shapeInfo.firstSeen}
              onToggleGeneric={() => toggleShape(s.typeName)}
              stepKey={point.line}
            />
          ))}
          {disabledShapes.size > 0 && (
            <button className="internals-toggle" onClick={() => setDisabledShapes(new Set())}>
              ▸ shape view off for {[...disabledShapes].join(", ")} — restore
            </button>
          )}
          <div className="frame-cells">
            {shaped.heap.map((c) => <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} changedIds={changedIds} dpViews={dpViews} onDpToggle={toggleDp} />)}
          </div>
        </section>
      </div>
      <Connectors
        containerRef={containerRef}
        links={memory.links}
        stepKey={`${point.line}:${split}`}
        selected={selected}
        onSelect={(link) => setSelected(link)}
      />
    </div>
  );
}

function FrameView({
  frame, current, expanded, onToggle, highlightedIds, changedIds, dpViews, onDpToggle,
}: {
  frame: NormalizedFrame;
  current: boolean;
  expanded: boolean;
  onToggle: () => void;
  highlightedIds?: Set<string>;
  changedIds?: Set<string>;
  dpViews?: Map<string, DpTableView>;
  onDpToggle?: (cellId: string) => void;
}) {
  const visible = frame.cells.filter((c) => !c.internal);
  const internal = frame.cells.filter((c) => c.internal);
  return (
    <div className={`frame${current ? " frame-current" : ""}`}>
      <div className="frame-name">{frame.name}</div>
      <div className="frame-cells">
        {visible.map((c) => <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} changedIds={changedIds} dpViews={dpViews} onDpToggle={onDpToggle} />)}
        {internal.length > 0 && (
          <>
            <button className="internals-toggle" onClick={onToggle}>
              {expanded ? "▾" : "▸"} {internal.length} internal{internal.length > 1 ? "s" : ""}
            </button>
            {expanded && internal.map((c) => (
              <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} changedIds={changedIds} dpViews={dpViews} onDpToggle={onDpToggle} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
