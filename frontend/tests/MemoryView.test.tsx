import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryCell } from "../src/viz/MemoryCell";
import type { NormalizedCell } from "../src/viz/memoryModel";
import { MemoryView } from "../src/viz/MemoryView";
import type { ExecPoint, Trace } from "../src/types/trace";
import listReverseFx from "./fixtures/shapes/list-reverse.json";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
// jsdom has no CSS.escape either; minimal polyfill so ShapePanel's
// scroll-into-view effect's querySelector doesn't throw.
if (typeof (globalThis as any).CSS === "undefined") {
  (globalThis as any).CSS = { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "\\$&") };
}

function cell(p: Partial<NormalizedCell>): NormalizedCell {
  return { id: "id", name: "n", source: "stack", kind: "scalar", address: null, type: null, displayValue: "", rawValue: null, ...p };
}

describe("MemoryCell", () => {
  it("tags a reference cell with cell id and a port", () => {
    const { container } = render(<MemoryCell cell={cell({ id: "stack-f-p", name: "p", kind: "reference", displayValue: "-> 0x100", targetAddress: "0x100" })} />);
    expect(container.querySelector('[data-cell-id="stack-f-p"]')).not.toBeNull();
    expect(container.querySelector('[data-port-id="stack-f-p"]')).not.toBeNull();
  });

  it("renders a vector header and indexed children", () => {
    render(<MemoryCell cell={cell({ id: "v", name: "v", kind: "container", containerKind: "vector", elementType: "int", length: 2, displayValue: "vector<int> · 2",
      children: [cell({ id: "v0", name: "[0]", displayValue: "10" }), cell({ id: "v1", name: "[1]", displayValue: "20" })] })} />);
    expect(screen.getByText("vector<int> · 2")).toBeDefined();
    expect(screen.getByText("10")).toBeDefined();
    expect(screen.getByText("20")).toBeDefined();
  });

  it("keeps std::string characters collapsed behind the quoted value", () => {
    const chars = [
      cell({ id: "s0", name: "[0]", displayValue: "a" }),
      cell({ id: "s1", name: "[1]", displayValue: "b" }),
      cell({ id: "s2", name: "[2]", displayValue: "c" }),
    ];
    const { container } = render(<MemoryCell cell={cell({
      id: "s", name: "s", kind: "container", containerKind: "string",
      displayValue: "\"abc\"", children: chars,
    })} />);
    expect(screen.getByText("\"abc\"")).toBeDefined();
    expect(container.querySelector('[data-cell-id="s0"]')).toBeNull();
    fireEvent.click(screen.getByText("show 3 chars"));
    expect(container.querySelector('[data-cell-id="s0"]')).not.toBeNull();
  });

  it("auto-shows changed std::string characters", () => {
    const chars = [
      cell({ id: "s0", name: "[0]", displayValue: "a" }),
      cell({ id: "s1", name: "[1]", displayValue: "x" }),
    ];
    const { container } = render(<MemoryCell
      cell={cell({ id: "s", name: "s", kind: "container", containerKind: "string",
        displayValue: "\"ax\"", children: chars })}
      changedIds={new Set(["s1"])}
    />);
    expect(container.querySelector('[data-cell-id="s1"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-id="s1"]')?.className).toContain("cell-changed");
  });

  it("does not tint a composite container body when the container id is marked changed", () => {
    const { container } = render(<MemoryCell
      cell={cell({ id: "v", name: "v", kind: "container", containerKind: "vector", displayValue: "vector<int> · 2",
        children: [cell({ id: "v0", name: "[0]", displayValue: "10" })] })}
      changedIds={new Set(["v"])}
    />);
    expect(container.querySelector('[data-cell-id="v"]')?.className).not.toContain("cell-changed");
    expect(container.querySelector(".cell-head")?.className).toContain("cell-changed");
  });

  it("renders globals, stack frames by name, and heap sections", () => {
    const point: ExecPoint = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: ["g"], globals: { g: ["C_DATA", "0x1", "int", 5] },
      heap: { "0x100": ["C_DATA", "0x100", "int", 7] },
      stack_to_render: [{ unique_hash: "main_0x1", frame_id: "0x1", func_name: "main",
        ordered_varnames: ["x"], encoded_locals: { x: ["C_DATA", "0x10", "int", 41] } }] as any,
    };
    render(<MemoryView point={point} trace={[point]} code="" />);
    expect(screen.getByText("Globals")).toBeDefined();
    expect(screen.getByText("main")).toBeDefined();
    expect(screen.getByText("Heap")).toBeDefined();
    expect(screen.getByText("41")).toBeDefined();
  });

  it("renders a container cell with its summary and elements", () => {
    const point = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {},
      heap: { "0x9000": ["C_ARRAY", "0x9000",
        ["C_DATA", "0x9000", "int", 7], ["C_DATA", "0x9004", "int", 8]] },
      stack_to_render: [{
        unique_hash: "main_0x1", frame_id: "0x1", func_name: "main",
        ordered_varnames: ["v"],
        encoded_locals: { v: ["C_STRUCT", "0x10", "std::vector<int>",
          ["_M_start",  ["C_DATA", "0x10", "pointer", ["REF", "0x9000"]]],
          ["_M_finish", ["C_DATA", "0x18", "pointer", ["REF", "0x9008"]]]] },
      }],
    } as any;
    const { container } = render(<MemoryView point={point} trace={[point]} code="" />);
    expect(container.querySelector(".cell-container")).toBeTruthy();
    expect(container.textContent).toContain("vector<int>");
  });

  it("renders a placeholder map as a grid, not key/value pairs", () => {
    const { container } = render(<MemoryCell cell={cell({
      id: "m", name: "m", kind: "container", containerKind: "map",
      placeholders: true, length: 2, displayValue: "map<int,int> · 2",
      children: [cell({ id: "m0", name: "[0]", displayValue: "?" }),
                 cell({ id: "m1", name: "[1]", displayValue: "?" })],
    })} />);
    expect(container.querySelector(".cell-children.grid")).toBeTruthy();
    expect(container.querySelector(".cell-children.kv")).toBeNull();
  });

  it("renders recovered unordered_multimap rows with key/value layout", () => {
    const row = (id: string, key: string, value: string) => cell({
      id, name: "[0]", kind: "container", containerKind: "pair",
      displayValue: `(${key}, ${value})`,
      children: [
        cell({ id: `${id}-first`, name: "first", displayValue: key }),
        cell({ id: `${id}-second`, name: "second", displayValue: value }),
      ],
    });
    const { container } = render(<MemoryCell cell={cell({
      id: "um", name: "um", kind: "container", containerKind: "unordered_multimap",
      length: 2, displayValue: "unordered_multimap<int,int> · 2",
      children: [row("um0", "1", "10"), row("um1", "1", "11")],
    })} />);
    const parent = container.querySelector('[data-cell-id="um"]');
    expect(parent?.querySelector(":scope > .cell-children.kv")).toBeTruthy();
    expect(parent?.querySelector(":scope > .cell-children.grid")).toBeNull();
  });

  it("renders a rectangular 2D container as aligned matrix rows", () => {
    const mkRow = (id: string, a: string, b: string, c: string) =>
      cell({ id, name: id, kind: "container", containerKind: "vector",
        children: [
          cell({ id: `${id}0`, name: "[0]", displayValue: a }),
          cell({ id: `${id}1`, name: "[1]", displayValue: b }),
          cell({ id: `${id}2`, name: "[2]", displayValue: c }),
        ] });
    const m = cell({ id: "m", name: "m", kind: "container", containerKind: "vector",
      displayValue: "vector<vector<int>> · 2",
      children: [mkRow("r0", "1", "2", "3"), mkRow("r1", "4", "5", "6")] });

    const { container } = render(<MemoryCell cell={m} />);
    expect(container.querySelectorAll(".matrix-row").length).toBe(2);
    // every element still individually addressable for connectors
    expect(container.querySelector('[data-cell-id="r00"]')).not.toBeNull();
    expect(container.querySelector('[data-cell-id="r12"]')).not.toBeNull();
  });

  it("renders a 3D container as an indexed list of 2D matrix slices", () => {
    const mkRow = (id: string, a: string, b: string) =>
      cell({ id, name: id, kind: "container", containerKind: "vector",
        children: [
          cell({ id: `${id}0`, name: "[0]", displayValue: a }),
          cell({ id: `${id}1`, name: "[1]", displayValue: b }),
        ] });
    const mkSlice = (id: string, name: string, base: number) =>
      cell({ id, name, kind: "container", containerKind: "vector",
        displayValue: "vector<vector<int>> · 2",
        children: [
          mkRow(`${id}r0`, String(base), String(base + 1)),
          mkRow(`${id}r1`, String(base + 2), String(base + 3)),
        ] });
    const cube = cell({ id: "cube", name: "cube", kind: "container", containerKind: "vector",
      displayValue: "vector<vector<vector<int>>> · 2",
      children: [mkSlice("s0", "[0]", 1), mkSlice("s1", "[1]", 5)] });

    const { container } = render(<MemoryCell cell={cube} />);
    expect(container.querySelector(".matrix-slices")).toBeTruthy();
    expect(container.querySelectorAll(".matrix-slices > .cell")).toHaveLength(2);
    expect(container.querySelectorAll(".matrix-row")).toHaveLength(4);
    expect(container.querySelector('[data-cell-id="s0"] .cell-name')?.textContent).toBe("[0]");
    expect(container.querySelector('[data-cell-id="s1"] .cell-name')?.textContent).toBe("[1]");
  });

  it("renders 4D and deeper containers as indexed linear nesting", () => {
    const mkLine = (id: string, a: string, b: string) =>
      cell({ id, name: id, kind: "container", containerKind: "vector",
        children: [
          cell({ id: `${id}0`, name: "[0]", displayValue: a }),
          cell({ id: `${id}1`, name: "[1]", displayValue: b }),
        ] });
    const mkMatrix = (id: string) =>
      cell({ id, name: "[0]", kind: "container", containerKind: "vector",
        children: [mkLine(`${id}r0`, "1", "2"), mkLine(`${id}r1`, "3", "4")] });
    const mkCube = (id: string, name: string) =>
      cell({ id, name, kind: "container", containerKind: "vector",
        children: [mkMatrix(`${id}m0`), mkMatrix(`${id}m1`)] });
    const hyper = cell({ id: "h", name: "h", kind: "container", containerKind: "vector",
      displayValue: "vector<vector<vector<vector<int>>>> · 2",
      children: [mkCube("c0", "[0]"), mkCube("c1", "[1]")] });

    const { container } = render(<MemoryCell cell={hyper} />);
    expect(container.querySelector(".cell-children.linear")).toBeTruthy();
    expect(container.querySelector(".matrix-slices")).toBeNull();
    expect(container.querySelector(".matrix")).toBeNull();
    expect(container.querySelector('[data-cell-id="c0"] .cell-name')?.textContent).toBe("[0]");
    expect(container.querySelector('[data-cell-id="c1"] .cell-name')?.textContent).toBe("[1]");
  });

  it("renders a stack pane and a heap pane side by side", () => {
    const point = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {},
      heap: { "0x100": ["C_DATA", "0x100", "int", 7] },
      stack_to_render: [{
        unique_hash: "main_0x1", frame_id: "0x1", func_name: "main",
        ordered_varnames: ["p"],
        encoded_locals: { p: ["C_DATA", "0x18", "int *", ["REF", "0x100"]] },
      }],
    } as any;
    const { container } = render(<MemoryView point={point} trace={[point]} code="" />);
    expect(container.querySelector(".stack-pane")).toBeTruthy();
    expect(container.querySelector(".heap-pane")).toBeTruthy();
  });

  it("hides compiler internals behind a per-frame toggle, collapsed by default", () => {
    const point = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {}, heap: {},
      stack_to_render: [{
        unique_hash: "f1", frame_id: "f1", func_name: "main",
        ordered_varnames: ["v", "__for_range"],
        encoded_locals: {
          v: ["C_DATA", "0x10", "int", 5],
          __for_range: ["C_DATA", "0x18", "int", 9],
        },
      }],
    } as any;
    const { container } = render(<MemoryView point={point} trace={[point]} code="" />);
    // internal cell hidden by default
    expect(container.querySelector('[data-cell-id="stack-f1-__for_range"]')).toBeNull();
    // toggle present
    const toggle = container.querySelector(".internals-toggle") as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    // clicking reveals it
    fireEvent.click(toggle);
    expect(container.querySelector('[data-cell-id="stack-f1-__for_range"]')).not.toBeNull();
  });

  it("tints cells whose value changed since the previous point", () => {
    const mk = (x: number) => ({
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {}, heap: {},
      stack_to_render: [{
        unique_hash: "f1", frame_id: "f1", func_name: "main",
        ordered_varnames: ["x", "y"],
        encoded_locals: {
          x: ["C_DATA", "0x10", "int", x],
          y: ["C_DATA", "0x14", "int", 5],
        },
      }],
    }) as any;
    const { container } = render(<MemoryView point={mk(2)} prevPoint={mk(1)} trace={[mk(1), mk(2)]} code="" />);
    expect(container.querySelector('[data-cell-id="stack-f1-x"]')?.className).toContain("cell-changed");
    expect(container.querySelector('[data-cell-id="stack-f1-y"]')?.className).not.toContain("cell-changed");
  });

  it("tints nothing when there is no previous point", () => {
    const point = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {}, heap: {},
      stack_to_render: [{
        unique_hash: "f1", frame_id: "f1", func_name: "main",
        ordered_varnames: ["x"],
        encoded_locals: { x: ["C_DATA", "0x10", "int", 1] },
      }],
    } as any;
    const { container } = render(<MemoryView point={point} prevPoint={null} trace={[point]} code="" />);
    expect(container.querySelector(".cell-changed")).toBeNull();
  });

  it("renders a draggable divider between the stack and heap panes", () => {
    const point = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {}, heap: {},
      stack_to_render: [{
        unique_hash: "f1", frame_id: "f1", func_name: "main",
        ordered_varnames: ["x"],
        encoded_locals: { x: ["C_DATA", "0x10", "int", 1] },
      }],
    } as any;
    const { container } = render(<MemoryView point={point} trace={[point]} code="" />);
    const divider = container.querySelector(".panes .divider");
    expect(divider).toBeTruthy();
    expect(divider?.getAttribute("role")).toBe("separator");
  });

  it("updates the stack/heap split while dragging the divider", () => {
    const point = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {}, heap: {},
      stack_to_render: [{
        unique_hash: "f1", frame_id: "f1", func_name: "main",
        ordered_varnames: ["x"],
        encoded_locals: { x: ["C_DATA", "0x10", "int", 1] },
      }],
    } as any;
    const { container } = render(<MemoryView point={point} trace={[point]} code="" />);
    const panes = container.querySelector(".panes") as HTMLElement;
    panes.getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 100, height: 100 } as DOMRect);
    const divider = container.querySelector(".panes .divider") as HTMLElement;
    // jsdom has no PointerEvent; MouseEvent with a pointer event type still
    // reaches React's onPointerDown/Move handlers.
    fireEvent(divider, new MouseEvent("pointerdown", { bubbles: true }));
    fireEvent(divider, new MouseEvent("pointermove", { bubbles: true, clientX: 300 }));
    expect(panes.style.getPropertyValue("--mem-split")).toBe("30%");
  });

  it("renders no internals toggle when a frame has none", () => {
    const point = {
      line: 1, event: "step_line", func_name: "main", stdout: "",
      ordered_globals: [], globals: {}, heap: {},
      stack_to_render: [{
        unique_hash: "f1", frame_id: "f1", func_name: "main",
        ordered_varnames: ["v"],
        encoded_locals: { v: ["C_DATA", "0x10", "int", 5] },
      }],
    } as any;
    const { container } = render(<MemoryView point={point} trace={[point]} code="" />);
    expect(container.querySelector(".internals-toggle")).toBeNull();
  });
});

describe("MemoryView shape integration", () => {
  const t = (listReverseFx as Trace).trace;
  const shapedStep = t.findIndex((p) => Object.keys(p.heap ?? {}).length >= 3);
  const point = t[shapedStep];

  it("renders a ShapePanel instead of raw ListNode heap cells", () => {
    render(<MemoryView point={point} prevPoint={t[shapedStep - 1]} trace={t} code={(listReverseFx as Trace).code} />);
    expect(screen.getByTestId("shape-ListNode")).toBeTruthy();
    // consumed: no generic struct cell rendered in the heap pane outside the
    // shape panel for ListNode (jsdom's :not() doesn't match ancestors, so
    // filter with closest() instead of a single compound selector)
    const heapPane = document.querySelector(".heap-pane")!;
    const outsideShapePanel = [...heapPane.querySelectorAll("[data-cell-id]")]
      .filter((el) => !el.closest(".shape-panel"));
    expect(outsideShapePanel.length).toBe(0);
  });

  it("raw toggle brings the generic cells back, and the panel goes away", () => {
    render(<MemoryView point={point} prevPoint={null} trace={t} code={(listReverseFx as Trace).code} />);
    fireEvent.click(screen.getByRole("button", { name: /raw/i }));
    expect(screen.queryByTestId("shape-ListNode")).toBeNull();
    const heapPane = document.querySelector(".heap-pane")!;
    expect(heapPane.querySelectorAll("[data-cell-id]").length).toBeGreaterThan(0);
  });
});
