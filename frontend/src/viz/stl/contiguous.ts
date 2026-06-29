import type { NormalizedCell } from "../memoryModel";
import type { ContainerDecoder, DecodeCtx } from "./types";
import { parseAddr, findMember, findPointer, templateArg } from "./helpers";

/**
 * std::deque<T> — chunk-map layout.
 *
 * libstdc++ stores elements in fixed-size chunks (one chunk = 512 bytes / sizeof(T) elements).
 * The _M_impl holds:
 *   _M_map      — pointer to an array of chunk pointers (C_ARRAY in heap)
 *   _M_map_size — number of map slots
 *   _M_start    — iterator: _M_cur (first element), _M_first (chunk start),
 *                            _M_last (chunk end, exclusive), _M_node (map-slot addr)
 *   _M_finish   — iterator: _M_cur (one-past-last element), _M_first, _M_last, _M_node
 *
 * Decode strategy:
 *   • Use _M_first from each iterator as the heap key to locate the chunk C_ARRAY.
 *   • Start chunk: collect elements in [_M_cur, _M_last).
 *   • Middle chunks (between start._M_node and finish._M_node in the map): all elements.
 *   • Finish chunk: collect elements in [_M_first, _M_cur).
 *   • When start and finish share the same node: collect [start._M_cur, finish._M_cur).
 */
export const dequeDecoder: ContainerDecoder = {
  match: (type) => /\bdeque\s*</.test(type),
  decode(cell, ctx: DecodeCtx) {
    const startIter = findMember(cell, "_M_start");
    const finishIter = findMember(cell, "_M_finish");
    if (!startIter || !finishIter) return null;

    const startCurStr = findPointer(startIter, "_M_cur");
    const startFirstStr = findPointer(startIter, "_M_first");
    const startLastStr = findPointer(startIter, "_M_last");
    const startNodeStr = findPointer(startIter, "_M_node");
    const finishCurStr = findPointer(finishIter, "_M_cur");
    const finishFirstStr = findPointer(finishIter, "_M_first");
    const finishNodeStr = findPointer(finishIter, "_M_node");

    if (!startCurStr || !startFirstStr || !startLastStr || !startNodeStr) return null;
    if (!finishCurStr || !finishFirstStr || !finishNodeStr) return null;

    const startCur = parseAddr(startCurStr);
    const startLast = parseAddr(startLastStr);
    const startNodeAddr = parseAddr(startNodeStr);
    const finishCur = parseAddr(finishCurStr);
    const finishFirstAddr = parseAddr(finishFirstStr);
    const finishNodeAddr = parseAddr(finishNodeStr);

    if (startCur === null || startLast === null || startNodeAddr === null) return null;
    if (finishCur === null || finishFirstAddr === null || finishNodeAddr === null) return null;

    const elem = templateArg(cell.type ?? "");
    const children: NormalizedCell[] = [];

    // Map array for middle-chunk traversal (keyed by _M_map pointer value).
    const mapAddr = findPointer(cell, "_M_map");
    const mapArr = mapAddr ? ctx.heapByAddress.get(mapAddr) : undefined;

    /** Given a map-slot address, return the chunk C_ARRAY it points to. */
    function chunkForSlotAddr(slotAddr: number): NormalizedCell | undefined {
      if (!mapArr?.children) return undefined;
      const addrHex = "0x" + slotAddr.toString(16).toLowerCase();
      const slot = mapArr.children.find(
        (c) => c.address?.toLowerCase() === addrHex,
      );
      if (!slot || slot.kind !== "reference" || !slot.targetAddress) return undefined;
      return ctx.heapByAddress.get(slot.targetAddress);
    }

    if (startNodeAddr === finishNodeAddr) {
      // All elements live in a single chunk: collect [startCur, finishCur).
      const chunk = ctx.heapByAddress.get(startFirstStr);
      if (!chunk) return null;
      for (const slot of chunk.children ?? []) {
        const a = parseAddr(slot.address);
        if (a !== null && a >= startCur && a < finishCur) {
          children.push({ ...slot, name: `[${children.length}]` });
        }
      }
      ctx.consumed.add(startFirstStr);
    } else {
      // Start chunk: elements in [startCur, startLast).
      const startChunk = ctx.heapByAddress.get(startFirstStr);
      if (startChunk) {
        for (const slot of startChunk.children ?? []) {
          const a = parseAddr(slot.address);
          if (a !== null && a >= startCur && a < startLast) {
            children.push({ ...slot, name: `[${children.length}]` });
          }
        }
        ctx.consumed.add(startFirstStr);
      }

      // Middle chunks: map slots strictly between startNode and finishNode.
      const ptrSize = 8; // 64-bit pointer
      for (
        let nodeAddr = startNodeAddr + ptrSize;
        nodeAddr < finishNodeAddr;
        nodeAddr += ptrSize
      ) {
        const chunk = chunkForSlotAddr(nodeAddr);
        if (chunk) {
          for (const slot of chunk.children ?? []) {
            children.push({ ...slot, name: `[${children.length}]` });
          }
          if (chunk.address) ctx.consumed.add(chunk.address);
        }
      }

      // Finish chunk: elements in [finishFirst, finishCur).
      const finishChunk = ctx.heapByAddress.get(finishFirstStr);
      if (finishChunk) {
        for (const slot of finishChunk.children ?? []) {
          const a = parseAddr(slot.address);
          if (a !== null && a >= finishFirstAddr && a < finishCur) {
            children.push({ ...slot, name: `[${children.length}]` });
          }
        }
        ctx.consumed.add(finishFirstStr);
      }
    }

    // Consume the map array itself.
    if (mapAddr) ctx.consumed.add(mapAddr);

    if (children.length === 0) return null;

    return {
      ...cell,
      kind: "container",
      containerKind: "deque",
      children,
      length: children.length,
      elementType: elem,
      displayValue: `deque<${elem}> · ${children.length}`,
    };
  },
};

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

    // TODO: untested — SSO path; this COW tracer never hits it. Awaits a new-libstdc++ fixture.
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
