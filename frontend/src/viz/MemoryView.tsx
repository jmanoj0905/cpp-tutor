import { useEffect, useRef, useState } from "react";
import type { ExecPoint } from "../types/trace";
import { normalizeMemory } from "./memoryModel";
import { MemoryCell } from "./MemoryCell";
import { Connectors, type ConnectorSelection } from "./Connectors";

export function MemoryView({ point }: { point: ExecPoint }) {
  const memory = normalizeMemory(point);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ConnectorSelection | null>(null);

  useEffect(() => { setSelected(null); }, [point]);
  const highlightedIds = selected ? new Set([selected.fromId, selected.toId]) : undefined;

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
            <div className={`frame${i === memory.frames.length - 1 ? " frame-current" : ""}`} key={frame.id}>
              <div className="frame-name">{frame.name}</div>
              <div className="frame-cells">
                {frame.cells.map((c) => <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} />)}
              </div>
            </div>
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
