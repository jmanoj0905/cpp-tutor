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
});
