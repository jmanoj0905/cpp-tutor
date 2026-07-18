import type { NormalizedCell } from "../memoryModel";
import type { ContainerDecoder, DecodeCtx } from "./types";
import { containerChildren, findMember, findPointer, templateArg } from "./helpers";

/**
 * Node-based STL container decoders (list, forward_list, map, set, multimap,
 * multiset, unordered_*).
 *
 * The patched tracer emits node payload values on heap nodes. These decoders
 * walk the owning container's node topology, adopt recovered payload members as
 * stable logical children, and fall back to sized opaque placeholders when a
 * walk is incomplete or an older trace lacks payload fields.
 */

const WALK_CAP = 100_000;

/** map-like kinds whose summary label shows two template args ("k,v"). */
export const PAIR_KINDS = new Set([
  "map", "multimap", "unordered_map", "unordered_multimap",
]);

/** Parse a non-negative integer from a scalar cell's displayValue, or null. */
function scalarInt(c?: NormalizedCell): number | null {
  if (!c) return null;
  const n = Number.parseInt(c.displayValue, 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** One opaque "?" entry — value unrecoverable from this tracer. */
function placeholder(
  parentId: string, i: number, source: NormalizedCell["source"],
): NormalizedCell {
  return {
    id: `${parentId}/${i}`, name: `[${i}]`, source,
    kind: "scalar", address: null, type: null,
    displayValue: "?", rawValue: null,
  };
}

/** Comma-joined template args for the summary label. */
function elemLabel(type: string, pairKind: boolean): string {
  return pairKind
    ? `${templateArg(type, 0)},${templateArg(type, 1)}`
    : templateArg(type, 0);
}

/** Kind name extracted from the C++ type string. */
function nodeKind(type: string): string {
  const m = type.match(
    /\b(unordered_multimap|unordered_multiset|unordered_map|unordered_set|multimap|multiset|forward_list|list|map|set)\b/,
  );
  return m ? m[1] : "container";
}

/**
 * Build a collapsed node-container cell. `count === null` means the size could
 * not be recovered: render "kind<...> · ?" with no placeholder slots.
 */
function nodeContainer(
  cell: NormalizedCell, kind: string, pairKind: boolean, count: number | null,
): NormalizedCell {
  const elem = elemLabel(cell.type ?? "", pairKind);
  const children = count === null
    ? undefined
    : Array.from({ length: count }, (_, i) => placeholder(cell.id, i, cell.source));
  return {
    ...cell, kind: "container", containerKind: kind,
    placeholders: true, children, length: count ?? undefined,
    displayValue: `${kind}<${elem}> · ${count === null ? "?" : count}`,
  };
}

/** Result of a node-chain walk: the visited node cells plus whether the walk
 *  reached a trusted terminator (so its findings are safe to rely on). */
export interface ChainWalk {
  nodes: NormalizedCell[];
  complete: boolean;
}

/**
 * Walk a singly-linked heap chain from `head`, following the `ptr` member on
 * each heap node, and return every visited node cell. Visited addresses are
 * consumed (hidden from the Heap section) ONLY when the walk is `complete` —
 * an untrusted/partial walk must leave its nodes visible so callers fall back
 * to placeholders instead of silently hiding real heap state.
 *
 *   • forward_list / unordered: stopAddr undefined, terminate at "0x0"/null.
 *   • list: stopAddr = sentinel address, terminate on loop-back.
 *
 * `complete` is false when a node is missing from the snapshot (walk stops
 * early) or — for a `stopAddr`-terminated chain — it never loops back to it.
 * Reaching `WALK_CAP` without a `stopAddr` is treated as complete (existing
 * safety-valve behavior for very long null-terminated chains).
 */
function walkChainNodes(
  head: string | undefined, ptr: string, ctx: DecodeCtx, stopAddr?: string,
): ChainWalk {
  const nodes: NormalizedCell[] = [];
  const visited: string[] = [];
  let cur = head;
  let count = 0;
  while (cur && cur !== "0x0" && cur !== stopAddr && count < WALK_CAP) {
    const node = ctx.heapByAddress.get(cur);
    if (!node) return { nodes, complete: false };
    nodes.push(node);
    visited.push(cur);
    cur = findPointer(node, ptr);
    count++;
  }
  const complete = stopAddr === undefined || cur === stopAddr;
  if (complete) for (const a of visited) ctx.consumed.add(a);
  return { nodes, complete };
}

/**
 * Count nodes in a singly-linked heap chain from `head` — thin wrapper over
 * `walkChainNodes` kept for the current count-only decoders (tree/hash/list/
 * forward_list). Returns null (size unreliable) when the walk isn't complete.
 */
function walkChain(
  head: string | undefined, ptr: string, ctx: DecodeCtx, stopAddr?: string,
): number | null {
  const { nodes, complete } = walkChainNodes(head, ptr, ctx, stopAddr);
  return complete ? nodes.length : null;
}

/**
 * Find a node's payload member by an accepted-names list (tracer/ABI varies:
 * `_M_data` for list on this GCC 4.8-era toolchain, `_M_value` expected for
 * forward_list, `_M_value_field` expected for tree nodes, etc). Returns the
 * first match, or undefined when no accepted name is present (old tracer /
 * payload-less snapshot) — callers must fall back to placeholders.
 */
function findPayloadMember(
  node: NormalizedCell, acceptedNames: string[],
): NormalizedCell | undefined {
  for (const name of acceptedNames) {
    const found = findMember(node, name);
    if (found) return found;
  }
  return undefined;
}

/**
 * Recover one adopted payload child per visited node, rebased under the owning
 * container via `containerChild` so logical ids stay stable (`l[0]`, `l[1]`,
 * ...) instead of tracking whichever heap address happened to hold that slot.
 * Nested payload shape (pair, struct, container) is preserved as-is by
 * `containerChild`'s recursive rebase.
 *
 * Returns null — signalling "fall back to a placeholder container" — if ANY
 * visited node is missing its payload, so we never render a partial mix of
 * real values and raw internals.
 */
function collectNodePayloads(
  parent: NormalizedCell, nodes: NormalizedCell[], acceptedNames: string[],
): NormalizedCell[] | null {
  const payloads: NormalizedCell[] = [];
  for (const node of nodes) {
    const payload = findPayloadMember(node, acceptedNames);
    if (!payload) return null;
    payloads.push(payload);
  }
  return containerChildren(parent, payloads);
}

/** Accepted payload-member names for a `std::list<T>` node (`_List_node<T>`). */
const LIST_PAYLOAD_NAMES = ["_M_data"];
const FORWARD_LIST_PAYLOAD_NAMES = ["_M_value", "_M_storage", "_M_data"];
const TREE_PAYLOAD_NAMES = ["_M_value_field"];
const HASH_PAYLOAD_NAMES = ["_M_v", "_M_value", "_M_value_field"];

function realNodeContainer(
  cell: NormalizedCell,
  kind: string,
  pairKind: boolean,
  children: NormalizedCell[],
): NormalizedCell {
  const elem = elemLabel(cell.type ?? "", pairKind);
  return {
    ...cell,
    kind: "container",
    containerKind: kind,
    children,
    length: children.length,
    elementType: elem,
    displayValue: `${kind}<${elem}> · ${children.length}`,
  };
}

function trustedTreeWalk(
  root: string | undefined,
  ctx: DecodeCtx,
  expectedCount: number | null,
): ChainWalk {
  const nodes: NormalizedCell[] = [];
  const visited = new Set<string>();

  const visit = (addr: string | undefined): boolean => {
    if (!addr || addr === "0x0") return true;
    if (visited.has(addr) || visited.size >= WALK_CAP) return false;
    const node = ctx.heapByAddress.get(addr);
    if (!node) return false;
    visited.add(addr);
    if (!visit(findPointer(node, "_M_left"))) return false;
    nodes.push(node);
    if (!visit(findPointer(node, "_M_right"))) return false;
    return true;
  };

  const countOk = () => expectedCount === null || nodes.length === expectedCount;
  const complete = visit(root) && countOk();
  if (complete) for (const addr of visited) ctx.consumed.add(addr);
  return { nodes, complete };
}

/** std::map/set/multimap/multiset — red-black tree; size from _M_node_count. */
export const treeDecoder: ContainerDecoder = {
  match: (type) => /\b(multimap|multiset|map|set)\s*</.test(type),
  decode(cell, ctx) {
    const kind = nodeKind(cell.type ?? "");
    const count = scalarInt(findMember(cell, "_M_node_count"));
    const header = findMember(cell, "_M_header");
    const root = header ? findPointer(header, "_M_parent") : undefined;
    const walk = trustedTreeWalk(root, ctx, count);
    if (walk.complete) {
      const payloads = collectNodePayloads(cell, walk.nodes, TREE_PAYLOAD_NAMES);
      if (payloads) return realNodeContainer(cell, kind, PAIR_KINDS.has(kind), payloads);
    }
    return nodeContainer(cell, kind, PAIR_KINDS.has(kind), count);
  },
};

/**
 * std::unordered_(map|set|multimap|multiset) — hash table. All nodes are
 * threaded on one singly-linked list rooted at _M_h._M_bbegin._M_node._M_nxt.
 * Walk it for the count (and to consume the node chunks); fall back to
 * _M_element_count when the walk cannot start.
 */
export const hashDecoder: ContainerDecoder = {
  match: (type) => /unordered_(multimap|multiset|map|set)\s*</.test(type),
  decode(cell, ctx) {
    const kind = nodeKind(cell.type ?? "");
    const expectedCount = scalarInt(findMember(cell, "_M_element_count"));
    const buckets = findPointer(cell, "_M_buckets");
    if (buckets) ctx.consumed.add(buckets);
    const head = findPointer(cell, "_M_nxt");
    const walk = walkChainNodes(head, "_M_nxt", ctx);
    if (walk.complete && (expectedCount === null || walk.nodes.length === expectedCount)) {
      const payloads = collectNodePayloads(cell, walk.nodes, HASH_PAYLOAD_NAMES);
      if (payloads) return realNodeContainer(cell, kind, PAIR_KINDS.has(kind), payloads);
      return nodeContainer(cell, kind, PAIR_KINDS.has(kind), walk.nodes.length);
    }
    return nodeContainer(cell, kind, PAIR_KINDS.has(kind), expectedCount);
  },
};

/**
 * std::list — circular doubly-linked list with an inline sentinel header
 * (_M_impl._M_node). Walk _M_next from the sentinel's first node until the
 * chain loops back to the sentinel's own address. An empty list's sentinel
 * points to itself → count 0.
 */
export const listDecoder: ContainerDecoder = {
  match: (type) => /\blist\s*</.test(type) && !/forward_list/.test(type),
  decode(cell, ctx) {
    const sentinel = findMember(cell, "_M_node");
    const sentinelAddr = sentinel?.address ?? undefined;
    const head = sentinel ? findPointer(sentinel, "_M_next") : undefined;
    const { nodes, complete } = walkChainNodes(head, "_M_next", ctx, sentinelAddr);
    if (complete) {
      const payloads = collectNodePayloads(cell, nodes, LIST_PAYLOAD_NAMES);
      if (payloads) {
        return realNodeContainer(cell, "list", false, payloads);
      }
    }
    const count = complete ? nodes.length : null;
    return nodeContainer(cell, "list", false, count);
  },
};

/**
 * std::forward_list — singly-linked, null-terminated. Head is
 * _M_impl._M_head._M_next; walk _M_next until 0x0.
 */
export const forwardListDecoder: ContainerDecoder = {
  match: (type) => /forward_list\s*</.test(type),
  decode(cell, ctx) {
    const head = findPointer(cell, "_M_next");
    const { nodes, complete } = walkChainNodes(head, "_M_next", ctx);
    if (complete) {
      const payloads = collectNodePayloads(cell, nodes, FORWARD_LIST_PAYLOAD_NAMES);
      if (payloads) return realNodeContainer(cell, "forward_list", false, payloads);
    }
    return nodeContainer(cell, "forward_list", false, complete ? nodes.length : null);
  },
};

// Helpers reused by later tasks (unordered / list / forward_list):
export {
  scalarInt, placeholder, elemLabel, nodeKind, nodeContainer, walkChain,
  walkChainNodes, findPayloadMember, collectNodePayloads,
};
