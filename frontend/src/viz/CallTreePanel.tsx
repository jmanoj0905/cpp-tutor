import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { nodeState, type CallTree, type CallTreeNode } from "./callTree";
import { layoutTree, NODE_W, NODE_H, type NodePos } from "./treeLayout";
import { followIfOffscreen, pan, zoomAt, type Camera } from "./treeCamera";

export function CallTreePanel({ tree, step, onJump }: {
  tree: CallTree;
  step: number;
  onJump: (step: number) => void;
}) {
  const pos = useMemo(
    () => layoutTree(tree.roots, (n) => n.enterStep <= step),
    [tree, step],
  );
  const [cam, setCam] = useState<Camera>({ x: -24, y: -24, scale: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

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
        { x: p.x - NODE_W / 2, y: p.y, w: NODE_W, h: NODE_H },
        { w: el.clientWidth, h: el.clientHeight },
      ),
    );
  }, [step, tree, pos]);

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
          drag.current = { x: e.clientX, y: e.clientY };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
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
      >
        <g transform={`scale(${cam.scale}) translate(${-cam.x} ${-cam.y})`}>
          {tree.roots.map((r) => renderNode(r, null, pos, step, onJump))}
        </g>
      </svg>
      <div className="calltree-zoom">
        <button aria-label="Zoom in" onClick={() => zoomCenter(1.25)}>+</button>
        <button aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.25)}>−</button>
      </div>
    </div>
  );
}

function renderNode(
  node: CallTreeNode,
  parentPos: NodePos | null,
  pos: Map<number, NodePos>,
  step: number,
  onJump: (step: number) => void,
): ReactNode {
  const p = pos.get(node.id);
  if (!p) return null; // not yet called at this step
  const state = nodeState(node, step);
  const label =
    state === "returned" ? `${node.label} → ${node.returnValue ?? "?"}` : node.label;
  return (
    <g key={node.id}>
      {parentPos && (
        <line
          className="ct-edge"
          x1={parentPos.x}
          y1={parentPos.y + NODE_H}
          x2={p.x}
          y2={p.y}
        />
      )}
      <g
        className={`ct-node ct-${state}`}
        data-testid={`ct-node-${node.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onJump(node.enterStep);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <rect x={p.x - NODE_W / 2} y={p.y} width={NODE_W} height={NODE_H} rx={4} />
        <text x={p.x} y={p.y + NODE_H / 2}>{trimLabel(label)}</text>
      </g>
      {node.children.map((c) => renderNode(c, p, pos, step, onJump))}
    </g>
  );
}

function trimLabel(s: string): string {
  return s.length > 22 ? `${s.slice(0, 21)}…` : s;
}
