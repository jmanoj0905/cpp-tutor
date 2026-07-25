import type { NormalizedCell, NormalizedFrame, NormalizedMemory } from "./memoryModel";

/** Pure, DOM-free re-presentation of std::string cells as char arrays.
 *
 *  A string cell already carries its characters as stable, indexed logical
 *  children. "Char-array view" is therefore presentation only — no re-decode:
 *  a flipped string reads as `vector<char> · N` (so a `vector<string>` reads as
 *  `vector<vector<char>>`), and its containerKind flips from "string" to
 *  "vector" so `MemoryCell` renders the chars as an indexed grid instead of the
 *  collapsed "show N chars" affordance.
 *
 *  The toggle is per-container (see the design doc). It appears on:
 *    - a homogeneous string SEQUENCE (vector/deque/list/set/... of strings):
 *      one toggle flips every element at once; the elements get no own toggle;
 *    - every OTHER string, wherever it sits — a map key/value, a pair or tuple
 *      member, a struct field, a standalone local: its own per-string toggle,
 *      reached by the generic recursion below.
 *
 *  `charView` holds the ids of cells the user has switched on. Cells that CAN be
 *  toggled but are currently off are still annotated (`charViewToggle: "off"`)
 *  so the header button renders — so this transform runs every render, even
 *  when `charView` is empty. */

const isStringCell = (c: NormalizedCell): boolean => c.containerKind === "string";

/* Containers whose elements are a single homogeneous type — a string-only one
 * gets a whole-container flip. Deliberately excludes the map families (their
 * children are key/value entries, not strings) and pair/tuple/struct/string
 * (heterogeneous or not a container of strings); strings inside those are
 * handled one-by-one by the recursion. Adaptors (stack/queue/priority_queue)
 * are included: they expose their unwrapped elements as children. */
const SEQUENCE_KINDS = new Set([
  "vector", "deque", "list", "forward_list", "array",
  "set", "multiset", "unordered_set", "unordered_multiset",
  "stack", "queue", "priority_queue",
]);

const isSequenceOfStrings = (c: NormalizedCell): boolean =>
  SEQUENCE_KINDS.has(c.containerKind ?? "")
  && (c.children?.length ?? 0) > 0
  && (c.children ?? []).every(isStringCell);

/** Re-present one string cell as a vector<char> (header + kind only; the char
 *  children are already present and unchanged). */
function flipStringToChars(cell: NormalizedCell): NormalizedCell {
  const n = cell.children?.length ?? 0;
  return {
    ...cell,
    containerKind: "vector",
    elementType: "char",
    displayValue: `vector<char> · ${n}`,
  };
}

function transformCell(cell: NormalizedCell, charView: Set<string>): NormalizedCell {
  // A homogeneous string sequence owns its elements' view: they never get an
  // independent toggle. Handle it before the generic recursion so the string
  // children are not annotated as togglable on their own.
  if (isSequenceOfStrings(cell)) {
    const on = charView.has(cell.id);
    const children = (cell.children ?? []).map((child) =>
      on ? flipStringToChars(child) : child,
    );
    return { ...cell, children, charViewToggle: on ? "on" : "off" };
  }

  const children = cell.children?.map((c) => transformCell(c, charView));
  const c: NormalizedCell = children ? { ...cell, children } : cell;

  if (isStringCell(c)) {
    const on = charView.has(c.id);
    const flipped = on ? flipStringToChars(c) : c;
    return { ...flipped, charViewToggle: on ? "on" : "off" };
  }
  return c;
}

const transformCells = (cells: NormalizedCell[], charView: Set<string>): NormalizedCell[] =>
  cells.map((c) => transformCell(c, charView));

const transformFrame = (frame: NormalizedFrame, charView: Set<string>): NormalizedFrame =>
  ({ ...frame, cells: transformCells(frame.cells, charView) });

/** Annotate every string / vector-of-strings cell with its char-view toggle
 *  state, flipping the ones whose ids are in `charView`. Ids are preserved, so
 *  connector links and diff highlighting resolve identically in either view. */
export function applyCharView(memory: NormalizedMemory, charView: Set<string>): NormalizedMemory {
  return {
    ...memory,
    globals: transformCells(memory.globals, charView),
    frames: memory.frames.map((f) => transformFrame(f, charView)),
    heap: transformCells(memory.heap, charView),
  };
}
