import type { NormalizedCell } from "../memoryModel";
import { MemoryCell } from "../MemoryCell";
import { buildHeapLayout } from "./heapTree";

const ROW_H = 64;   // px vertical pitch between tree levels
const SLOT_W = 96;  // px horizontal pitch for the widest row

export function HeapTreePanel({ cell, highlightedIds, changedIds, onCharViewToggle }: {
  cell: NormalizedCell;
  highlightedIds?: Set<string>;
  changedIds?: Set<string>;
  onCharViewToggle?: (cellId: string) => void;
}) {
  const { nodes, edges, rows } = buildHeapLayout(cell.children ?? []);
  const width = 2 ** Math.max(rows - 1, 0) * SLOT_W;
  const height = Math.max(rows, 1) * ROW_H;
  const xy = (index: number) => {
    const n = nodes.find((m) => m.index === index)!;
    return { x: n.col * width, y: n.row * ROW_H + ROW_H / 2 };
  };
  return (
    <div className="heap-tree-scroll" data-heap-tree={cell.id}>
      <div className="heap-tree" style={{ width, height, position: "relative" }}>
        <svg className="heap-edges" width={width} height={height}>
          {edges.map((e) => {
            const p = xy(e.parent), c = xy(e.child);
            return <line key={`${e.parent}-${e.child}`} x1={p.x} y1={p.y} x2={c.x} y2={c.y} />;
          })}
        </svg>
        {nodes.map((n) => (
          <div
            key={n.cell.id}
            className={`heap-node${n.index === 0 ? " heap-node-top" : ""}`}
            style={{ position: "absolute", left: n.col * width, top: n.row * ROW_H, transform: "translateX(-50%)" }}
          >
            <MemoryCell
              cell={n.cell}
              highlightedIds={highlightedIds}
              changedIds={changedIds}
              onCharViewToggle={onCharViewToggle}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
