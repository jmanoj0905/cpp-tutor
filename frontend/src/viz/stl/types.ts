import type { NormalizedCell } from "../memoryModel";

export interface DecodeCtx {
  heapByAddress: Map<string, NormalizedCell>;
  consumed: Set<string>;
}

export interface ContainerDecoder {
  /** Test against the struct's C++ type string. */
  match: (type: string) => boolean;
  /** Return a container cell, or null to leave the struct untouched. */
  decode: (cell: NormalizedCell, ctx: DecodeCtx) => NormalizedCell | null;
}
