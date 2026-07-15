// Pure call-tree construction from a trace — no React, no DOM.
// Frame identity subtlety: frame_id is a stack address and is REUSED by a
// sibling invocation pushed right after a pop, so unique_hash can be identical
// for two different invocations at the same stack position across consecutive
// points. The "call" event marks the top frame as freshly pushed and is the
// only reliable disambiguator for that case.
//
// Second subtlety, observed in real opt-cpp-backend traces (fib/subsets/
// mutual/graph-dfs fixtures): the single step_line point immediately after a
// "return" event mislabels the surviving top-of-stack frame with the
// func_name of the frame that just popped, while its frame_id (address)
// stays correctly the caller's own address. It self-corrects on the very
// next point. Left unhandled, this reads as "everything popped, then a
// bogus new root/frame pushed" and shatters e.g. `main` into multiple
// sibling roots. We detect it by address-only equality at the one mismatched
// position right after a return, and treat it as a no-op continuation.
//
// Third subtlety, the mirror image of the second: a frame's reported
// frame_id can be transient for exactly one step right after it is pushed
// (both `main`'s implicit initial push at trace start, and any callee right
// after its "call" event) — same func_name, same depth, address changes,
// then stabilizes on the following point. We detect "just pushed" via
// enterStep === step - 1 and update the tracked address in place rather
// than popping and re-pushing a duplicate node.
//
// Fourth subtlety: func_name in real traces is a full signature ("fib(int)"),
// and a freshly pushed frame's parameter is "<UNALLOCATED>" at the call
// event, "<UNINITIALIZED>" for 0-1 steps after (the compiler-generated
// prologue hasn't spilled the register argument to its stack slot yet), and
// only holds the real value a variable number of steps later (observed 1-2
// steps across fixtures, so not a fixed constant). We strip the signature
// for display/comparison (baseName) and keep refreshing a live node's label
// from the current frame every step while it remains top-of-stack, so the
// label naturally settles once the param is actually populated and then
// freezes as soon as a child call pushes on top of it (or it returns).
//
// Fifth subtlety, observed in the nqueens fixture: two more ways the "keep
// refreshing while top-of-stack" rule above goes wrong. (1) The tracer can
// report the *returning* frame itself (the "return" event point, not just
// the point after) at a shifted address with garbage locals — refreshing on
// that exact point freezes the garbage as the node's final label, so the
// refresh must skip "return" event points outright, same tracer-glitch
// family as glitchAbsorbed. (2) A loop-scoped local (e.g. a `for` counter)
// can come into scope partway through a frame's life, while it is still
// top-of-stack, and ordered_varnames will list it — sometimes ordered
// *before* the real parameters — so naively reformatting from the live
// frame every step leaks that local into the label. We snapshot each node's
// paramNames from ordered_varnames at its call/entry point (before any
// later-scoped local exists) and every refresh formats only those names, in
// that snapshot order, from however the live frame's locals look now.
import type { ExecPoint } from "../types/trace";
import { isCompilerInternal } from "./memoryModel";

export interface CallTreeNode {
  id: number;
  funcName: string;
  label: string;
  /** All parameters with initialized values, snapshotted/refreshed under the
   *  same glitch-safe rules as `label`. Uncapped — the detail panel shows all;
   *  only the label caps at 3. */
  args: { name: string; value: string }[];
  /** The frame's frame_id after the one-step address-settle. */
  address: string;
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

const frameAddr = (f: OptFrame, index: number): string => f.frame_id ?? frameHash(f, index);

// Real traces report func_name as a full signature ("fib(int)"); strip the
// parameter list for the funcName clients group/count/label by.
const baseName = (raw: string | undefined): string => (raw ?? "?").replace(/\(.*\)$/, "");

export function buildCallTree(trace: ExecPoint[]): CallTree {
  const roots: CallTreeNode[] = [];
  const nodes: CallTreeNode[] = [];
  const live: { node: CallTreeNode; hash: string; addr: string; paramNames: string[] }[] = [];
  let hasRecursion = false;
  let prevEvent: string | undefined;

  trace.forEach((point, step) => {
    const fs = liveFrames(point);

    let k = 0;
    while (k < live.length && k < fs.length) {
      if (live[k].hash === frameHash(fs[k], k)) {
        k++;
        continue;
      }
      // Address-settle (see header comment): same func_name at the same
      // depth, frame pushed on the immediately preceding step — its address
      // hasn't stabilized yet. Absorb the new address and keep matching.
      if (live[k].node.funcName === baseName(fs[k].func_name) && live[k].node.enterStep === step - 1) {
        live[k].hash = frameHash(fs[k], k);
        live[k].addr = frameAddr(fs[k], k);
        live[k].node.address = live[k].addr;
        k++;
        continue;
      }
      break;
    }

    // Address-reuse case: full prefix match but the point is a "call" event,
    // so the top frame is a new invocation, not the one we matched.
    if (point.event === "call" && k === fs.length && k === live.length && k > 0) k--;

    // Post-return func_name-lag glitch (see header comment): exactly one
    // frame short of `live`, everything below the top matches, and the top
    // mismatch is address-only (same frame_id, wrong func_name). Treat it as
    // "one legitimate pop, no bogus push" instead of unwinding everything.
    let glitchAbsorbed = false;
    if (
      point.event !== "call" &&
      prevEvent === "return" &&
      fs.length === live.length - 1 &&
      k === fs.length - 1 &&
      fs.length > 0 &&
      frameAddr(fs[k], k) === live[k].addr
    ) {
      k = fs.length;
      glitchAbsorbed = true;
    }

    while (live.length > k) live.pop()!.node.exitStep = step - 1;

    for (let j = k; j < fs.length; j++) {
      const f = fs[j];
      const funcName = baseName(f.func_name);
      if (live.some((l) => l.node.funcName === funcName)) hasRecursion = true;
      // Snapshot ordered_varnames at the frame's call/entry point (see
      // "Fifth subtlety" below) — later-scoped locals (e.g. a loop variable
      // that comes into scope while this frame is still top-of-stack) must
      // never enter the label, so refreshes only ever format these names.
      const paramNames = (f.ordered_varnames ?? []).filter((n) => !isCompilerInternal(n));
      const args = argsOf(f, paramNames);
      const node: CallTreeNode = {
        id: nodes.length,
        funcName,
        label: formatLabel(funcName, args),
        args,
        address: frameAddr(f, j),
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
      live.push({ node, hash: frameHash(f, j), addr: frameAddr(f, j), paramNames });
    }

    if (point.event === "return" && live.length > 0 && fs.length > 0) {
      live[live.length - 1].node.returnValue = returnValueOf(fs[fs.length - 1]);
    }

    // Keep the top-of-stack node's label in sync with the current frame
    // (see "Fourth subtlety" above) — except on a glitch-absorbed step,
    // where fs[top] is known-bogus (the popped callee's func_name and
    // leftover locals under the survivor's frame_id); hold the previous
    // label there or the callee's locals leak into the parent's label.
    // Also skip on a "return" event point itself: real traces (nqueens
    // fixture) report the returning frame at a shifted address with
    // garbage locals right there (not just on the point after), so
    // refreshing on the return event freezes garbage as the final label.
    // And only ever format the paramNames snapshotted at push (see
    // "Fifth subtlety") — a loop local that comes into scope later while
    // this frame is still top-of-stack must not leak into the label.
    if (!glitchAbsorbed && point.event !== "return" && live.length > 0 && fs.length >= live.length) {
      const top = live[live.length - 1];
      top.node.args = argsOf(fs[live.length - 1], top.paramNames);
      top.node.label = formatLabel(top.node.funcName, top.node.args);
    }

    prevEvent = point.event;
  });

  return { roots, nodes, hasRecursion };
}

export type NodeState = "future" | "current" | "on-stack" | "returned";

const isLive = (n: CallTreeNode, step: number): boolean =>
  n.enterStep <= step && (n.exitStep === null || step <= n.exitStep);

/** "future" = not yet called at this step (rendered as a dimmed ghost). */
export function nodeState(n: CallTreeNode, step: number): NodeState {
  if (n.enterStep > step) return "future";
  if (!isLive(n, step)) return "returned";
  return n.children.some((c) => isLive(c, step)) ? "on-stack" : "current";
}

// --- label formatting -------------------------------------------------------
// Args are a heuristic: at a frame's first step, parameters are initialized
// and other locals are "<UNINITIALIZED>", so we print initialized values in
// ordered_varnames order (compiler temporaries excluded), capped at 3.

function argsOf(f: OptFrame, names: string[]): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const name of names) {
    const v = formatValue(f.encoded_locals?.[name]);
    if (v !== null) out.push({ name, value: v });
  }
  return out;
}

function formatLabel(funcName: string, args: { value: string }[]): string {
  const vals = args.slice(0, 3).map((a) => a.value);
  if (args.length > 3) vals.push("…");
  return `${funcName}(${vals.join(", ")})`;
}

/** null = uninitialized (skip: it's a local, not an argument). */
function formatValue(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return "…";
  switch (raw[0]) {
    case "C_DATA": {
      const v = raw[3];
      // "<UNALLOCATED>": stack slot not carved out yet (right at the call
      // event). "<UNINITIALIZED>": slot exists but no value written yet —
      // true for a beat after the call too, before the prologue spills the
      // register-passed argument. Both mean "not ready", not "not a param".
      if (v === "<UNINITIALIZED>" || v === "<UNALLOCATED>") return null;
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
