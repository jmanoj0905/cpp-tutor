import { useEffect, useRef, useState } from "react";
import type { ExecPoint } from "../types/trace";
import { normalizeMemory, type NormalizedFrame } from "./memoryModel";
import { MemoryCell } from "./MemoryCell";
import { Connectors, type ConnectorSelection } from "./Connectors";

export function MemoryView({ point }: { point: ExecPoint }) {
  // Intentionally recomputed every render (not memoized on [point]): the
  // per-frame internals toggle relies on `memory.links` getting a fresh array
  // identity so the Connectors effect re-measures after newly-revealed internal
  // ports mount. A useMemo here would silently break connector redraw on expand.
  const memory = normalizeMemory(point);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ConnectorSelection | null>(null);
  const [expandedFrames, setExpandedFrames] = useState<Set<string>>(new Set());

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
      <div className="panes">
        <section className="stack-pane">
          <h3>Stack</h3>
          {memory.globals.length > 0 && (
            <div className="frame">
              <div className="frame-name">Globals</div>
              <div className="frame-cells">
                {memory.globals.map((c) => <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} />)}
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
            />
          ))}
        </section>
        <section className="heap-pane">
          <h3>Heap</h3>
          <div className="frame-cells">
            {memory.heap.map((c) => <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} />)}
          </div>
        </section>
      </div>
      <Connectors
        containerRef={containerRef}
        links={memory.links}
        stepKey={point.line}
        selected={selected}
        onSelect={(link) => setSelected(link)}
      />
    </div>
  );
}

function FrameView({
  frame, current, expanded, onToggle, highlightedIds,
}: {
  frame: NormalizedFrame;
  current: boolean;
  expanded: boolean;
  onToggle: () => void;
  highlightedIds?: Set<string>;
}) {
  const visible = frame.cells.filter((c) => !c.internal);
  const internal = frame.cells.filter((c) => c.internal);
  return (
    <div className={`frame${current ? " frame-current" : ""}`}>
      <div className="frame-name">{frame.name}</div>
      <div className="frame-cells">
        {visible.map((c) => <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} />)}
        {internal.length > 0 && (
          <>
            <button className="internals-toggle" onClick={onToggle}>
              {expanded ? "▾" : "▸"} {internal.length} internal{internal.length > 1 ? "s" : ""}
            </button>
            {expanded && internal.map((c) => (
              <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
