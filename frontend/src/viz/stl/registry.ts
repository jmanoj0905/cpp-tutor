import type { NormalizedCell } from "../memoryModel";
import type { ContainerDecoder, DecodeCtx } from "./types";
import { arrayDecoder, dequeDecoder, vectorDecoder, stringDecoder } from "./contiguous";
import { forwardListDecoder, hashDecoder, listDecoder, treeDecoder } from "./nodeChain";
import { stackDecoder, queueDecoder, priorityQueueDecoder } from "./adaptor";
import { iteratorDecoder } from "./iterator";
import { pairDecoder, tupleDecoder, bitsetDecoder, sharedPtrDecoder, uniquePtrDecoder, weakPtrDecoder } from "./structLike";

// Order matters: more specific patterns first.
// forwardListDecoder before listDecoder (forward_list regex contains "list").
// dequeDecoder before vectorDecoder (distinct type pattern, no overlap).
// arrayDecoder before vectorDecoder (distinct internals, no overlap).
// stringDecoder last (matches "string" / "basic_string" but not array/vector).

// --- Adaptor containers (stack / queue / priority_queue) ---
// These wrap an underlying deque (stack/queue) or vector (priority_queue) in
// member `c`. They must appear BEFORE the bare deque/vector decoders so that
// "queue<int,...>" matches queueDecoder and not dequeDecoder.
// priorityQueueDecoder before queueDecoder: priority_queue type string contains
// "queue", so the more specific pattern must match first.

// --- Node-based containers (struct fallback) ---
// list/forward_list, map/set/multi*, and unordered_* all decode() -> null,
// keeping the generic struct render.  The old libstdc++ tracer does not emit
// node payload values (see nodeChain.ts), so rich decode is impossible.
// These entries serve as the canonical registration point: to enable rich
// decode when a future tracer emits payloads, implement decode() in nodeChain.ts.
// hashDecoder before treeDecoder: the treeDecoder \b word-boundary already
// excludes "unordered_map/set" (the char before "map"/"set" is "_", not a
// word boundary), so hashDecoder first is future-proofing for nested types
// (e.g. map<int, unordered_map<...>>) rather than a present-day necessity.
export const registry: ContainerDecoder[] = [
  priorityQueueDecoder,
  stackDecoder,
  queueDecoder,
  hashDecoder,
  treeDecoder,
  forwardListDecoder,
  listDecoder,
  dequeDecoder,
  arrayDecoder,
  vectorDecoder,
  stringDecoder,
  // Contiguous iterators: emit a reference cell pointing at the element.
  // Must precede the struct-like decoders (pair/tuple) so iterator structs
  // are not misread, and after the container decoders.
  iteratorDecoder,
  // Smart-pointer decoders: emit a reference cell pointing at the managed object.
  // These must appear BEFORE the generic struct-like decoders (their type patterns
  // are specific enough not to collide with pair/tuple/bitset).
  sharedPtrDecoder,
  uniquePtrDecoder,
  weakPtrDecoder,
  // Struct-like containers: store values directly (no heap indirection).
  pairDecoder,
  tupleDecoder,
  bitsetDecoder,
];

export function decodeContainer(cell: NormalizedCell, ctx: DecodeCtx): NormalizedCell | null {
  if (!cell.type) return null;
  for (const d of registry) {
    if (d.match(cell.type)) {
      const out = d.decode(cell, ctx);
      if (out) return out;
    }
  }
  return null;
}
