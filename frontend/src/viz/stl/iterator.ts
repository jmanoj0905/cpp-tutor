import type { ContainerDecoder } from "./types";
import { findPointer } from "./helpers";

/**
 * Contiguous STL iterators.
 *
 *   • __gnu_cxx::__normal_iterator<...>  (vector / array / string) → _M_current
 *   • std::_Deque_iterator<...>           (deque)                   → _M_cur
 *
 * Each wraps a raw pointer to the element it references. We emit a reference
 * cell whose targetAddress is that pointer; the existing resolveReferences +
 * addressMap machinery then links it to the exact element cell (element
 * addresses are already indexed from the inlined container buffers).
 *
 * Node iterators (list/map/set) are intentionally NOT matched here: those
 * containers are not yet decoded (tracer omits node payloads), so there is no
 * element cell to target. They light up automatically once node decode lands.
 */
export const iteratorDecoder: ContainerDecoder = {
  match: (type) => /__normal_iterator\s*</.test(type) || /_Deque_iterator\s*</.test(type),
  decode(cell) {
    const ptr = findPointer(cell, "_M_current") ?? findPointer(cell, "_M_cur");
    if (!ptr || ptr === "0x0") return null;
    return {
      ...cell,
      kind: "reference",
      containerKind: "iterator",
      targetAddress: ptr,
      note: "iterator",
      children: undefined,
      displayValue: `iter -> ${ptr}`,
    };
  },
};
