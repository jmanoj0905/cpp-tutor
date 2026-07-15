import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { finalLabel, nodeState, type CallTree, type CallTreeNode } from "./callTree";
import { layoutTree, nodeWidth, NODE_H, type NodePos } from "./treeLayout";
import { followIfOffscreen, pan, zoomAt, type Camera } from "./treeCamera";

export function CallTreePanel({ tree, step }: {
  tree: CallTree;
  step: number;
}) {
  const pos = useMemo(
    () => layoutTree(tree.roots, (n) => nodeWidth(trimLabel(finalLabel(n)))),
    [tree],
  );
  const [cam, setCam] = useState<Camera>({ x: -24, y: -24, scale: 1 });
  const [selected, setSelected] = useState<CallTreeNode | null>(null);
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

  // Esc-to-deselect — listener only while something is selected.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

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
          if (!moved.current) setSelected(null);
        }}
      >
        <g transform={`scale(${cam.scale}) translate(${-cam.x} ${-cam.y})`}>
          {tree.roots.map((r) => renderNode(r, null, pos, step, selected, setSelected))}
        </g>
      </svg>
      <div className="calltree-zoom">
        <button aria-label="Zoom in" onClick={() => zoomCenter(1.25)}>+</button>
        <button aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.25)}>−</button>
      </div>
      {selected && (
        <div className="ct-detail" data-testid="ct-detail">
          <div className="ct-detail-head">
            <span className="ct-detail-title">{finalLabel(selected)}</span>
            <button aria-label="Close details" onClick={() => setSelected(null)}>×</button>
          </div>
          <dl className="ct-detail-rows">
            {selected.args.map((a) => (
              <div key={a.name}><dt>{a.name}</dt><dd>{a.value}</dd></div>
            ))}
            <div>
              <dt>returns</dt>
              <dd>{selected.exitStep === null ? "not returned yet" : selected.returnValue ?? "?"}</dd>
            </div>
            <div><dt>frame</dt><dd>{selected.address}</dd></div>
          </dl>
          <div className="ct-detail-steps">
            called at step {selected.enterStep}
            {selected.exitStep !== null && <> · returned at step {selected.exitStep}</>}
          </div>
        </div>
      )}
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
          className={`ct-edge${state === "future" && !lit ? " ct-edge-future" : ""}`}
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
