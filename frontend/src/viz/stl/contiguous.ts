import type { NormalizedCell } from "../memoryModel";
import type { ContainerDecoder, DecodeCtx } from "./types";
import { parseAddr, findMember, findPointer, templateArg } from "./helpers";

function vectorSize(start?: string, finish?: string, buffer?: NormalizedCell): number {
  const elems = buffer?.children ?? [];
  const s = parseAddr(start), f = parseAddr(finish);
  if (s !== null && f !== null && elems.length >= 2) {
    const e0 = parseAddr(elems[0].address), e1 = parseAddr(elems[1].address);
    if (e0 !== null && e1 !== null && e1 > e0) {
      const size = Math.round((f - s) / (e1 - e0));
      if (size >= 0 && size <= elems.length) return size;
    }
  }
  if (s !== null && f !== null && f === s) return 0;
  return elems.length;
}

export const vectorDecoder: ContainerDecoder = {
  match: (type) => /\bvector\s*</.test(type),
  decode(cell, ctx: DecodeCtx) {
    const start = findPointer(cell, "_M_start");
    if (!start) return null;
    const finish = findPointer(cell, "_M_finish");
    const elem = templateArg(cell.type ?? "");
    const buffer = ctx.heapByAddress.get(start);
    if (!buffer) {
      return { ...cell, kind: "container", containerKind: "vector",
        children: [], length: 0, elementType: elem,
        displayValue: `vector<${elem}> · 0` };
    }
    ctx.consumed.add(start);
    const size = vectorSize(start, finish, buffer);
    const children = (buffer.children ?? []).slice(0, size).map((c, i) => ({ ...c, name: `[${i}]` }));
    return { ...cell, kind: "container", containerKind: "vector",
      children, length: size, elementType: elem,
      displayValue: `vector<${elem}> · ${size}` };
  },
};

/**
 * std::array<T, N> — inline fixed-size array.
 * The elements live in _M_elems (a C_ARRAY member), same address as the struct.
 * Matches "array<T, N>" or "std::array<T, N>" (including ul-suffixed sizes like "3ul").
 */
export const arrayDecoder: ContainerDecoder = {
  match: (type) => /\barray\s*</.test(type),
  decode(cell) {
    const elems = findMember(cell, "_M_elems");
    const children = (elems?.children ?? []).map((c, i) => ({ ...c, name: `[${i}]` }));
    if (children.length === 0) return null;
    const elem = templateArg(cell.type ?? "");
    return {
      ...cell,
      kind: "container",
      containerKind: "array",
      children,
      length: children.length,
      elementType: elem,
      displayValue: `array<${elem}> · ${children.length}`,
    };
  },
};

/**
 * std::string / std::basic_string<char> — SSO-aware and COW-aware.
 *
 * libstdc++ layouts observed in practice:
 *   • COW (old): _M_p points into the middle of a heap allocation
 *     (header precedes the char data in the same C_ARRAY buffer).
 *   • SSO (new): _M_p points into the struct's own _M_local_buf member
 *     (no heap involvement for short strings).
 *
 * Strategy: find the heap buffer whose children include the _M_p address,
 * then collect chars from that offset until the null terminator.
 * Fallback: read _M_local_buf children directly (SSO path).
 */
export const stringDecoder: ContainerDecoder = {
  match: (type) => /basic_string|\bstring\b/.test(type),
  decode(cell, ctx) {
    const p = findPointer(cell, "_M_p");
    if (!p) return null;
    const pAddr = parseAddr(p);
    if (pAddr === null) return null;

    // Find the heap buffer containing _M_p (may be offset from buffer start).
    let charSlice: NormalizedCell[] = [];
    let bufAddr: string | null = null;
    for (const buf of ctx.heapByAddress.values()) {
      const children = buf.children ?? [];
      const idx = children.findIndex((c) => parseAddr(c.address) === pAddr);
      if (idx >= 0) {
        charSlice = children.slice(idx);
        bufAddr = buf.address;
        break;
      }
    }

    // SSO fallback: _M_p lives inside the struct; look for _M_local_buf.
    if (charSlice.length === 0) {
      const local = findMember(cell, "_M_local_buf");
      charSlice = local?.children ?? [];
    }

    if (charSlice.length === 0) return null;

    // Extract chars until null terminator (displayValue "0") or uninitialized.
    const chars: string[] = [];
    for (const c of charSlice) {
      const n = Number(c.displayValue);
      if (!Number.isFinite(n) || n === 0) break;
      chars.push(String.fromCharCode(n));
    }
    const text = chars.join("");

    if (bufAddr) ctx.consumed.add(bufAddr);

    return {
      ...cell,
      kind: "container",
      containerKind: "string",
      children: undefined,
      displayValue: `"${text}"`,
    };
  },
};
