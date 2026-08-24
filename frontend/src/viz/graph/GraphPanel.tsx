import { useMemo, useState } from "react";
import { CloseButton } from "../CloseButton";
import { useEscape } from "../useEscape";
import type { ExecPoint } from "../../types/trace";
import { memoryAt } from "../memoryModel";
import { applyShapes, shapeInfoFor } from "../shapes";
import { buildGraphScene, type ViewAs } from "./graphModel";
import { layoutScene, labelPoint, trimEndpoint } from "./graphLayout";

const W = 320, H = 320, PAD = 24, NODE_R = 14;
// List nodes are boxes, not circles: every other runtime value in the app is a
// dotted box, so a chain of boxes reads as memory rather than as an abstract
// graph. Wider than tall to leave room for the value.
const BOX_W = 34, BOX_H = 22;
// How far a cycle back-edge bows away from the chain it re-enters. Without the
// bow it would lie exactly on top of the straight run between the same nodes.
const ARC_BOW = 34;
// Must match .graph-finger's font-size in index.css — it is the floor a finger
// label's baseline can sit at without clipping off the top of the viewBox.
const FINGER_SIZE = 9;
const NO_DISABLED: Set<string> = new Set();

export function GraphPanel({ point, prevPoint, trace, step }: {
  point: ExecPoint; prevPoint: ExecPoint | null; trace: ExecPoint[]; step: number;
}) {
  const [viewAs, setViewAs] = useState<ViewAs>("auto");
  const [selected, setSelected] = useState<string | null>(null);
  // Until this existed, clicking a node was a one-way door: the detail line
  // had no close control and nothing cleared the selection.
  useEscape(selected !== null, () => setSelected(null));

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
    <div className="tabs graph-view-toggle" role="tablist">
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
        <div className="empty-state">nothing to show for this view</div>
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
    scene.overlays.detached.has(id) && "is-detached",
    selected === id && "is-selected",
  ].filter(Boolean).join(" ");
  const terminalCls = (n: { terminal?: boolean }) => (n.terminal ? " is-terminal" : "");
  const boxed = scene.kind === "grid" || scene.kind === "list";
  // Half-extent an arrowhead must stop short of, so it sits at the node's rim
  // instead of under it.
  const rim = (scene.kind === "list" ? BOX_W / 2 : NODE_R) + 2;

  return (
    <div className="graph-panel">
      {toggle}
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
          const end = e.directed ? trimEndpoint(ax, ay, bx, by, rim) : { x: bx, y: by };
          const lp = labelPoint(ax, ay, bx, by, off);
          const edgeCls = `graph-edge${e.dangling ? " is-dangling" : ""}${e.directed ? " is-directed" : ""}${e.onPath ? " is-on-path" : ""}${e.cycleBack ? " is-cycle-back" : ""}`;
          // A back-edge runs right-to-left along the row it re-enters, so a
          // straight line would be drawn over the forward chain. Bow it out via
          // the same perpendicular offset the weight labels use.
          const bow = labelPoint(ax, ay, bx, by, ARC_BOW);
          return (
            <g key={i}>
              {e.cycleBack
                ? <path d={`M${ax},${ay} Q${bow.x},${bow.y} ${end.x},${end.y}`}
                    markerEnd={e.directed ? "url(#graph-arrow)" : undefined}
                    className={edgeCls} />
                : <line x1={ax} y1={ay} x2={end.x} y2={end.y}
                    markerEnd={e.directed ? "url(#graph-arrow)" : undefined}
                    className={edgeCls} />}
              {e.weight != null && (
                <text className="graph-edge-weight" x={lp.x} y={lp.y}
                  textAnchor="middle" dominantBaseline="central">{e.weight}</text>
              )}
              {/* A trie's character lives on the edge, because it IS the array
                  index the pointer was stored at — not a property of the node. */}
              {e.label != null && (
                <text className="graph-edge-label" x={lp.x} y={lp.y}
                  textAnchor="middle" dominantBaseline="central">{e.label}</text>
              )}
            </g>
          );
        })}
        {scene.nodes.map((n) => {
          const p = pos.get(n.id); if (!p) return null;
          const order = scene.overlays.order.get(n.id);
          const fingers = scene.overlays.fingers.get(n.id);
          const bw = scene.kind === "list" ? BOX_W : NODE_R * 2;
          const bh = scene.kind === "list" ? BOX_H : NODE_R * 2;
          return (
            <g key={n.id} data-node-id={n.id} className={`graph-node ${cls(n.id)}${terminalCls(n)}`}
               onClick={() => setSelected(n.id)}>
              {boxed
                ? <rect x={px(p.x) - bw / 2} y={py(p.y) - bh / 2} width={bw} height={bh} />
                : <circle cx={px(p.x)} cy={py(p.y)} r={NODE_R} />}
              {/* Accepting-state convention: an inner ring is what separates
                  "the trie contains app" from "app is only a prefix here". */}
              {n.terminal && (
                <circle className="graph-terminal-ring" cx={px(p.x)} cy={py(p.y)} r={NODE_R - 4} />
              )}
              <text x={px(p.x)} y={py(p.y)} textAnchor="middle" dominantBaseline="central">{n.label}</text>
              {/* Which pointer is where IS the algorithm in a two-pointer
                  problem, so the names sit above the node they stand on. */}
              {fingers && fingers.length > 0 && (
                // Clamped to the font's own height: a root sits at y = PAD, so
                // an unclamped label would be drawn with its ascender off the
                // top of the viewBox and get clipped.
                <text className="graph-finger" x={px(p.x)}
                  y={Math.max(FINGER_SIZE, py(p.y) - bh / 2 - 5)}
                  textAnchor="middle">{fingers.join(" ")}</text>
              )}
              {/* On a list the finger names own the space above the box — a
                  two-name label like "slow fast" is wider than the box itself
                  and would sit on top of a corner order badge — so the
                  traversal number goes underneath instead. */}
              {order != null && (scene.kind === "list"
                ? <text className="graph-order" x={px(p.x)} y={py(p.y) + bh / 2 + 9}
                    textAnchor="middle">{order}</text>
                : <text className="graph-order" x={px(p.x) + NODE_R} y={py(p.y) - NODE_R}>{order}</text>)}
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
      {selected && (
        <div className="graph-detail">
          <span>node {selected} — inspected at step {step}</span>
          <CloseButton onClick={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
}
