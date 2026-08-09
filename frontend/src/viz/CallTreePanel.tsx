import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ExecPoint } from "../types/trace";
import { finalLabel, nodeState, type CallTree, type CallTreeNode } from "./callTree";
import { NodeDetail } from "./NodeDetail";
import { layoutTree, nodeWidth, NODE_H, type NodePos } from "./treeLayout";
import { followIfOffscreen, pan, zoomAt, type Camera } from "./treeCamera";
import { useEscape } from "./useEscape";

export function CallTreePanel({ tree, step, trace }: {
  tree: CallTree;
  step: number;
  trace: ExecPoint[];
}) {
  const pos = useMemo(
    () => layoutTree(tree.roots, (n) => nodeWidth(trimLabel(finalLabel(n)))),
    [tree],
  );
  const [cam, setCam] = useState<Camera>({ x: -24, y: -24, scale: 1 });
  const [selected, setSelected] = useState<CallTreeNode | null>(null);
  const select = (node: CallTreeNode | null) => setSelected(node);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false); // distinguishes a pan from a background click

  // Keep the current invocation in view while stepping; never fight a manual pan.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || el.clientWidth === 0) return; // jsdom / not yet measured
    const current = tree.nodes.find((n) => nodeState(n, step) === "current");
    const p = current ? pos.get(current.id) : undefined;
    if (!p) return;
    setCam((c) =>
      followIfOffscreen(
        c,
        { x: p.x - p.w / 2, y: p.y, w: p.w, h: NODE_H },
        { w: el.clientWidth, h: el.clientHeight },
      ),
    );
  }, [step, tree, pos]);

  // Selection deliberately survives a step change here: a call-tree node is
  // an invocation, not a per-step object, and NodeDetail reports its own step
  // numbers. Escape and the × are the ways out.
  useEscape(selected !== null, () => select(null));

  const zoomCenter = (factor: number) => {
    const el = svgRef.current;
    if (!el) return;
    setCam((c) => zoomAt(c, factor, el.clientWidth / 2, el.clientHeight / 2));
  };

  return (
    <div className="calltree">
      <svg
        ref={svgRef}
        className="calltree-svg"
        onPointerDown={(e) => {
          moved.current = false;
          drag.current = { x: e.clientX, y: e.clientY };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          moved.current = true;
          const prev = drag.current;
          drag.current = { x: e.clientX, y: e.clientY };
          setCam((c) => pan(c, e.clientX - prev.x, e.clientY - prev.y));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerLeave={() => { drag.current = null; }}
        onWheel={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setCam((c) =>
            zoomAt(c, e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top),
          );
        }}
        onClick={() => {
          if (!moved.current) select(null);
        }}
      >
        <g transform={`scale(${cam.scale}) translate(${-cam.x} ${-cam.y})`}>
          {tree.roots.map((r) => renderNode(r, null, pos, step, selected, select))}
        </g>
      </svg>
      <div className="calltree-zoom">
        <button aria-label="Zoom in" onClick={() => zoomCenter(1.25)}>+</button>
        <button aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.25)}>−</button>
      </div>
      {selected && <NodeDetail key={selected.id} node={selected} trace={trace} onClose={() => select(null)} />}
    </div>
  );
}

function renderNode(
  node: CallTreeNode,
  parentPos: NodePos | null,
  pos: Map<number, NodePos>,
  step: number,
  selected: CallTreeNode | null,
  onSelect: (node: CallTreeNode) => void,
): ReactNode {
  const p = pos.get(node.id)!;
  const state = nodeState(node, step);
  const lit = selected !== null && state === "future" && node.enterStep <= selected.enterStep;
  const label = state === "returned" ? finalLabel(node) : node.label;
  const cls = [
    "ct-node",
    `ct-${state}`,
    lit ? "ct-preview-lit" : "",
    selected?.id === node.id ? "ct-selected" : "",
  ].filter(Boolean).join(" ");
  return (
    <g key={node.id}>
      {parentPos && (
        <line
          className={`ct-edge${state === "future" && !lit ? " ct-edge-future" : ""}${state === "current" ? " ct-edge-current" : ""}`}
          x1={parentPos.x}
          y1={parentPos.y + NODE_H}
          x2={p.x}
          y2={p.y}
        />
      )}
      <g
        className={cls}
        data-testid={`ct-node-${node.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <rect x={p.x - p.w / 2} y={p.y} width={p.w} height={NODE_H} />
        <text x={p.x} y={p.y + NODE_H / 2}>{trimLabel(label)}</text>
      </g>
      {node.children.map((c) => renderNode(c, p, pos, step, selected, onSelect))}
    </g>
  );
}

function trimLabel(s: string): string {
  return s.length > 32 ? `${s.slice(0, 31)}…` : s;
}
