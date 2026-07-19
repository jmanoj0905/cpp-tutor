import { useEffect, useMemo, useRef, useState } from "react";
import type { ShapeEdge, ShapeModel, ShapeNode } from "./shapes";
import { CYCLE_ARC_H, layoutShape, shapeNodeWidth, SNODE_H, type SNodePos } from "./shapeLayout";
import { MemoryCell } from "./MemoryCell";

export function ShapePanel({ shape, changedIds, firstSeen, onToggleGeneric, stepKey }: {
  shape: ShapeModel;
  changedIds?: Set<string>;
  firstSeen?: Map<string, number>;
  onToggleGeneric: () => void;
  stepKey: number | string;
}) {
  const layout = useMemo(() => {
    const byId = new Map(shape.nodes.map((n) => [n.id, n]));
    return layoutShape(shape, (id) => shapeNodeWidth(byId.get(id)?.label ?? ""));
  }, [shape]);
  const [selected, setSelected] = useState<ShapeNode | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Deselect on step change and close on Escape.
  useEffect(() => { setSelected(null); }, [stepKey]);
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // Keep the action visible: scroll the just-changed (else first) node into view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target =
      shape.nodes.find((n) => n.payloadIds.some((id) => changedIds?.has(id))) ?? shape.nodes[0];
    if (!target) return;
    el.querySelector(`[data-cell-id="${CSS.escape(target.id)}"]`)
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [stepKey, shape, changedIds]);

  const markerId = `shape-arrow-${shape.typeName.replace(/[^a-zA-Z0-9]/g, "-")}`;

  return (
    <div className="shape-panel" data-testid={`shape-${shape.typeName}`}>
      <div className="shape-head">
        <span>{shape.typeName} ×{shape.nodes.length}</span>
        <button onClick={onToggleGeneric} title="Show raw heap cells">raw</button>
      </div>
      <div className="shape-scroll" ref={scrollRef}>
        <div className="shape-canvas" style={{ width: layout.width, height: layout.height }}>
          <svg className="shape-edges" width={layout.width} height={layout.height} aria-hidden>
            <defs>
              <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {shape.edges.map((e) => renderEdge(e, layout.pos, shape.kind, markerId, changedIds))}
          </svg>
          {shape.nodes.map((n) => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            const changed = n.payloadIds.some((id) => changedIds?.has(id));
            const cls = [
              "shape-node",
              changed ? "shape-node-changed" : "",
              selected?.id === n.id ? "shape-node-selected" : "",
              shape.detached.includes(n.id) ? "shape-node-detached" : "",
            ].filter(Boolean).join(" ");
            return (
              <div key={n.id} className={cls} data-cell-id={n.id}
                style={{ left: p.x, top: p.y, width: p.w }}
                onClick={() => setSelected(n)}>
                {n.label}
              </div>
            );
          })}
        </div>
      </div>
      {selected && (
        <div className="shape-detail" data-testid="shape-detail">
          <div className="shape-detail-head">
            <span>{shape.typeName} @ {selected.address}</span>
            <button aria-label="Close details" onClick={() => setSelected(null)}>×</button>
          </div>
          <MemoryCell cell={selected.cell} noPorts />
          <div className="shape-detail-steps">
            {firstSeen?.has(selected.address)
              ? `allocated at step ${firstSeen.get(selected.address)}`
              : "allocation step unknown"}
          </div>
        </div>
      )}
    </div>
  );
}

function renderEdge(
  e: ShapeEdge,
  pos: Map<string, SNodePos>,
  kind: "list" | "tree",
  markerId: string,
  changedIds?: Set<string>,
) {
  const from = pos.get(e.fromId);
  const to = pos.get(e.toId);
  if (!from || !to) return null;
  const changed = changedIds?.has(e.memberCellId);
  const marker = { markerEnd: `url(#${markerId})` };
  const key = `${e.fromId}-${e.member}`;

  if (e.cycleBack) {
    // arc from the bottom of `from` dipping under the row back to `to`
    const x1 = from.x + from.w / 2;
    const x2 = to.x + to.w / 2;
    const y = from.y + SNODE_H;
    const d = `M ${x1} ${y} C ${x1} ${y + CYCLE_ARC_H}, ${x2} ${y + CYCLE_ARC_H}, ${x2} ${y}`;
    return <path key={key} className={`shape-edge shape-edge-cycle${changed ? " shape-edge-changed" : ""}`} d={d} {...marker} />;
  }
  if (kind === "list" && from.y === to.y && to.x >= from.x) {
    // plain forward chain arrow
    return <line key={key} className={`shape-edge${changed ? " shape-edge-changed" : ""}`}
      x1={from.x + from.w} y1={from.y + SNODE_H / 2} x2={to.x} y2={to.y + SNODE_H / 2} {...marker} />;
  }
  // tree edge / cross-row list edge: center-bottom -> center-top
  return <line key={key} className={`shape-edge${changed ? " shape-edge-changed" : ""}`}
    x1={from.x + from.w / 2} y1={from.y + SNODE_H} x2={to.x + to.w / 2} y2={to.y} {...marker} />;
}
