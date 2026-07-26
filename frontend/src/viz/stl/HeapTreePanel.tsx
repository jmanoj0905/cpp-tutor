import { useLayoutEffect, useRef, useState } from "react";
import type { NormalizedCell } from "../memoryModel";
import { MemoryCell } from "../MemoryCell";
import { buildHeapLayout } from "./heapTree";
import { layoutHeapTree, type NodeSize } from "./heapTreeGeometry";

export function HeapTreePanel({ cell, highlightedIds, changedIds, onCharViewToggle }: {
  cell: NormalizedCell;
  highlightedIds?: Set<string>;
  changedIds?: Set<string>;
  onCharViewToggle?: (cellId: string) => void;
}) {
  const { nodes, edges } = buildHeapLayout(cell.children ?? []);
  const nodeRefs = useRef(new Map<number, HTMLDivElement>());
  const [sizes, setSizes] = useState<Map<number, NodeSize>>(new Map());

  // Measure the rendered node boxes and lay the tree out from their real
  // dimensions. useLayoutEffect runs before paint, so nodes never flash at the
  // origin. Re-measures whenever the heap contents change (new step) or the
  // container resizes (a nested payload growing/shrinking).
  useLayoutEffect(() => {
    const measure = () => {
      const next = new Map<number, NodeSize>();
      for (const [index, el] of nodeRefs.current) {
        next.set(index, { w: el.offsetWidth, h: el.offsetHeight });
      }
      setSizes((prev) => {
        if (prev.size === next.size &&
          [...next].every(([i, s]) => prev.get(i)?.w === s.w && prev.get(i)?.h === s.h)) {
          return prev;
        }
        return next;
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    for (const el of nodeRefs.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [cell]);

  const size = (index: number): NodeSize => sizes.get(index) ?? { w: 0, h: 0 };
  const measured = sizes.size >= nodes.length && nodes.length > 0;
  const geom = measured ? layoutHeapTree(nodes, edges, size) : null;
  const pos = (index: number) => geom?.positions.find((p) => p.index === index);

  return (
    <div className="heap-tree-scroll" data-heap-tree={cell.id}>
      <div
        className="heap-tree"
        style={{ position: "relative", width: geom?.width, height: geom?.height, visibility: measured ? "visible" : "hidden" }}
      >
        {geom && (
          <svg className="heap-edges" width={geom.width} height={geom.height}>
            {geom.edges.map((e) => (
              <line key={`${e.parent}-${e.child}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
            ))}
          </svg>
        )}
        {nodes.map((n) => {
          const p = pos(n.index);
          return (
            <div
              key={n.cell.id}
              ref={(el) => {
                if (el) nodeRefs.current.set(n.index, el);
                else nodeRefs.current.delete(n.index);
              }}
              className={`heap-node${n.index === 0 ? " heap-node-top" : ""}`}
              style={{
                position: "absolute",
                left: p ? p.cx : 0,
                top: p ? p.top : 0,
                transform: "translateX(-50%)",
              }}
            >
              <MemoryCell
                cell={n.cell}
                highlightedIds={highlightedIds}
                changedIds={changedIds}
                onCharViewToggle={onCharViewToggle}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
