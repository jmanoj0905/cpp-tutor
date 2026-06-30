import type { ExecPoint } from "../types/trace";
import { decodeContainer } from "./stl/registry";
import type { DecodeCtx } from "./stl/types";

export type MemorySource = "stack" | "global" | "heap";
export type MemoryCellKind = "scalar" | "reference" | "struct" | "array" | "summary" | "container";

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
  containerKind?: string;
  note?: string;
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

export function gridShape(cell: NormalizedCell): { rows: number; cols: number } | null {
  if (cell.kind !== "array" && cell.kind !== "container") return null;
  const rows = cell.children ?? [];
  if (rows.length < 2) return null;
  const cols = rows[0].children?.length ?? 0;
  if (cols === 0) return null;
  const rectangular = rows.every((r) => (r.children?.length ?? 0) === cols);
  if (!rectangular) return null;
  return { rows: rows.length, cols };
}

function flattenCells(cells: NormalizedCell[]): NormalizedCell[] {
  return cells.flatMap((cell) => [cell, ...flattenCells(cell.children ?? [])]);
}

function resolveContainers(cells: NormalizedCell[], ctx: DecodeCtx): NormalizedCell[] {
  return cells.map((cell) => {
    const children = cell.children ? resolveContainers(cell.children, ctx) : cell.children;
    const withKids = { ...cell, children };
    if (cell.kind === "struct") {
      const decoded = decodeContainer(withKids, ctx);
      if (decoded) return decoded;
    }
    return withKids;
  });
}

export function normalizeMemory(point: ExecPoint): NormalizedMemory {
  const rawGlobals = normalizeGlobals(point);
  const rawFrames = normalizeFrames(point);
  const heapRaw = normalizeHeap(point.heap);

  const heapByAddress = new Map(heapRaw.flatMap((cell) => (cell.address ? [[cell.address, cell]] : [])));

  // Pointers commonly target stack/global variables (e.g. `int* p = &a`), not
  // only the heap. Resolve references against every decoded cell that owns an
  // address so those pointers draw connector lines too.
  const addressMap = new Map<string, NormalizedCell>();
  for (const cell of flattenCells([...rawGlobals, ...rawFrames.flatMap((f) => f.cells), ...heapRaw])) {
    if (cell.address && !addressMap.has(cell.address)) addressMap.set(cell.address, cell);
  }

  const consumed = new Set<string>();
  const ctx: DecodeCtx = { heapByAddress, consumed };

  // Run resolveReferences both BEFORE and AFTER resolveContainers.
  // Smart-pointer decoders (sharedPtrDecoder, etc.) emit a NEW reference cell
  // DURING resolveContainers — after the first resolveReferences pass already ran —
  // so their targetId/link would never be computed without the second pass.
  const resolve = (cells: NormalizedCell[]) =>
    resolveReferences(resolveContainers(resolveReferences(cells, addressMap), ctx), addressMap);

  const globals = resolve(rawGlobals);
  const frames = rawFrames.map((frame) => ({ ...frame, cells: resolve(frame.cells) }));
  const heap = resolve(heapRaw).filter((cell) => !(cell.address && consumed.has(cell.address)));

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
