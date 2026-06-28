import type { NormalizedCell } from "../memoryModel";
import type { ContainerDecoder, DecodeCtx } from "./types";
import { arrayDecoder, dequeDecoder, vectorDecoder, stringDecoder } from "./contiguous";
import { forwardListDecoder, hashDecoder, listDecoder, treeDecoder } from "./nodeChain";
import { stackDecoder, queueDecoder, priorityQueueDecoder } from "./adaptor";
import { pairDecoder, tupleDecoder, bitsetDecoder } from "./structLike";

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
// hashDecoder before treeDecoder: "unordered_map/set" contains "map"/"set",
// so the more specific pattern must match first.
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
