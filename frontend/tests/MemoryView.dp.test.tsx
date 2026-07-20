import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import climbBottomup from "./fixtures/dp/climb-bottomup.json";
import inputFill from "./fixtures/dp/input-fill.json";
import type { Trace } from "../src/types/trace";
import { MemoryView } from "../src/viz/MemoryView";

const renderAt = (t: Trace, step: number) =>
  render(
    <MemoryView
      point={t.trace[step]}
      prevPoint={step > 0 ? t.trace[step - 1] : null}
      trace={t.trace}
      code={t.code}
    />,
  );

// The true last trace index is a "return" event: `dp` has already gone out of
// scope (main's encoded_locals collapses to just `__return__`), so no
// MemoryCell for it is even rendered there. Use the last step where the DP
// local named `name` is still in scope, which is where the fully-computed
// table is actually observable — matches the same fixture quirk documented
// in tests/dpModel.test.ts.
function lastStepInScope(t: Trace, name: string): number {
  for (let s = t.trace.length - 1; s >= 0; s--) {
    const top = t.trace[s].stack_to_render.at(-1) as
      | { encoded_locals?: Record<string, unknown> } | undefined;
    if (top?.encoded_locals && name in top.encoded_locals) return s;
  }
  return t.trace.length - 1;
}

describe("MemoryView DP integration", () => {
  it("climb-bottomup final in-scope step renders a dp panel, not a plain dp array cell", () => {
    const t = climbBottomup as Trace;
    const step = lastStepInScope(t, "dp");
    const { container } = renderAt(t, step);
    expect(container.querySelector(".dp-panel")).not.toBeNull();
    expect(container.querySelectorAll(".dp-cell")).toHaveLength(7);
  });

  it("raw toggle swaps back to the plain array cell and offers restore", () => {
    const t = climbBottomup as Trace;
    const step = lastStepInScope(t, "dp");
    const { container } = renderAt(t, step);
    fireEvent.click(container.querySelector(".dp-generic-toggle")!);
    expect(container.querySelector(".dp-panel")).toBeNull();
    expect(container.textContent).toContain("restore");
  });

  it("input-fill never shows a dp panel", () => {
    const t = inputFill as Trace;
    const { container } = renderAt(t, t.trace.length - 1);
    expect(container.querySelector(".dp-panel")).toBeNull();
  });
});
