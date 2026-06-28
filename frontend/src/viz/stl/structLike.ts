import type { NormalizedCell } from "../memoryModel";
import type { ContainerDecoder } from "./types";
import { findMember } from "./helpers";

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
 * in the trace; elements at index ≥ 1 are inaccessible. The decoder returns
 * what it finds; if no leaves exist, returns null (struct fallback).
 * Leaf order is in-source order (element [0] is first, as stored in the trace).
 */
export const tupleDecoder: ContainerDecoder = {
  match: (type) => /\btuple\s*</.test(type),
  decode(cell) {
    const items = leaves(cell);
    if (items.length === 0) return null;
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
