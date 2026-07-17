import type { NormalizedCell } from "../memoryModel";

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

function idSegment(name: string, index?: number): string {
  const indexed = name.match(/^\[(\d+)\]$/);
  const raw = indexed ? indexed[1] : name;
  const segment = raw.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (segment) return segment;
  return index === undefined ? "item" : String(index);
}

function rebaseCell(cell: NormalizedCell, id: string, name: string): NormalizedCell {
  return {
    ...cell,
    id,
    name,
    children: cell.children?.map((child, index) =>
      rebaseCell(child, `${id}-${idSegment(child.name, index)}`, child.name),
    ),
  };
}

/**
 * Adopt a decoded child under a container's logical identity. Heap-backed STL
 * buffers move as containers grow; UI diffing must track `v[1]`, not whatever
 * heap address happened to hold that slot on this step.
 */
export function containerChild(
  parent: NormalizedCell,
  child: NormalizedCell,
  name: string,
  index?: number,
): NormalizedCell {
  return rebaseCell(child, `${parent.id}-${idSegment(name, index)}`, name);
}

export function containerChildren(parent: NormalizedCell, children: NormalizedCell[]): NormalizedCell[] {
  return children.map((child, index) => containerChild(parent, child, `[${index}]`, index));
}
