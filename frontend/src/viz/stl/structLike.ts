import type { NormalizedCell } from "../memoryModel";
import type { ContainerDecoder } from "./types";
import { findMember, findPointer } from "./helpers";

/**
 * Count the number of top-level template arguments in a type string.
 * E.g. "tuple<int, pair<int,int>, float>" → 3.
 * Depth-aware: commas inside nested angle-brackets are ignored.
 */
function countTopLevelArgs(type: string): number {
  const lt = type.indexOf("<");
  const gt = type.lastIndexOf(">");
  if (lt < 0 || gt <= lt) return 0;
  const inner = type.slice(lt + 1, gt);
  let depth = 0, commas = 0;
  for (const ch of inner) {
    if (ch === "<") depth++;
    else if (ch === ">") depth--;
    else if (ch === "," && depth === 0) commas++;
  }
  return commas + 1;
}

/**
 * Collect all scalar LEAVES under a cell (DFS, left to right).
 * Used by tupleDecoder: the old libstdc++ tuple nests _Tuple_impl/_Head_base
 * chains; _M_head_impl scalars are the actual element values.
 *
 * NOTE: With the old libstdc++ tracer only _Head_base<0ul> is emitted; the
 * remaining _Tuple_impl<1ul,...> base classes are absent from the trace.
 * Consequently leaves() only recovers element [0] for this tracer.
 */
function leaves(cell: NormalizedCell): NormalizedCell[] {
  const out: NormalizedCell[] = [];
  const walk = (c: NormalizedCell) => {
    const kids = c.children ?? [];
    if (kids.length === 0) {
      if (c.kind === "scalar") out.push(c);
      return;
    }
    kids.forEach(walk);
  };
  (cell.children ?? []).forEach(walk);
  return out;
}

/**
 * std::pair<T1, T2> — stores first/second directly as named struct members.
 * Type string: "pair<T1, T2>" (tracer may include std:: prefix or not).
 */
export const pairDecoder: ContainerDecoder = {
  match: (type) => /\bpair\s*</.test(type),
  decode(cell) {
    const first = findMember(cell, "first");
    const second = findMember(cell, "second");
    if (!first || !second) return null;
    return {
      ...cell,
      kind: "container",
      containerKind: "pair",
      children: [{ ...first, name: "first" }, { ...second, name: "second" }],
      displayValue: `(${first.displayValue}, ${second.displayValue})`,
    };
  },
};

/**
 * std::tuple<T...> — nests _Tuple_impl<Idx,...>/_Head_base<Idx,...>/_M_head_impl.
 * Scalar leaves are collected in DFS order and renamed [0], [1], ...
 *
 * Tracer limitation (old libstdc++): only _Head_base<0ul> (element 0) appears
 * in the trace; _Tuple_impl<1ul,...> and later base classes are absent. When the
 * number of recovered leaves is fewer than the declared arity, we CANNOT render a
 * faithful container — return null so the generic struct renderer takes over
 * (same "untraceable → struct fallback" rule applied to list/map/set nodes).
 */
export const tupleDecoder: ContainerDecoder = {
  match: (type) => /\btuple\s*</.test(type),
  decode(cell) {
    const items = leaves(cell);
    if (items.length === 0) return null;
    // If the trace omits elements (old tracer), fall back to struct so we don't
    // display a misleading partial container.
    const declaredN = countTopLevelArgs(cell.type ?? "");
    if (declaredN > 0 && items.length < declaredN) return null;
    const children = items.map((c, i) => ({ ...c, name: `[${i}]` }));
    return {
      ...cell,
      kind: "container",
      containerKind: "tuple",
      children,
      length: children.length,
      displayValue: `(${items.map((c) => c.displayValue).join(", ")})`,
    };
  },
};

/**
 * std::bitset<N> — stores bits in _M_w (a _WordT / unsigned long scalar).
 * For N ≤ 64 there is a single word; larger bitsets use an array (not handled
 * here — for bitset<8> the single-word path is sufficient).
 *
 * Type string: "bitset<8ul>" (tracer emits ul suffix on template size).
 * The type_bits() helper strips the ul suffix; _M_w holds the raw integer.
 * displayValue: N-bit binary string, MSB first (e.g. bitset<8>(5) → "00000101").
 */
export const bitsetDecoder: ContainerDecoder = {
  match: (type) => /\bbitset\s*</.test(type),
  decode(cell) {
    const n = typeBits(cell.type ?? "");
    if (n === 0) return null;
    const word = findMember(cell, "_M_w");
    if (!word) return null;
    const raw = Number.parseInt(word.displayValue, 10);
    if (Number.isNaN(raw)) return null;
    // Render as N-bit binary string, MSB first, truncated to N bits.
    const bits = raw.toString(2).padStart(n, "0").slice(-n);
    return {
      ...cell,
      kind: "container",
      containerKind: "bitset",
      children: undefined,
      displayValue: bits,
    };
  },
};

/** Extract the numeric bit-count from a bitset type string (handles `ul` suffix). */
function typeBits(type: string): number {
  const m = type.match(/bitset\s*<\s*(\d+)/);
  return m ? Number.parseInt(m[1], 10) : 0;
}

// ------------------------------------------------------------------ smart pointers
// Each decoder emits a `kind:"reference"` cell whose `targetAddress` is the raw
// pointee address.  The existing resolveReferences + link machinery then draws a
// connector arrow to the pointee — but only after the memoryModel.ts ordering fix
// runs resolveReferences again AFTER resolveContainers.

/**
 * Walk the subtree depth-first and return the first `targetAddress` found on any
 * reference-kind descendant (or the cell itself).  Used as a fallback when the
 * primary member lookup fails (e.g. unique_ptr tuple nesting varies by ABI).
 */
function firstPointerAddr(cell: NormalizedCell): string | undefined {
  for (const c of cell.children ?? []) {
    if (c.kind === "reference" && c.targetAddress) return c.targetAddress;
    const nested = firstPointerAddr(c);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * std::shared_ptr<T> — libstdc++ layout:
 *   _M_ptr       → raw pointer to the managed object (the pointee)
 *   _M_refcount  → _Sp_counted_base carrying _M_use_count
 *
 * NOTE: The Valgrind 3.11.0 tracer crashes (DWARF assertion) for any program that
 * uses std::shared_ptr, so this decoder is exercised via synthetic test data.
 */
export const sharedPtrDecoder: ContainerDecoder = {
  match: (type) => /shared_ptr\s*</.test(type),
  decode(cell) {
    const ptr = findPointer(cell, "_M_ptr");
    if (!ptr || ptr === "0x0") return null;
    const useCount = findMember(cell, "_M_use_count");
    const note = useCount ? `use_count: ${useCount.displayValue}` : "shared_ptr";
    return {
      ...cell,
      kind: "reference",
      containerKind: "shared_ptr",
      targetAddress: ptr,
      note,
      children: undefined,
      displayValue: `shared_ptr -> ${ptr}`,
    };
  },
};

/**
 * std::unique_ptr<T, D> — libstdc++ layout:
 *   _M_t (tuple<pointer, deleter>)
 *     → _Tuple_impl<0ul,...>
 *       → _Head_base<0ul, T*, false>
 *         → _M_head_impl   (the raw pointer, type="pointer")
 *
 * Falls back to `firstPointerAddr` for ABI variants where _M_head_impl is absent.
 * Returns null if no pointer is recoverable (struct fallback).
 */
export const uniquePtrDecoder: ContainerDecoder = {
  match: (type) => /unique_ptr\s*</.test(type),
  decode(cell) {
    const ptr = findPointer(cell, "_M_head_impl") ?? firstPointerAddr(cell);
    if (!ptr || ptr === "0x0") return null;
    return {
      ...cell,
      kind: "reference",
      containerKind: "unique_ptr",
      targetAddress: ptr,
      note: "owns",
      children: undefined,
      displayValue: `unique_ptr -> ${ptr}`,
    };
  },
};

/**
 * std::weak_ptr<T> — same libstdc++ layout as shared_ptr (_M_ptr + _M_refcount).
 * Does not own the object; use_count is intentionally omitted from the note.
 *
 * NOTE: Like shared_ptr, exercised via synthetic test data (tracer crash).
 */
export const weakPtrDecoder: ContainerDecoder = {
  match: (type) => /weak_ptr\s*</.test(type),
  decode(cell) {
    const ptr = findPointer(cell, "_M_ptr");
    if (!ptr || ptr === "0x0") return null;
    return {
      ...cell,
      kind: "reference",
      containerKind: "weak_ptr",
      targetAddress: ptr,
      note: "weak (non-owning)",
      children: undefined,
      displayValue: `weak_ptr -> ${ptr}`,
    };
  },
};
