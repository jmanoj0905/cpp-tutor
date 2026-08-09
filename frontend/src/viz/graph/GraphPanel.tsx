import { useMemo, useState } from "react";
import type { ExecPoint } from "../../types/trace";
import { memoryAt } from "../memoryModel";
import { applyShapes, shapeInfoFor } from "../shapes";
import { buildGraphScene, type ViewAs } from "./graphModel";
import { layoutScene, labelPoint, trimEndpoint } from "./graphLayout";

const W = 320, H = 320, PAD = 24, NODE_R = 14;
const NO_DISABLED: Set<string> = new Set();

export function GraphPanel({ point, prevPoint, trace, step }: {
  point: ExecPoint; prevPoint: ExecPoint | null; trace: ExecPoint[]; step: number;
}) {
  const [viewAs, setViewAs] = useState<ViewAs>("auto");
  const [selected, setSelected] = useState<string | null>(null);

  const scene = useMemo(() => {
    const mem = memoryAt(point);
    const prev = prevPoint ? memoryAt(prevPoint) : null;
    const info = shapeInfoFor(trace);
    // The Graph tab has no per-type shape disable toggle (that lives in
    // MemoryView), so nothing is ever disabled here.
    const { shapes } = applyShapes(mem, info.confirmed, NO_DISABLED, info.selfNames);
    return buildGraphScene(mem, prev, trace, step, viewAs, shapes);
  }, [point, prevPoint, trace, step, viewAs]);

  const layout = useMemo(() => (scene ? layoutScene(scene) : null), [scene]);

  // A view toggle button is the only way back to "auto"/"graph" once picked.
  // Finding 3: `viewAs: "grid"` is a dead end on a pure pointer-tree program
  // (no matrix container, so buildGraphScene returns null for that view) —
  // returning null for the whole panel here would strand the user with no
  // control left to escape "grid". Always render the toggle; only the canvas
  // beneath it is conditional on having a scene.
  const toggle = (
    <div className="graph-view-toggle" role="tablist">
      {(["auto", "graph", "grid"] as ViewAs[]).map((v) => (
        <button key={v} role="tab" aria-selected={viewAs === v}
          onClick={() => setViewAs(v)}>{v}</button>
      ))}
    </div>
  );

  if (!scene || !layout) {
    return (
      <div className="graph-panel">
        {toggle}
        <div className="graph-empty">nothing to show for this view</div>
      </div>
    );
  }

  const pos = new Map(layout.placed.map((p) => [p.id, p]));
  const px = (x: number) => PAD + x * (W - 2 * PAD);
  const py = (y: number) => PAD + y * (H - 2 * PAD);
  const cls = (id: string) => [
    scene.overlays.visited.has(id) && "is-visited",
    scene.overlays.current.includes(id) && "is-current",
    scene.overlays.frontier.has(id) && "is-frontier",
    scene.overlays.flashed.has(id) && "is-flashed",
    selected === id && "is-selected",
  ].filter(Boolean).join(" ");

  return (
    <div className="graph-panel">
      <div className="graph-view-toggle" role="tablist">
        {(["auto", "graph", "grid"] as ViewAs[]).map((v) => (
          <button key={v} role="tab" aria-selected={viewAs === v}
            onClick={() => setViewAs(v)}>{v}</button>
        ))}
      </div>
      <div className="graph-canvas">
      <svg className="graph-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path className="graph-arrow-head" d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>
        {scene.edges.map((e, i) => {
          const a = pos.get(e.from), b = pos.get(e.to);
          if (!a || !b) return null;
          const off = e.directed ? (e.from < e.to ? 8 : -8) : 0;
          const ax = px(a.x), ay = py(a.y), bx = px(b.x), by = py(b.y);
          const end = e.directed ? trimEndpoint(ax, ay, bx, by, NODE_R + 2) : { x: bx, y: by };
          const lp = labelPoint(ax, ay, bx, by, off);
          return (
            <g key={i}>
              <line x1={ax} y1={ay} x2={end.x} y2={end.y}
                markerEnd={e.directed ? "url(#graph-arrow)" : undefined}
                className={`graph-edge${e.dangling ? " is-dangling" : ""}${e.directed ? " is-directed" : ""}${e.onPath ? " is-on-path" : ""}`} />
              {e.weight != null && (
                <text className="graph-edge-weight" x={lp.x} y={lp.y}
                  textAnchor="middle" dominantBaseline="central">{e.weight}</text>
              )}
            </g>
          );
        })}
        {scene.nodes.map((n) => {
          const p = pos.get(n.id); if (!p) return null;
          const order = scene.overlays.order.get(n.id);
          return (
            <g key={n.id} data-node-id={n.id} className={`graph-node ${cls(n.id)}`}
               onClick={() => setSelected(n.id)}>
              {scene.kind === "grid"
                ? <rect x={px(p.x) - NODE_R} y={py(p.y) - NODE_R} width={NODE_R * 2} height={NODE_R * 2} />
                : <circle cx={px(p.x)} cy={py(p.y)} r={NODE_R} />}
              <text x={px(p.x)} y={py(p.y)} textAnchor="middle" dominantBaseline="central">{n.label}</text>
              {order != null && <text className="graph-order" x={px(p.x) + NODE_R} y={py(p.y) - NODE_R}>{order}</text>}
              {scene.kind !== "grid" && scene.dist?.get(n.id) != null && (
                <text className="graph-node-dist" x={px(p.x)} y={py(p.y) + NODE_R + 9} textAnchor="middle">
                  {scene.dist.get(n.id)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      </div>
      {selected && <div className="graph-detail">node {selected} — inspected at step {step}</div>}
    </div>
  );
}
