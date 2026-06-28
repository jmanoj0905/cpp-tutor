import type { NormalizedCell } from "../memoryModel";
import type { ContainerDecoder, DecodeCtx } from "./types";
import { arrayDecoder, dequeDecoder, vectorDecoder, stringDecoder } from "./contiguous";
import { forwardListDecoder, hashDecoder, listDecoder, treeDecoder } from "./nodeChain";

// Order matters: more specific patterns first.
// forwardListDecoder before listDecoder (forward_list regex contains "list").
// dequeDecoder before vectorDecoder (distinct type pattern, no overlap).
// arrayDecoder before vectorDecoder (distinct internals, no overlap).
// stringDecoder last (matches "string" / "basic_string" but not array/vector).

// --- Node-based containers (struct fallback) ---
// list/forward_list, map/set/multi*, and unordered_* all decode() -> null,
// keeping the generic struct render.  The old libstdc++ tracer does not emit
// node payload values (see nodeChain.ts), so rich decode is impossible.
// These entries serve as the canonical registration point: to enable rich
// decode when a future tracer emits payloads, implement decode() in nodeChain.ts.
// hashDecoder before treeDecoder: "unordered_map/set" contains "map"/"set",
// so the more specific pattern must match first.
export const registry: ContainerDecoder[] = [
  hashDecoder,
  treeDecoder,
  forwardListDecoder,
  listDecoder,
  dequeDecoder,
  arrayDecoder,
  vectorDecoder,
  stringDecoder,
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
