import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ExecPoint } from "../types/trace";
import { normalizeMemory, findCellById, dimmedLinkSources, type NormalizedFrame } from "./memoryModel";
import { applyCharView } from "./charView";
import { changedCellIds } from "./memoryDiff";
import { MemoryCell, type CellView } from "./MemoryCell";
import { Connectors, type ConnectorSelection } from "./Connectors";
import { Divider } from "../Divider.tsx";
import { toggleInSet } from "../util";
import { applyShapes, shapeInfoFor } from "./shapes";
import { ShapePanel } from "./ShapePanel";
import { HeapTreeOverlay } from "./stl/HeapTreeOverlay";
import { detectDpTables } from "./dp/detect";
import { buildDpView, collectReadSteps, type DpTableView } from "./dp/dpModel";

export function MemoryView({ point, prevPoint, trace, code, activeHeapCell = null, onHeapOpen, onHeapClose }: {
  point: ExecPoint;
  prevPoint?: ExecPoint | null;
  trace: ExecPoint[];
  code: string;
  activeHeapCell?: string | null;
  onHeapOpen?: (id: string) => void;
  onHeapClose?: () => void;
}) {
  // Intentionally recomputed every render (not memoized on [point]): the
  // per-frame internals toggle relies on `memory.links` getting a fresh array
  // identity so the Connectors effect re-measures after newly-revealed internal
  // ports mount. A useMemo here would silently break connector redraw on expand.
  const memory = normalizeMemory(point);
  // Diff is computed on the raw tree; char-view preserves ids so highlights
  // still resolve. The char-view transform runs every render to annotate
  // togglable cells (even when nothing is switched on).
  const [charView, setCharView] = useState<Set<string>>(new Set());
  const toggleCharView = (cellId: string) => setCharView((prev) => toggleInSet(prev, cellId));
  const viewMemory = applyCharView(memory, charView);
  const changedIds = changedCellIds(prevPoint ? normalizeMemory(prevPoint) : null, memory);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ConnectorSelection | null>(null);
  const [expandedFrames, setExpandedFrames] = useState<Set<string>>(new Set());
  const [split, setSplit] = useState(50);
  const shapeInfo = useMemo(() => shapeInfoFor(trace), [trace]);
  const [disabledShapes, setDisabledShapes] = useState<Set<string>>(new Set());
  const { memory: shaped, shapes } = applyShapes(viewMemory, shapeInfo.confirmed, disabledShapes, shapeInfo.selfNames);
  const toggleShape = (typeName: string) => setDisabledShapes((prev) => toggleInSet(prev, typeName));

  const dpCandidates = useMemo(() => detectDpTables(trace, code), [trace, code]);
  const [disabledDp, setDisabledDp] = useState<Set<string>>(new Set());
  const step = trace.indexOf(point);
  const heapRoots = [...viewMemory.globals, ...viewMemory.frames.flatMap((f) => f.cells), ...viewMemory.heap];
  const rawHeapCell = activeHeapCell ? findCellById(heapRoots, activeHeapCell) : null;
  const heapCell = rawHeapCell?.containerKind === "priority_queue" ? rawHeapCell : null;
  const heapMissing = activeHeapCell !== null && heapCell === null;
  useEffect(() => {
    if (heapMissing) onHeapClose?.();
  }, [heapMissing, onHeapClose]);
  const codeLines = useMemo(() => code.split("\n"), [code]);
  const dpViews = useMemo(() => {
    const m = new Map<string, DpTableView>();
    for (const c of dpCandidates) {
      if (disabledDp.has(c.cellId)) continue;
      m.set(c.cellId, buildDpView(c, step, point, memory, codeLines, trace[step - 1] ?? null));
    }
    return m;
    // memory identity changes every render; safe: views derive from point
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpCandidates, disabledDp, step, point, codeLines, trace]);
  const toggleDp = (cellId: string) => setDisabledDp((prev) => toggleInSet(prev, cellId));
  // Whole-trace, so computed once per candidate set (not per step).
  const dpReadSteps = useMemo(() => {
    const m = new Map<string, Map<string, number[]>>();
    for (const c of dpCandidates) m.set(c.cellId, collectReadSteps(trace, c, codeLines));
    return m;
  }, [dpCandidates, trace, codeLines]);

  const cellView: CellView = {
    highlightedIds: selected ? new Set([selected.fromId, selected.toId]) : undefined,
    changedIds,
    dpViews,
    onDpToggle: toggleDp,
    onCharViewToggle: toggleCharView,
    onHeapOpen,
    dpReadSteps,
  };

  useEffect(() => { setSelected(null); }, [point]);

  const toggleFrame = (id: string) => setExpandedFrames((prev) => toggleInSet(prev, id));

  return (
    <div className="memory" ref={containerRef} onClick={() => setSelected(null)}>
      <div className="panes" style={{ "--mem-split": `${split}%` } as CSSProperties}>
        <section className="stack-pane">
          <h3>Stack</h3>
          {viewMemory.globals.length > 0 && (
            <div className="frame">
              <div className="frame-name">Globals</div>
              <div className="frame-cells">
                {viewMemory.globals.map((c) => <MemoryCell key={c.id} cell={c} view={cellView} />)}
              </div>
            </div>
          )}
          {viewMemory.frames.map((frame, i) => (
            <FrameView
              key={frame.id}
              frame={frame}
              current={i === viewMemory.frames.length - 1}
              expanded={expandedFrames.has(frame.id)}
              onToggle={() => toggleFrame(frame.id)}
              view={cellView}
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
            {shaped.heap.map((c) => <MemoryCell key={c.id} cell={c} view={cellView} />)}
          </div>
        </section>
      </div>
      <Connectors
        containerRef={containerRef}
        links={memory.links}
        stepKey={`${point.line}:${split}`}
        selected={selected}
        onSelect={(link) => setSelected(link)}
        dimmedFromIds={dimmedLinkSources(memory)}
      />
      {heapCell && (
        <HeapTreeOverlay
          cell={heapCell}
          step={step}
          onClose={() => onHeapClose?.()}
          view={cellView}
        />
      )}
    </div>
  );
}

function FrameView({ frame, current, expanded, onToggle, view }: {
  frame: NormalizedFrame;
  current: boolean;
  expanded: boolean;
  onToggle: () => void;
  view: CellView;
}) {
  const visible = frame.cells.filter((c) => !c.internal);
  const internal = frame.cells.filter((c) => c.internal);
  return (
    <div className={`frame${current ? " frame-current" : ""}`}>
      <div className="frame-name">{frame.name}</div>
      <div className="frame-cells">
        {visible.map((c) => <MemoryCell key={c.id} cell={c} view={view} />)}
        {internal.length > 0 && (
          <>
            <button className="internals-toggle" onClick={onToggle}>
              {expanded ? "▾" : "▸"} {internal.length} internal{internal.length > 1 ? "s" : ""}
            </button>
            {expanded && internal.map((c) => (
              <MemoryCell key={c.id} cell={c} view={view} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
