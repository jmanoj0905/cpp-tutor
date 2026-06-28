import type { NormalizedCell } from "../memoryModel";
import type { ContainerDecoder, DecodeCtx } from "./types";
import { arrayDecoder, vectorDecoder, stringDecoder } from "./contiguous";

// Order matters: more specific patterns first.
// arrayDecoder before vectorDecoder (distinct internals, no overlap).
// stringDecoder last (matches "string" / "basic_string" but not array/vector).
export const registry: ContainerDecoder[] = [
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
