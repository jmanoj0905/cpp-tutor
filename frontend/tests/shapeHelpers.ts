import type { NormalizedCell } from "../src/viz/memoryModel";

/** Hand-built heap struct cell in the exact shape normalizeMemory emits. */
export function structCell(
  addr: string,
  type: string,
  members: Array<Partial<NormalizedCell> & { name: string }>,
): NormalizedCell {
  const id = `heap-heap-${addr}`;
  return {
    id, name: addr, source: "heap", kind: "struct", address: addr, type,
    displayValue: type, rawValue: null,
    children: members.map((m) => ({
      id: `${id}-${m.name}`, name: m.name, source: "heap", kind: m.kind ?? "scalar",
      address: null, type: m.type ?? "int", displayValue: m.displayValue ?? "0",
      rawValue: null, ...(m.targetAddress ? { targetAddress: m.targetAddress } : {}),
    })),
  };
}

export const listNode = (addr: string, val: number, next: string | null): NormalizedCell =>
  structCell(addr, "ListNode", [
    { name: "val", type: "int", displayValue: String(val) },
    next
      ? { name: "next", type: "ListNode *", kind: "reference", displayValue: `-> ${next}`, targetAddress: next }
      : { name: "next", type: "ListNode *", displayValue: "0x0" },
  ]);

export const treeNode = (addr: string, val: number, left: string | null, right: string | null): NormalizedCell =>
  structCell(addr, "TreeNode", [
    { name: "val", type: "int", displayValue: String(val) },
    left
      ? { name: "left", type: "TreeNode *", kind: "reference", displayValue: `-> ${left}`, targetAddress: left }
      : { name: "left", type: "TreeNode *", displayValue: "0x0" },
    right
      ? { name: "right", type: "TreeNode *", kind: "reference", displayValue: `-> ${right}`, targetAddress: right }
      : { name: "right", type: "TreeNode *", displayValue: "0x0" },
  ]);

/** Trie node: a `children[count]` array of self-pointers + an endOfWord bool.
 *  `edges` maps array index -> target address for the non-null slots. */
export const trieNode = (
  addr: string,
  edges: Record<number, string>,
  endOfWord = false,
  count = 26,
  ownType = "TrieNode",
): NormalizedCell => {
  const id = `heap-heap-${addr}`;
  const elements: NormalizedCell[] = Array.from({ length: count }, (_, i) => {
    const target = edges[i];
    return {
      id: `${id}-children-${i}`, name: `[${i}]`, source: "heap",
      kind: target ? "reference" : "scalar", address: null, type: "TrieNode *",
      displayValue: target ? `-> ${target}` : "0x0", rawValue: null,
      ...(target ? { targetAddress: target } : {}),
    };
  });
  return {
    id, name: addr, source: "heap", kind: "struct", address: addr, type: ownType,
    displayValue: ownType, rawValue: null,
    children: [
      { id: `${id}-children`, name: "children", source: "heap", kind: "array",
        address: null, type: `${ownType} *[${count}]`, displayValue: "array",
        rawValue: null, children: elements },
      { id: `${id}-endOfWord`, name: "endOfWord", source: "heap", kind: "scalar",
        address: null, type: "bool", displayValue: endOfWord ? "true" : "false", rawValue: null },
    ],
  };
};
