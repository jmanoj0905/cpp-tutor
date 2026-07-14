// Pure call-tree construction from a trace — no React, no DOM.
// Frame identity subtlety: frame_id is a stack address and is REUSED by a
// sibling invocation pushed right after a pop, so unique_hash can be identical
// for two different invocations at the same stack position across consecutive
// points. The "call" event marks the top frame as freshly pushed and is the
// only reliable disambiguator for that case.
import type { ExecPoint } from "../types/trace";
import { isCompilerInternal } from "./memoryModel";

export interface CallTreeNode {
  id: number;
  funcName: string;
  label: string;
  enterStep: number;
  exitStep: number | null;
  returnValue: string | null;
  depth: number;
  children: CallTreeNode[];
}

export interface CallTree {
  roots: CallTreeNode[];
  nodes: CallTreeNode[];
  hasRecursion: boolean;
}

interface OptFrame {
  func_name?: string;
  frame_id?: string;
  unique_hash?: string;
  ordered_varnames?: string[];
  encoded_locals?: Record<string, unknown>;
  is_zombie?: boolean;
}

const liveFrames = (p: ExecPoint): OptFrame[] =>
  (p.stack_to_render as OptFrame[]).filter((f) => !f.is_zombie);

const frameHash = (f: OptFrame, index: number): string =>
  f.unique_hash ?? f.frame_id ?? `${f.func_name}-${index}`;

export function buildCallTree(trace: ExecPoint[]): CallTree {
  const roots: CallTreeNode[] = [];
  const nodes: CallTreeNode[] = [];
  const live: { node: CallTreeNode; hash: string }[] = [];
  let hasRecursion = false;

  trace.forEach((point, step) => {
    const fs = liveFrames(point);

    let k = 0;
    while (k < live.length && k < fs.length && live[k].hash === frameHash(fs[k], k)) k++;

    // Address-reuse case: full prefix match but the point is a "call" event,
    // so the top frame is a new invocation, not the one we matched.
    if (point.event === "call" && k === fs.length && k === live.length && k > 0) k--;

    while (live.length > k) live.pop()!.node.exitStep = step - 1;

    for (let j = k; j < fs.length; j++) {
      const f = fs[j];
      const funcName = f.func_name ?? "?";
      if (live.some((l) => l.node.funcName === funcName)) hasRecursion = true;
      const node: CallTreeNode = {
        id: nodes.length,
        funcName,
        label: `${funcName}(${argsLabel(f)})`,
        enterStep: step,
        exitStep: null,
        returnValue: null,
        depth: live.length,
        children: [],
      };
      nodes.push(node);
      const parent = live[live.length - 1];
      if (parent) parent.node.children.push(node);
      else roots.push(node);
      live.push({ node, hash: frameHash(f, j) });
    }

    if (point.event === "return" && live.length > 0 && fs.length > 0) {
      live[live.length - 1].node.returnValue = returnValueOf(fs[fs.length - 1]);
    }
  });

  return { roots, nodes, hasRecursion };
}

export type NodeState = "current" | "on-stack" | "returned";

const isLive = (n: CallTreeNode, step: number): boolean =>
  n.enterStep <= step && (n.exitStep === null || step <= n.exitStep);

/** null = not yet called at this step (node hidden — tree grows as executed). */
export function nodeState(n: CallTreeNode, step: number): NodeState | null {
  if (n.enterStep > step) return null;
  if (!isLive(n, step)) return "returned";
  return n.children.some((c) => isLive(c, step)) ? "on-stack" : "current";
}

// --- label formatting -------------------------------------------------------
// Args are a heuristic: at a frame's first step, parameters are initialized
// and other locals are "<UNINITIALIZED>", so we print initialized values in
// ordered_varnames order (compiler temporaries excluded), capped at 3.

function argsLabel(f: OptFrame): string {
  const names = (f.ordered_varnames ?? []).filter((n) => !isCompilerInternal(n));
  const parts: string[] = [];
  for (const name of names) {
    const v = formatValue(f.encoded_locals?.[name]);
    if (v === null) continue;
    if (parts.length === 3) {
      parts.push("…");
      break;
    }
    parts.push(v);
  }
  return parts.join(", ");
}

/** null = uninitialized (skip: it's a local, not an argument). */
function formatValue(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return "…";
  switch (raw[0]) {
    case "C_DATA": {
      const v = raw[3];
      if (v === "<UNINITIALIZED>") return null;
      if (Array.isArray(v) && v[0] === "REF") return String(v[1]);
      return String(v);
    }
    case "REF":
      return String(raw[1]);
    case "C_STRUCT":
      return "{…}";
    case "C_ARRAY":
    case "C_MULTIDIMENSIONAL_ARRAY":
      return "[…]";
    default:
      return "…";
  }
}

function returnValueOf(f: OptFrame | undefined): string | null {
  const raw = f?.encoded_locals?.["__return__"];
  return raw === undefined ? null : formatValue(raw);
}
