import type { NormalizedCell } from "../memoryModel";
import type { ContainerDecoder, DecodeCtx } from "./types";
import { containerChildren, findMember, templateArg } from "./helpers";
import { decodeContainer } from "./registry";

/**
 * Unwrap the underlying container stored in member `c` and decode it via the
 * STL registry. Returns null if the member is missing or decoding fails.
 *
 * Circular-import note: `adaptor.ts` imports `decodeContainer` from registry,
 * and registry imports the adaptors from here. This is safe under ESM because
 * `decodeContainer` is only CALLED at runtime (inside decode()), not at module
 * initialisation time, so both modules are fully initialised by call time.
 *
 * Bottom-up note: `resolveContainers` in memoryModel.ts processes children
 * BEFORE the parent. By the time the adaptor decoder runs for `st`/`q`/`pq`,
 * the child `c` has already been decoded to kind:"container". We check for
 * that first and return it directly; only fall back to decodeContainer for the
 * case where the inner struct was not yet resolved (defensive).
 */
function unwrap(cell: NormalizedCell, ctx: DecodeCtx): NormalizedCell | null {
  const inner = findMember(cell, "c");
  if (!inner || inner === cell) return null;
  // Already decoded bottom-up — return directly.
  if (inner.kind === "container") return inner;
  // Not yet decoded — try the registry (defensive path).
  return decodeContainer({ ...inner, kind: "struct" }, ctx);
}

export const stackDecoder: ContainerDecoder = {
  match: (type) => /\bstack\s*</.test(type),
  decode(cell, ctx) {
    const inner = unwrap(cell, ctx);
    if (!inner) return null;
    const elem = templateArg(cell.type ?? "");
    return {
      ...cell,
      kind: "container",
      containerKind: "stack",
      children: containerChildren(cell, inner.children ?? []),
      length: inner.length,
      elementType: elem,
      note: "top = last",
      displayValue: `stack<${elem}> · ${inner.length ?? 0}`,
    };
  },
};

export const queueDecoder: ContainerDecoder = {
  match: (type) => /\bqueue\s*</.test(type) && !/priority_queue/.test(type),
  decode(cell, ctx) {
    const inner = unwrap(cell, ctx);
    if (!inner) return null;
    const elem = templateArg(cell.type ?? "");
    return {
      ...cell,
      kind: "container",
      containerKind: "queue",
      children: containerChildren(cell, inner.children ?? []),
      length: inner.length,
      elementType: elem,
      note: "front → back",
      displayValue: `queue<${elem}> · ${inner.length ?? 0}`,
    };
  },
};

export const priorityQueueDecoder: ContainerDecoder = {
  match: (type) => /priority_queue\s*</.test(type),
  decode(cell, ctx) {
    const inner = unwrap(cell, ctx);
    if (!inner) return null;
    const elem = templateArg(cell.type ?? "");
    return {
      ...cell,
      kind: "container",
      containerKind: "priority_queue",
      children: containerChildren(cell, inner.children ?? []),
      length: inner.length,
      elementType: elem,
      note: "heap; top = [0]",
      displayValue: `priority_queue<${elem}> · ${inner.length ?? 0}`,
    };
  },
};
