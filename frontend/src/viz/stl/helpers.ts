import type { NormalizedCell } from "../memoryModel";

/**
 * Member names that are bookkeeping / structural and should NOT be treated as
 * stored payload values when extracting the element from a node cell.
 */
export const STRUCTURAL_PTRS = [
  "_M_next", "_M_prev", "_M_left", "_M_right", "_M_parent",
  "_M_color", "_M_nxt", "_M_hash_code", "_M_node", "_M_storage",
];

/**
 * Return the payload cells from a linked-list node.
 *
 * For normal (modern libstdc++) struct nodes: direct children that are NOT in
 * STRUCTURAL_PTRS.  If none, unwrap `_M_storage` one level.
 *
 * For old libstdc++ / this tracer: the heap entry is a C_ARRAY (kind="array")
 * where [0] = _List_node_base (the link fields) and [1] = value area (the int
 * bytes, often shown as UNINITIALIZED by Valgrind because the tracer
 * misidentifies them as pointer-typed).  In that layout the int payload is not
 * numerically readable, so we return the [1] element as a best-effort stand-in.
 */
export function nodePayload(node: NormalizedCell): NormalizedCell[] {
  if (node.kind === "array") {
    // C_ARRAY wrapper: [0] = base struct (structural), [1..] = value area.
    // The value area is the element we want — even if its own children are all
    // structural (UNINITIALIZED pointer-typed bytes), we still include it so
    // walkList can count the node.
    const valueArea = node.children?.slice(1) ?? [];
    return valueArea;
  }
  const direct = node.children ?? [];
  const payload = direct.filter((c) => !STRUCTURAL_PTRS.includes(c.name));
  if (payload.length > 0) return payload;
  // libstdc++ wraps the value in `_M_storage`; unwrap one level.
  const storage = direct.find((c) => c.name === "_M_storage");
  return storage?.children ?? [];
}

/**
 * Walk a singly- or doubly-linked list following `nextName` references,
 * collecting node payloads as numbered children.
 *
 * Stops when:
 *   - addr is undefined / "0x0"
 *   - addr equals stopAddr (circular-list sentinel)
 *   - addr was already visited (cycle guard)
 *   - the node is not found in heapByAddress
 */
export function walkList(
  ctx: { heapByAddress: Map<string, NormalizedCell>; consumed: Set<string> },
  startAddr: string | undefined,
  nextName: string,
  stopAddr?: string,
): NormalizedCell[] {
  const out: NormalizedCell[] = [];
  const seen = new Set<string>();
  let addr = startAddr;
  while (addr && addr !== "0x0" && addr !== stopAddr && !seen.has(addr)) {
    seen.add(addr);
    const node = ctx.heapByAddress.get(addr);
    if (!node) break;
    ctx.consumed.add(addr);
    const payload = nodePayload(node);
    if (payload.length === 1) {
      out.push({ ...payload[0], name: `[${out.length}]` });
    } else if (payload.length > 1) {
      out.push({ ...node, kind: "struct", name: `[${out.length}]`, children: payload, displayValue: "" });
    }
    // payload.length === 0: node not counted (no useful data found).
    addr = findPointer(node, nextName);
  }
  return out;
}

export function parseAddr(addr?: string | null): number | null {
  if (!addr) return null;
  const n = Number.parseInt(addr, 16);
  return Number.isNaN(n) ? null : n;
}

/** Depth-first search for the first descendant (or self) named `name`. */
export function findMember(cell: NormalizedCell, name: string): NormalizedCell | undefined {
  if (cell.name === name) return cell;
  for (const child of cell.children ?? []) {
    const found = findMember(child, name);
    if (found) return found;
  }
  return undefined;
}

/** Target address of a reference member found by name, anywhere in the subtree. */
export function findPointer(cell: NormalizedCell, name: string): string | undefined {
  const m = findMember(cell, name);
  return m && m.kind === "reference" ? m.targetAddress : undefined;
}

/** Nth template argument of a type string, e.g. templateArg("map<int, string>", 1) -> "string". */
export function templateArg(type: string, n = 0): string {
  const inner = type.slice(type.indexOf("<") + 1, type.lastIndexOf(">"));
  let depth = 0, start = 0, idx = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "<") depth++;
    else if (c === ">") depth--;
    else if (c === "," && depth === 0) {
      if (idx === n) return inner.slice(start, i).trim();
      idx++; start = i + 1;
    }
  }
  return idx === n ? inner.slice(start).trim() : "";
}
