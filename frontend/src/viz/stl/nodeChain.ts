import type { ContainerDecoder } from "./types";

/**
 * Node-based STL container decoders.
 *
 * WHY THESE ALL RETURN NULL (struct fallback):
 *   This old libstdc++ tracer does NOT emit node payload values:
 *     - list/forward_list nodes → C_ARRAY of two _List_node_base entries;
 *       the value slot appears as UNINITIALIZED/UNALLOCATED (int is gone).
 *     - map/set nodes → C_ARRAY of only _Rb_tree_node_base (color + parent +
 *       left + right); the key/value slot is absent entirely.
 *     - unordered_* nodes → C_ARRAY of _Hash_node_base/_M_nxt only; stored
 *       value is absent.
 *   Element values and map keys are unrecoverable, so rich decode is impossible.
 *   Returning null leaves the struct render unchanged (generic struct fallback).
 *
 * EXTENSION POINT: if a future tracer emits node payloads, implement decode()
 * here — the match() patterns and registration order are already in place.
 */

/** std::list<T> — circular doubly-linked list. Returns null: tracer omits node payload. */
export const listDecoder: ContainerDecoder = {
  match: (type) => /\blist\s*</.test(type) && !/forward_list/.test(type),
  decode: () => null,
};

/** std::forward_list<T> — singly-linked list. Returns null: tracer omits node payload. */
export const forwardListDecoder: ContainerDecoder = {
  match: (type) => /forward_list\s*</.test(type),
  decode: () => null,
};

/** std::map/set/multimap/multiset — red-black tree. Returns null: tracer omits node payload. */
export const treeDecoder: ContainerDecoder = {
  match: (type) => /\b(multimap|multiset|map|set)\s*</.test(type),
  decode: () => null,
};

/** std::unordered_(map|set|multimap|multiset) — hash table. Returns null: tracer omits node payload. */
export const hashDecoder: ContainerDecoder = {
  match: (type) => /unordered_(multimap|multiset|map|set)\s*</.test(type),
  decode: () => null,
};
