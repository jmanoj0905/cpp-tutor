import { useEffect, useRef, useState } from "react";
import type { ExecPoint } from "../types/trace";
import { normalizeMemory } from "./memoryModel";
import { MemoryCell } from "./MemoryCell";
import { Connectors, type ConnectorSelection } from "./Connectors";

export function MemoryView({ point }: { point: ExecPoint }) {
  const memory = normalizeMemory(point);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ConnectorSelection | null>(null);

  // selection is per-step; drop it whenever the step changes
  useEffect(() => { setSelected(null); }, [point]);

  const highlightedIds = selected ? new Set([selected.fromId, selected.toId]) : undefined;

  return (
    <div className="memory" ref={containerRef} onClick={() => setSelected(null)}>
      {memory.globals.length > 0 && (
        <section className="memory-section">
          <h3>Globals</h3>
          <div className="frame-cells">{memory.globals.map((c) => <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} />)}</div>
        </section>
      )}
      {memory.frames.map((frame) => (
        <section className="memory-section frame" key={frame.id}>
          <div className="frame-name">{frame.name}</div>
          <div className="frame-cells">{frame.cells.map((c) => <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} />)}</div>
        </section>
      ))}
      {memory.heap.length > 0 && (
        <section className="memory-section">
          <h3>Heap</h3>
          <div className="frame-cells">{memory.heap.map((c) => <MemoryCell key={c.id} cell={c} highlightedIds={highlightedIds} />)}</div>
        </section>
      )}
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
