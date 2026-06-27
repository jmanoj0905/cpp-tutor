import type { ExecPoint } from "../types/trace";

export type MemorySource = "stack" | "global" | "heap";
export type MemoryCellKind = "scalar" | "reference" | "struct" | "array" | "vector" | "string" | "summary";

export interface NormalizedCell {
  id: string;
  name: string;
  source: MemorySource;
  kind: MemoryCellKind;
  address: string | null;
  type: string | null;
  displayValue: string;
  rawValue: unknown;
  targetAddress?: string;
  targetId?: string;
  unresolved?: boolean;
  children?: NormalizedCell[];
  length?: number;
  elementType?: string;
  startAddress?: string;
  finishAddress?: string;
}

export interface NormalizedFrame {
  id: string;
  name: string;
  cells: NormalizedCell[];
}

export interface MemoryLink {
  fromId: string;
  fromName: string;
  toId: string;
  targetAddress: string;
}

export interface NormalizedMemory {
  globals: NormalizedCell[];
  frames: NormalizedFrame[];
  heap: NormalizedCell[];
  links: MemoryLink[];
}

interface OptFrame {
  func_name?: string;
  frame_id?: string;
  unique_hash?: string;
  ordered_varnames?: string[];
  encoded_locals?: Record<string, unknown>;
}

export function decodeMemoryValue(
  rawValue: unknown,
  name: string,
  source: MemorySource,
  idPrefix: string,
): NormalizedCell {
  const base = {
    id: toCellId(source, idPrefix, name),
    name,
    source,
    rawValue,
  };

  if (Array.isArray(rawValue)) {
    const tag = rawValue[0];

    if (tag === "C_DATA" && rawValue.length >= 4) {
      const address = toOptionalString(rawValue[1]);
      const type = toOptionalString(rawValue[2]);
      const value = rawValue[3];
      const targetAddress = getReferenceTarget(value) ?? getPointerAddress(type, value);

      if (targetAddress) {
        return {
          ...base,
          kind: "reference",
          address,
          type,
          displayValue: formatReference(targetAddress),
          targetAddress,
        };
      }

      return {
        ...base,
        kind: "scalar",
        address,
        type,
        displayValue: formatScalar(value),
      };
    }

    if (tag === "REF" && rawValue.length >= 2) {
      const targetAddress = toOptionalString(rawValue[1]) ?? "unknown";
      return {
        ...base,
        kind: "reference",
        address: null,
        type: null,
        displayValue: formatReference(targetAddress),
        targetAddress,
      };
    }

    if (tag === "C_ARRAY") {
      const address = toOptionalString(rawValue[1]);
      const elements = rawValue.slice(2);
      const children = elements.map((el, i) =>
        decodeMemoryValue(el, `[${i}]`, source, childPrefix(idPrefix, name)),
      );
      return {
        ...base,
        kind: "array",
        address,
        type: "array",
        length: children.length,
        children,
        displayValue: `${childElementType(children)}[${children.length}]`,
      };
    }

    if (tag === "C_MULTIDIMENSIONAL_ARRAY") {
      const address = toOptionalString(rawValue[1]);
      const dims = Array.isArray(rawValue[2]) ? (rawValue[2] as number[]) : [];
      const elements = rawValue.slice(3);
      const children = elements.map((el, i) =>
        decodeMemoryValue(el, `[${i}]`, source, childPrefix(idPrefix, name)),
      );
      return {
        ...base,
        kind: "array",
        address,
        type: "array",
        length: children.length,
        children,
        displayValue: `array[${dims.join("][")}]`,
      };
    }

    if (tag === "C_STRUCT") {
      const address = toOptionalString(rawValue[1]);
      const type = toOptionalString(rawValue[2]) ?? "object";
      const memberEntries = rawValue.slice(3) as [string, unknown][];
      const children = memberEntries.map(([memberName, memberValue]) =>
        decodeMemoryValue(memberValue, memberName, source, childPrefix(idPrefix, name)),
      );

      const ptrs = collectPointerMembers(children);
      if (isVectorType(type) && ptrs.has("_M_start")) {
        const startAddress = ptrs.get("_M_start");
        const finishAddress = ptrs.get("_M_finish");
        return {
          ...base, kind: "vector", address, type,
          elementType: templateArg(type),
          startAddress, finishAddress,
          targetAddress: startAddress,
          displayValue: `vector<${templateArg(type)}>`,
        };
      }
      if (isStringType(type) && ptrs.has("_M_p")) {
        return {
          ...base, kind: "string", address, type,
          startAddress: ptrs.get("_M_p"),
          displayValue: '""',
        };
      }

      return { ...base, kind: "struct", address, type, children, displayValue: type };
    }

    return {
      ...base,
      kind: "summary",
      address: null,
      type: null,
      displayValue: "...",
    };
  }

  if (rawValue !== null && typeof rawValue === "object") {
    return {
      ...base,
      kind: "summary",
      address: null,
      type: null,
      displayValue: "{...}",
    };
  }

  return {
    ...base,
    kind: "scalar",
    address: null,
    type: null,
    displayValue: formatScalar(rawValue),
  };
}

function flattenCells(cells: NormalizedCell[]): NormalizedCell[] {
  return cells.flatMap((cell) => [cell, ...flattenCells(cell.children ?? [])]);
}

function isVectorType(type: string): boolean {
  return /\bvector\s*</.test(type);
}

function isStringType(type: string): boolean {
  return /basic_string|\bstring\b/.test(type);
}

function templateArg(type: string): string {
  const m = type.match(/<\s*([^,>]+)/);
  return m ? m[1].trim() : "";
}

function collectPointerMembers(children: NormalizedCell[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of children) {
    if (c.kind === "reference" && c.targetAddress && !out.has(c.name)) out.set(c.name, c.targetAddress);
    if (c.children) for (const [k, v] of collectPointerMembers(c.children)) if (!out.has(k)) out.set(k, v);
  }
  return out;
}

function parseAddr(addr?: string | null): number | null {
  if (!addr) return null;
  const n = Number.parseInt(addr, 16);
  return Number.isNaN(n) ? null : n;
}

function computeVectorSize(start: string | undefined, finish: string | undefined, buffer: NormalizedCell): number {
  const elems = buffer.children ?? [];
  const s = parseAddr(start), f = parseAddr(finish);
  if (s !== null && f !== null && elems.length >= 2) {
    const e0 = parseAddr(elems[0].address), e1 = parseAddr(elems[1].address);
    if (e0 !== null && e1 !== null && e1 > e0) {
      const size = Math.round((f - s) / (e1 - e0));
      if (size >= 0 && size <= elems.length) return size;
    }
  }
  if (s !== null && f !== null) {
    if (f === s) return 0;
  }
  return elems.length;
}

function resolveVectors(
  cells: NormalizedCell[],
  heapByAddress: Map<string, NormalizedCell>,
  consumed: Set<string>,
): NormalizedCell[] {
  return cells.map((cell) => {
    const children = cell.children ? resolveVectors(cell.children, heapByAddress, consumed) : cell.children;
    if (cell.kind === "vector" && cell.startAddress) {
      const buffer = heapByAddress.get(cell.startAddress);
      if (buffer) {
        consumed.add(cell.startAddress);
        const size = computeVectorSize(cell.startAddress, cell.finishAddress, buffer);
        const elems = (buffer.children ?? []).slice(0, size).map((c, i) => ({ ...c, name: `[${i}]` }));
        return { ...cell, children: elems, length: size, displayValue: `vector<${cell.elementType ?? ""}> · ${size}` };
      }
      return { ...cell, children, length: 0, displayValue: `vector<${cell.elementType ?? ""}> · 0` };
    }
    if (cell.kind === "string" && cell.startAddress) {
      const buffer = heapByAddress.get(cell.startAddress);
      if (buffer) {
        consumed.add(cell.startAddress);
        const text = (buffer.children ?? []).map((c) => c.displayValue).filter((s) => s !== "0").join("");
        return { ...cell, children: undefined, displayValue: `"${text}"` };
      }
    }
    return { ...cell, children };
  });
}

export function normalizeMemory(point: ExecPoint): NormalizedMemory {
  const heapRaw = normalizeHeap(point.heap);
  const heapByAddress = new Map(heapRaw.flatMap((cell) => (cell.address ? [[cell.address, cell]] : [])));

  const consumed = new Set<string>();
  const globals = resolveVectors(resolveReferences(normalizeGlobals(point), heapByAddress), heapByAddress, consumed);
  const frames = normalizeFrames(point).map((frame) => ({
    ...frame,
    cells: resolveVectors(resolveReferences(frame.cells, heapByAddress), heapByAddress, consumed),
  }));
  const heap = resolveVectors(resolveReferences(heapRaw, heapByAddress), heapByAddress, consumed)
    .filter((cell) => !(cell.address && consumed.has(cell.address)));

  const links = flattenCells([...globals, ...frames.flatMap((f) => f.cells), ...heap])
    .filter((cell) => cell.kind === "reference" && cell.targetId && cell.targetAddress)
    .map((cell) => ({
      fromId: cell.id, fromName: cell.name,
      toId: cell.targetId as string, targetAddress: cell.targetAddress as string,
    }));

  return { globals, frames, heap, links };
}

function normalizeGlobals(point: ExecPoint): NormalizedCell[] {
  const names = orderNames(point.globals, point.ordered_globals);
  return names.map((name) => decodeMemoryValue(point.globals[name], name, "global", "globals"));
}

function normalizeFrames(point: ExecPoint): NormalizedFrame[] {
  return (point.stack_to_render as OptFrame[]).map((frame, index) => {
    const locals = frame.encoded_locals ?? {};
    const frameId = frame.unique_hash ?? frame.frame_id ?? `frame-${index}`;
    const names = orderNames(locals, frame.ordered_varnames ?? []);

    return {
      id: frameId,
      name: frame.func_name ?? `frame ${index + 1}`,
      cells: names.map((name) => decodeMemoryValue(locals[name], name, "stack", frameId)),
    };
  });
}

function normalizeHeap(heap: Record<string, unknown>): NormalizedCell[] {
  return Object.entries(heap).map(([address, rawValue]) => {
    const cell = decodeMemoryValue(rawValue, address, "heap", "heap");
    return {
      ...cell,
      name: address,
      address: cell.address ?? address,
      id: toCellId("heap", "heap", address),
    };
  });
}

function resolveReferences(cells: NormalizedCell[], heapByAddress: Map<string, NormalizedCell>): NormalizedCell[] {
  return cells.map((cell) => {
    const children = cell.children ? resolveReferences(cell.children, heapByAddress) : cell.children;
    if (cell.kind !== "reference" || !cell.targetAddress) return { ...cell, children };
    const target = heapByAddress.get(cell.targetAddress);
    if (!target) return { ...cell, children, unresolved: true };
    return { ...cell, children, targetId: target.id, unresolved: false };
  });
}

function orderNames(record: Record<string, unknown>, ordered: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const name of ordered) {
    if (Object.prototype.hasOwnProperty.call(record, name)) {
      names.push(name);
      seen.add(name);
    }
  }

  for (const name of Object.keys(record)) {
    if (!seen.has(name)) names.push(name);
  }

  return names;
}

function getReferenceTarget(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  if (value[0] !== "REF" || value.length < 2) return null;
  return toOptionalString(value[1]);
}

function getPointerAddress(type: string | null, value: unknown): string | null {
  if (!type || !isPointerType(type)) return null;
  const target = toOptionalString(value);
  if (!target || target === "0x0" || target === "<UNINITIALIZED>") return null;
  if (!isAddressLike(target)) return null;
  return target;
}

function isPointerType(type: string): boolean {
  const normalized = type.toLowerCase();
  return normalized.includes("*") || normalized.includes("pointer") || normalized.includes("&");
}

function isAddressLike(value: string): boolean {
  return /^0x[0-9a-f]+$/i.test(value);
}

function formatScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "...";
}

function formatReference(targetAddress: string): string {
  return `-> ${targetAddress}`;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function toCellId(source: MemorySource, idPrefix: string, name: string): string {
  return `${source}-${idPrefix}-${name}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function childPrefix(idPrefix: string, name: string): string {
  return `${idPrefix}-${name}`;
}

function childElementType(children: NormalizedCell[]): string {
  return children[0]?.type ?? "";
}
