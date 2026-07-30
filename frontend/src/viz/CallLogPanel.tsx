import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ExecPoint } from "../types/trace";
import { finalLabel, nodeState, type CallTree, type CallTreeNode } from "./callTree";
import { countDescendants, isCollapsed } from "./callLog";
import { NodeDetail } from "./NodeDetail";

const INDENT = 16; // px per depth level

export function CallLogPanel({ tree, step, trace }: {
  tree: CallTree;
  step: number;
  trace: ExecPoint[];
}) {
  const [selected, setSelected] = useState<CallTreeNode | null>(null);
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);

  // Esc-to-deselect while something is selected.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // Follow the current call: scroll its row into view on step change.
  useEffect(() => {
    const el = listRef.current;
    if (!el || el.clientHeight === 0) return; // jsdom / not measured
    const current = tree.nodes.find((n) => nodeState(n, step) === "current");
    if (!current) return;
    el.querySelector(`[data-testid="cl-node-${current.id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [step, tree]);

  const toggleFold = (node: CallTreeNode) =>
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(node.id, !isCollapsed(node, step, prev));
      return next;
    });

  const rows: ReactNode[] = [];
  const walk = (node: CallTreeNode) => {
    const state = nodeState(node, step);
    const collapsed = isCollapsed(node, step, overrides);
    const foldable = node.children.length > 0;
    const label = state === "returned" ? finalLabel(node) : node.label;
    rows.push(
      <div
        key={node.id}
        data-testid={`cl-node-${node.id}`}
        className={`cl-node cl-${state}${selected?.id === node.id ? " cl-selected" : ""}`}
        style={{ paddingLeft: node.depth * INDENT }}
        onClick={() => setSelected(node)}
      >
        {foldable && (
          <button
            className="cl-fold"
            data-testid={`cl-fold-${node.id}`}
            aria-label={collapsed ? "Expand" : "Collapse"}
            onClick={(e) => { e.stopPropagation(); toggleFold(node); }}
          >
            {collapsed ? "▶" : "▼"}
          </button>
        )}
        <span className="cl-label">{label}</span>
        {collapsed && <span className="cl-count">({countDescendants(node)} calls)</span>}
      </div>,
    );
    if (!collapsed) node.children.forEach(walk);
  };
  tree.roots.forEach(walk);

  return (
    <div className="calllog">
      <div className="calllog-list" ref={listRef}>{rows}</div>
      {selected && <NodeDetail key={selected.id} node={selected} trace={trace} onClose={() => setSelected(null)} />}
    </div>
  );
}
