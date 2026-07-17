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
  /** True when a container's children are opaque "?" placeholders (values not
   *  recoverable from this tracer); suppresses key/value pair layout. */
  placeholders?: boolean;
  note?: string;
  /** True for compiler-generated top-level stack locals (name starts with `__`),
   *  e.g. range-for temporaries __for_range/__for_begin/__for_end. Hidden by
   *  default behind the per-frame internals toggle. */
  internal?: boolean;
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
        displayValue: formatScalar(value, type),
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

function buildAddressMap(cells: NormalizedCell[]): Map<string, NormalizedCell> {
  const addressMap = new Map<string, NormalizedCell>();
  for (const cell of flattenCells(cells)) {
    if (cell.address && !addressMap.has(cell.address)) addressMap.set(cell.address, cell);
  }
  return addressMap;
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
  const initialAddressMap = buildAddressMap([...rawGlobals, ...rawFrames.flatMap((f) => f.cells), ...heapRaw]);

  const consumed = new Set<string>();
  const ctx: DecodeCtx = { heapByAddress, consumed };

  // Run resolveReferences both BEFORE and AFTER resolveContainers.
  // Smart-pointer decoders (sharedPtrDecoder, etc.) emit a NEW reference cell
  // DURING resolveContainers — after the first resolveReferences pass already ran —
  // so their targetId/link would never be computed without the second pass.
  const resolveForDecoding = (cells: NormalizedCell[]) =>
    resolveContainers(resolveReferences(cells, initialAddressMap), ctx);

  // Resolve the heap FIRST, then re-point heapByAddress at the decoded buffers.
  // Container decoders (vector/deque/string) inline a heap buffer by address; a
  // nested container like vector<vector<int>> has buffer elements that are
  // themselves containers, so the buffer must already be decoded when the outer
  // container inlines it — otherwise the inner elements render as raw structs.
  const heapResolved = resolveForDecoding(heapRaw);
  for (const cell of heapResolved) {
    if (cell.address) heapByAddress.set(cell.address, cell);
  }

  const globalsWithContainers = resolveForDecoding(rawGlobals);
  const framesWithContainers = rawFrames.map((frame) => ({
    ...frame,
    cells: resolveForDecoding(frame.cells),
  }));
  const visibleHeap = heapResolved.filter((cell) => !(cell.address && consumed.has(cell.address)));

  // Rebuild address targets from the final visible tree. Container elements now
  // have logical IDs (v-1) instead of heap-buffer IDs, and consumed heap buffers
  // are hidden, so pointer/iterator links must resolve against this decoded view.
  const finalAddressMap = buildAddressMap([
    ...globalsWithContainers,
    ...framesWithContainers.flatMap((f) => f.cells),
    ...visibleHeap,
  ]);
  const globals = resolveReferences(globalsWithContainers, finalAddressMap);
  const frames = framesWithContainers.map((frame) => ({
    ...frame,
    cells: resolveReferences(frame.cells, finalAddressMap),
  }));
  const heap = resolveReferences(visibleHeap, finalAddressMap);

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
      cells: names.map((name) => {
        const cell = decodeMemoryValue(locals[name], name, "stack", frameId);
        return isCompilerInternal(name) ? { ...cell, internal: true } : cell;
      }),
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

export function isCompilerInternal(name: string): boolean {
  return name.startsWith("__");
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

function formatScalar(value: unknown, type?: string | null): string {
  if (value === null) return "null";
  if (type === "bool" && (value === 0 || value === 1)) return value === 1 ? "true" : "false";
  if (type === "char" && typeof value === "number") return formatChar(value);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "...";
}

const CHAR_ESCAPES: Record<number, string> = { 0: "\\0", 9: "\\t", 10: "\\n", 13: "\\r" };

// Only plain `char` gets glyph rendering; signed/unsigned char are byte-valued
// in practice and stay numeric. Codes outside escapes + printable ASCII also
// stay numeric rather than render mojibake.
function formatChar(code: number): string {
  const esc = CHAR_ESCAPES[code];
  if (esc) return `'${esc}'`;
  if (code >= 32 && code <= 126) return `'${String.fromCharCode(code)}'`;
  return String(code);
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
