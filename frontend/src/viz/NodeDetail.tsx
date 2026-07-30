import { useMemo, useState } from "react";
import type { ExecPoint } from "../types/trace";
import { finalLabel, type CallTreeNode } from "./callTree";
import { inspectVariable } from "./frameInspector";
import { MemoryCell } from "./MemoryCell";

export function NodeDetail({ node, trace, onClose }: {
  node: CallTreeNode;
  trace: ExecPoint[];
  onClose: () => void;
}) {
  const [expandedVars, setExpandedVars] = useState<Set<string>>(new Set());
  const toggleVar = (name: string) =>
    setExpandedVars((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  return (
    <div className="ct-detail" data-testid="ct-detail">
      <div className="ct-detail-head">
        <span className="ct-detail-title">{finalLabel(node)}</span>
        <button aria-label="Close details" onClick={onClose}>×</button>
      </div>
      <dl className="ct-detail-rows">
        {node.args.map((a) => (
          <VarRow
            key={a.name}
            trace={trace}
            node={node}
            name={a.name}
            value={a.value}
            expanded={expandedVars.has(a.name)}
            onToggle={() => toggleVar(a.name)}
          />
        ))}
        <div>
          <dt>returns</dt>
          <dd>{node.exitStep === null ? "not returned yet" : node.returnValue ?? "?"}</dd>
        </div>
        <div><dt>frame</dt><dd>{node.address}</dd></div>
      </dl>
      <div className="ct-detail-steps">
        called at step {node.enterStep}
        {node.exitStep !== null && <> · returned at step {node.exitStep}</>}
      </div>
    </div>
  );
}

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
