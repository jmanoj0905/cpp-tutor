import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../../src/App";
import { fetchTrace } from "../../src/api/client";
import type { Trace } from "../../src/types/trace";
import invalidWrite from "../fixtures/ub/invalid-write.json";
import invalidFree from "../fixtures/ub/invalid-free.json";
import vectorTrace from "../fixtures/vector-trace.json";

vi.mock("../../src/api/client", () => ({ fetchTrace: vi.fn() }));

/** Runs a fixture through the real app and steps to the very last point, which
 *  is where the tracer puts the fault (it fail-fasts on the first error). */
const runToEnd = async (fixture: unknown) => {
  (fetchTrace as any).mockResolvedValue(fixture as unknown as Trace);
  const view = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
  await screen.findByRole("button", { name: /^stop$/i });
  const slider = screen.getByLabelText("Execution step");
  const total = (fixture as Trace).trace.length;
  fireEvent.change(slider, { target: { value: String(total - 1) } });
  return view;
};

describe("App undefined-behaviour lens", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports an out-of-bounds write as a classified diagnosis", async () => {
    const { container } = await runToEnd(invalidWrite);
    expect(container.querySelector(".ub-panel.is-invalid-write")).not.toBeNull();
    expect(screen.getByText("Invalid write")).toBeTruthy();
    expect(container.textContent).toContain("wrote to memory it does not own");
  });

  it("keeps the raw memcheck line available alongside the explanation", async () => {
    const { container } = await runToEnd(invalidWrite);
    expect(container.querySelector(".ub-detail")?.textContent)
      .toContain("Invalid write of size 4");
  });

  it("classifies a double delete differently from a bad write", async () => {
    const { container } = await runToEnd(invalidFree);
    expect(container.querySelector(".ub-panel.is-invalid-free")).not.toBeNull();
    expect(screen.getByText("Invalid delete")).toBeTruthy();
  });

  it("shows no panel at all for a clean program", async () => {
    const { container } = await runToEnd(vectorTrace);
    expect(container.querySelector(".ub-panel")).toBeNull();
  });

  it("does not report UB on the steps before the fault", async () => {
    (fetchTrace as any).mockResolvedValue(invalidWrite as unknown as Trace);
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });
    const slider = screen.getByLabelText("Execution step");
    const total = (invalidWrite as Trace).trace.length;
    for (let s = 0; s < total - 1; s++) {
      fireEvent.change(slider, { target: { value: String(s) } });
      expect(container.querySelector(".ub-panel")).toBeNull();
    }
    fireEvent.change(slider, { target: { value: String(total - 1) } });
    expect(container.querySelector(".ub-panel")).not.toBeNull();
  });
});
