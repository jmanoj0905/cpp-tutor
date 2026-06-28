import type { NormalizedCell } from "../memoryModel";
import type { ContainerDecoder, DecodeCtx } from "./types";
import { vectorDecoder } from "./contiguous";

// Order matters: more specific patterns first. Decoders added in later tasks
// are appended here.
export const registry: ContainerDecoder[] = [
  vectorDecoder,
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
