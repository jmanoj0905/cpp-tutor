// Pure call-tree construction from a trace — no React, no DOM.
// Frame identity subtlety: frame_id is a stack address and is REUSED by a
// sibling invocation pushed right after a pop, so unique_hash can be identical
// for two different invocations at the same stack position across consecutive
// points. The "call" event marks the top frame as freshly pushed and is the
// only reliable disambiguator for that case.
import type { ExecPoint } from "../types/trace";

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
        label: `${funcName}()`,
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
