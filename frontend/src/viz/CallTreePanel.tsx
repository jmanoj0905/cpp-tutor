import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ExecPoint } from "../types/trace";
import { finalLabel, nodeState, type CallTree, type CallTreeNode } from "./callTree";
import { inspectVariable } from "./frameInspector";
import { MemoryCell } from "./MemoryCell";
import { layoutTree, nodeWidth, NODE_H, type NodePos } from "./treeLayout";
import { followIfOffscreen, pan, zoomAt, type Camera } from "./treeCamera";

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
  const [expandedVars, setExpandedVars] = useState<Set<string>>(new Set());
  const select = (node: CallTreeNode | null) => {
    setSelected(node);
    setExpandedVars(new Set());
  };
  const toggleVar = (name: string) =>
    setExpandedVars((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
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
      if (e.key === "Escape") select(null);
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
      {selected && (
        <div className="ct-detail" data-testid="ct-detail">
          <div className="ct-detail-head">
            <span className="ct-detail-title">{finalLabel(selected)}</span>
            <button aria-label="Close details" onClick={() => select(null)}>×</button>
          </div>
          <dl className="ct-detail-rows">
            {selected.args.map((a) => (
              <VarRow
                key={a.name}
                trace={trace}
                node={selected}
                name={a.name}
                value={a.value}
                expanded={expandedVars.has(a.name)}
                onToggle={() => toggleVar(a.name)}
              />
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

// One arg row in the detail panel. Clicking it expands the variable's decoded
// call-time value tree (reference params auto-deref to their target) under the
// row; several rows can stay expanded at once. Decode is deferred until the
// first expand and memoized per (node, name).
function VarRow({ trace, node, name, value, expanded, onToggle }: {
  trace: ExecPoint[];
  node: CallTreeNode;
  name: string;
  value: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const inspected = useMemo(
    () => (expanded ? inspectVariable(trace, node, name) : null),
    [expanded, trace, node, name],
  );
  return (
    <div
      className="ct-detail-var"
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <dt>{name}</dt>
      <dd>{value}</dd>
      {expanded && (
        <div className="ct-detail-inspect" onClick={(e) => e.stopPropagation()}>
          {inspected ? (
            <>
              <div className="ct-detail-inspect-head">at step {inspected.step}</div>
              <MemoryCell cell={inspected.cell} noPorts />
            </>
          ) : (
            <div className="ct-detail-inspect-head">not recoverable</div>
          )}
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
