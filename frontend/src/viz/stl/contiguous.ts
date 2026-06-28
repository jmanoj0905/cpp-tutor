import type { NormalizedCell } from "../memoryModel";
import type { ContainerDecoder, DecodeCtx } from "./types";
import { parseAddr, findPointer, templateArg } from "./helpers";

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
