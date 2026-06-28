import type { ContainerDecoder } from "./types";
import { findMember, findPointer, templateArg, walkList } from "./helpers";

/**
 * std::list<T> — circular doubly-linked list.
 *
 * libstdc++ layout (old and new):
 *   _List_base::_M_impl::_M_node  — the sentinel header (_List_node_base).
 *     The header's address is the stop sentinel for the circular walk.
 *   Each heap node: _List_node<T> extends _List_node_base (_M_next, _M_prev)
 *     and adds the stored value (T _M_data / _M_storage).
 *
 * Old-tracer note: the heap entries are C_ARRAY cells where [0] = _List_node_base
 * (valid next/prev pointers) and [1] = value area (int bytes shown as UNINITIALIZED
 * by Valgrind — the tracer does not expose the stored int in this libstdc++ version).
 * The chain IS walkable; children represent nodes even without readable values.
 */
export const listDecoder: ContainerDecoder = {
  match: (type) => /\blist\s*</.test(type) && !/forward_list/.test(type),
  decode(cell, ctx) {
    // The sentinel header node — its address is the circular-list stop condition.
    const header = findMember(cell, "_M_node") ?? findMember(cell, "_M_impl");
    const headerAddr = header?.address ?? cell.address ?? undefined;

    // First real list node: header._M_next
    const first = findPointer(cell, "_M_next");
    if (!first || first === "0x0") return null;

    const children = walkList(ctx, first, "_M_next", headerAddr);
    if (children.length === 0) return null;

    const elem = templateArg(cell.type ?? "");
    return {
      ...cell,
      kind: "container",
      containerKind: "list",
      children,
      length: children.length,
      elementType: elem,
      displayValue: `list<${elem}> · ${children.length}`,
    };
  },
};

/**
 * std::forward_list<T> — singly-linked list.
 *
 * libstdc++ layout:
 *   _Fwd_list_base::_M_impl::_M_head (_Fwd_list_node_base) — sentinel before first node.
 *     _M_head._M_next — first real node (null / 0x0 when empty).
 *   Each heap node: _Fwd_list_node<T> extends _Fwd_list_node_base (_M_next)
 *     and adds the stored value.
 *
 * Old-tracer note: same C_ARRAY / UNINITIALIZED limitation as listDecoder.
 */
export const forwardListDecoder: ContainerDecoder = {
  match: (type) => /forward_list\s*</.test(type),
  decode(cell, ctx) {
    // _M_head._M_next via DFS (findPointer finds the first _M_next reference anywhere)
    const first = findPointer(cell, "_M_next");
    if (!first || first === "0x0") return null;

    const children = walkList(ctx, first, "_M_next");
    if (children.length === 0) return null;

    const elem = templateArg(cell.type ?? "");
    return {
      ...cell,
      kind: "container",
      containerKind: "forward_list",
      children,
      length: children.length,
      elementType: elem,
      displayValue: `forward_list<${elem}> · ${children.length}`,
    };
  },
};
