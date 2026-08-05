import { useMemo, useState } from "react";
import type { ExecPoint } from "../../types/trace";
import { normalizeMemory } from "../memoryModel";
import { buildGraphScene, type ViewAs } from "./graphModel";
import { layoutScene, labelPoint } from "./graphLayout";

const W = 320, H = 320, PAD = 24, NODE_R = 14;

export function GraphPanel({ point, prevPoint, trace, step }: {
  point: ExecPoint; prevPoint: ExecPoint | null; trace: ExecPoint[]; step: number;
}) {
  const [viewAs, setViewAs] = useState<ViewAs>("auto");
  const [selected, setSelected] = useState<string | null>(null);

  const scene = useMemo(() => {
    const mem = normalizeMemory(point);
    const prev = prevPoint ? normalizeMemory(prevPoint) : null;
    return buildGraphScene(mem, prev, trace, step, viewAs);
  }, [point, prevPoint, trace, step, viewAs]);

  const layout = useMemo(() => (scene ? layoutScene(scene) : null), [scene]);
  if (!scene || !layout) return null;

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
        {scene.edges.map((e, i) => {
          const a = pos.get(e.from), b = pos.get(e.to);
          if (!a || !b) return null;
          const off = e.directed ? (e.from < e.to ? 8 : -8) : 0;
          const lp = labelPoint(px(a.x), py(a.y), px(b.x), py(b.y), off);
          return (
            <g key={i}>
              <line x1={px(a.x)} y1={py(a.y)} x2={px(b.x)} y2={py(b.y)}
                className={`graph-edge${e.dangling ? " is-dangling" : ""}${e.directed ? " is-directed" : ""}`} />
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
