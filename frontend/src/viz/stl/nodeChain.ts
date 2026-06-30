import type { NormalizedCell } from "../memoryModel";
import type { ContainerDecoder, DecodeCtx } from "./types";
import { findMember, findPointer, templateArg } from "./helpers";

/**
 * Node-based STL container decoders (list, forward_list, map, set, multimap,
 * multiset, unordered_*).
 *
 * This old libstdc++ tracer does NOT emit node payload values (element values
 * and map keys are unrecoverable). We therefore collapse each container to a
 * sized summary with one opaque "?" placeholder per element, recovering only
 * the COUNT — from a count field (trees / unordered) or a node-chain walk
 * (list / forward_list). When the count is indeterminate (partial snapshot,
 * uninitialised field) we render "kind<...> · ?" with no slots, NEVER the raw
 * struct dump.
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

/**
 * Count nodes in a singly-linked heap chain from `head`, following the `ptr`
 * member on each heap node, consuming every visited node address. Returns null
 * (size unreliable) if a node is missing from the snapshot, or — for a circular
 * chain — it never loops back to `stopAddr`.
 *   • forward_list / unordered: stopAddr undefined, terminate at "0x0"/null.
 *   • list: stopAddr = sentinel address, terminate on loop-back.
 */
function walkChain(
  head: string | undefined, ptr: string, ctx: DecodeCtx, stopAddr?: string,
): number | null {
  const visited: string[] = [];
  let cur = head;
  let count = 0;
  while (cur && cur !== "0x0" && cur !== stopAddr && count < WALK_CAP) {
    const node = ctx.heapByAddress.get(cur);
    if (!node) return null;
    visited.push(cur);
    cur = findPointer(node, ptr);
    count++;
  }
  if (stopAddr !== undefined && cur !== stopAddr) return null;
  for (const a of visited) ctx.consumed.add(a);
  return count;
}

/** std::map/set/multimap/multiset — red-black tree; size from _M_node_count. */
export const treeDecoder: ContainerDecoder = {
  match: (type) => /\b(multimap|multiset|map|set)\s*</.test(type),
  decode(cell) {
    const kind = nodeKind(cell.type ?? "");
    const count = scalarInt(findMember(cell, "_M_node_count"));
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
    const head = findPointer(cell, "_M_nxt");
    let count = walkChain(head, "_M_nxt", ctx);
    if (count === null) count = scalarInt(findMember(cell, "_M_element_count"));
    return nodeContainer(cell, kind, PAIR_KINDS.has(kind), count);
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
    const count = walkChain(head, "_M_next", ctx, sentinelAddr);
    return nodeContainer(cell, "list", false, count);
  },
};

/** std::forward_list — placeholder; real decode added in a later task. */
export const forwardListDecoder: ContainerDecoder = {
  match: (type) => /forward_list\s*</.test(type),
  decode: () => null,
};

// Helpers reused by later tasks (unordered / list / forward_list):
export { scalarInt, placeholder, elemLabel, nodeKind, nodeContainer, walkChain };
