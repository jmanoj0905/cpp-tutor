// Pure shape detection for self-referential heap structs — no React, no DOM.
// A struct type with exactly 1 pointer-to-own-type member is a list candidate,
// exactly 2 is a binary-tree candidate. Detection is by member TYPE, not kind:
// a null `next` decodes as a scalar but keeps its `ListNode *` type.
import type { NormalizedCell } from "./memoryModel";

export interface ShapeEdge {
  fromId: string;
  toId: string;
  member: string;       // e.g. "next", "left"
  memberCellId: string; // leaf cell id of the pointer member (diff tinting)
  slot: number;         // index among self-ptr members: 0 = next/left, 1 = right
  cycleBack?: boolean;  // list back-edge into its own chain
}

const baseType = (t: string | null): string =>
  (t ?? "").replace(/^(struct|class)\s+/, "").trim();

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function selfPtrMembers(cell: NormalizedCell): NormalizedCell[] {
  const own = baseType(cell.type);
  if (!own) return [];
  const re = new RegExp(`^(struct\\s+|class\\s+)?${escapeRe(own)}\\s*\\*$`);
  return (cell.children ?? []).filter((c) => c.type !== null && re.test(c.type));
}

export function candidateKind(cell: NormalizedCell): "list" | "tree" | null {
  if (cell.kind !== "struct") return null;
  const n = selfPtrMembers(cell).length;
  if (n === 1) return "list";
  if (n === 2) return "tree";
  return null;
}

export function shapeTypeName(cell: NormalizedCell): string {
  return baseType(cell.type);
}
