import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { Vcr } from "../src/controls/Vcr";
import { usePlayer } from "../src/player/usePlayer";
import type { Trace } from "../src/types/trace";

const mk = (n: number): Trace => ({
  code: "x",
  trace: Array.from({ length: n }, (_, i) => ({
    line: i + 1, event: "step_line", func_name: "main",
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
});
