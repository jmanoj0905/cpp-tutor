import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { act, renderHook } from "@testing-library/react";
import { Vcr } from "../src/controls/Vcr";
import { usePlayer } from "../src/player/usePlayer";
import type { Trace } from "../src/types/trace";

const mk = (n: number): Trace => ({
  code: "x",
  trace: Array.from({ length: n }, (_, i) => ({
    line: i + 1,
    event: "step_line",
    func_name: "main",
    stack_to_render: [],
    heap: {},
    globals: {},
    ordered_globals: [],
    stdout: "",
  })),
});

const mkLines = (lines: number[]): Trace => ({
  code: "x",
  trace: lines.map((line) => ({
    line, event: "step_line", func_name: "main",
    stack_to_render: [], heap: {}, globals: {}, ordered_globals: [], stdout: "",
  })),
});

describe("Vcr", () => {
  it("shows counter and advances on Next", () => {
    const { result } = renderHook(() => usePlayer(mk(4)));
    const { rerender } = render(<Vcr player={result.current} />);

    expect(screen.getByText(/Step 1 of 4/)).toBeDefined();

    act(() => result.current.next());
    rerender(<Vcr player={result.current} />);

    expect(screen.getByText(/Step 2 of 4/)).toBeDefined();
  });

  it("scrubs to a step with the slider", () => {
    const { result } = renderHook(() => usePlayer(mk(4)));
    const { rerender } = render(<Vcr player={result.current} />);

    fireEvent.change(screen.getByLabelText("Execution step"), { target: { value: "3" } });
    rerender(<Vcr player={result.current} />);

    expect(result.current.index).toBe(3);
    expect(screen.getByText(/Step 4 of 4/)).toBeDefined();
  });

  it("renders a step mark per step", () => {
    const { result } = renderHook(() => usePlayer(mk(4)));
    const { container } = render(<Vcr player={result.current} />);
    const marks = container.querySelectorAll(".step-mark");
    expect(marks.length).toBe(4);
    // Marks must sit where the 11px thumb's center stops, not on the raw
    // track percentage: center travel spans [5.5px, 100% - 5.5px].
    expect((marks[0] as HTMLElement).style.left).toBe("calc(5.5px + 0 * (100% - 11px))");
    expect((marks[3] as HTMLElement).style.left).toBe("calc(5.5px + 1 * (100% - 11px))");
  });

  it("positions breakpoint ticks on the thumb travel range", () => {
    const { result } = renderHook(() => usePlayer(mkLines([5, 6, 5, 7, 5])));
    const { container } = render(<Vcr player={result.current} breakpoints={new Set([6])} />);
    const tick = container.querySelector(".tick") as HTMLElement;
    expect(tick.style.left).toBe("calc(5.5px + 0.25 * (100% - 11px))");
  });

  it("omits step marks when the trace is too dense", () => {
    const { result } = renderHook(() => usePlayer(mk(200)));
    const { container } = render(<Vcr player={result.current} />);
    expect(container.querySelectorAll(".step-mark").length).toBe(0);
  });

  it("renders a tick per breakpoint hit", () => {
    const { result } = renderHook(() => usePlayer(mkLines([5, 6, 5, 7, 5])));
    const { container } = render(<Vcr player={result.current} breakpoints={new Set([5])} />);
    expect(container.querySelectorAll(".tick").length).toBe(3);
  });

  it("Next jumps to the next breakpoint hit when breakpoints are set", () => {
    const { result } = renderHook(() => usePlayer(mkLines([5, 6, 5, 7, 5])));
    const { rerender } = render(<Vcr player={result.current} breakpoints={new Set([5])} />);
    act(() => fireEvent.click(screen.getByText(/Next/)));
    rerender(<Vcr player={result.current} breakpoints={new Set([5])} />);
    expect(result.current.index).toBe(2);
  });

  it("warns about breakpoints on lines the trace never reaches", () => {
    const { result } = renderHook(() => usePlayer(mkLines([5, 6, 5])));
    const { container } = render(
      <Vcr player={result.current} breakpoints={new Set([5, 9, 12])} deadLines={[9, 12]} />,
    );
    const notice = container.querySelector(".bp-dead-notice");
    expect(notice?.textContent).toContain("lines 9, 12");
  });

  it("shows no dead-breakpoint warning when all breakpoints are hit", () => {
    const { result } = renderHook(() => usePlayer(mkLines([5, 6, 5])));
    const { container } = render(
      <Vcr player={result.current} breakpoints={new Set([5])} deadLines={[]} />,
    );
    expect(container.querySelector(".bp-dead-notice")).toBeNull();
  });
});
