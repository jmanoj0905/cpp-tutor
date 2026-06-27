import { useRef } from "react";
import type { ExecPoint } from "../types/trace";
import { normalizeMemory } from "./memoryModel";
import { MemoryCell } from "./MemoryCell";
import { Connectors } from "./Connectors";

export function MemoryView({ point }: { point: ExecPoint }) {
  const memory = normalizeMemory(point);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="memory" ref={containerRef}>
      {memory.globals.length > 0 && (
        <section className="memory-section">
          <h3>Globals</h3>
          <div className="frame-cells">{memory.globals.map((c) => <MemoryCell key={c.id} cell={c} />)}</div>
        </section>
      )}
      {memory.frames.map((frame) => (
        <section className="memory-section frame" key={frame.id}>
          <div className="frame-name">{frame.name}</div>
          <div className="frame-cells">{frame.cells.map((c) => <MemoryCell key={c.id} cell={c} />)}</div>
        </section>
      ))}
      {memory.heap.length > 0 && (
        <section className="memory-section">
          <h3>Heap</h3>
          <div className="frame-cells">{memory.heap.map((c) => <MemoryCell key={c.id} cell={c} />)}</div>
        </section>
      )}
      <Connectors containerRef={containerRef} links={memory.links} stepKey={point.line} />
    </div>
  );
}
