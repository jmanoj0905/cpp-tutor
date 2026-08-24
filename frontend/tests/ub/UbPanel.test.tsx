import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UbPanel } from "../../src/viz/ub/UbPanel";
import { diagnose } from "../../src/viz/ub/diagnose";
import type { Trace } from "../../src/types/trace";
import invalidWrite from "../fixtures/ub/invalid-write.json";
import mismatchedDelete from "../fixtures/ub/mismatched-delete.json";

const msgOf = (fixture: unknown): string => {
  const bad = (fixture as Trace).trace.find((p) => p.event !== "step_line");
  return bad!.exception_msg!;
};

const renderFor = (fixture: unknown, step = 3) =>
  render(<UbPanel diagnosis={diagnose(msgOf(fixture))!} step={step} />);

describe("UbPanel", () => {
  it("leads with the category title", () => {
    renderFor(invalidWrite);
    expect(screen.getByText("Invalid write")).toBeTruthy();
  });

  it("explains what the program did and why it is undefined", () => {
    const { container } = renderFor(invalidWrite);
    const text = container.textContent ?? "";
    expect(text).toContain("wrote to memory it does not own");
    expect(text).toContain("corruption");
  });

  it("keeps the raw memcheck line visible", () => {
    const { container } = renderFor(invalidWrite);
    expect(container.querySelector(".ub-detail")?.textContent)
      .toContain("Invalid write of size 4");
  });

  it("says which step it happened at, per the detail-panel convention", () => {
    const { container } = renderFor(invalidWrite, 7);
    expect(container.textContent).toContain("step 7");
  });

  it("says plainly that execution stopped", () => {
    // Otherwise the VCR simply running out looks like a bug in the tool.
    const { container } = renderFor(invalidWrite);
    expect(container.textContent?.toLowerCase()).toContain("stopped");
  });

  it("carries the category as a class so the panel can style per kind", () => {
    const { container } = renderFor(mismatchedDelete);
    expect(container.querySelector(".ub-panel.is-mismatched-free")).not.toBeNull();
  });

  it("shows the faulting address when the tracer supplies one", () => {
    const { container } = renderFor(invalidWrite);
    expect(container.querySelector(".ub-address")?.textContent).toContain("0x");
  });

  it("shows no address element when the message carries none", () => {
    render(<UbPanel diagnosis={diagnose("ERROR: Invalid write of size 4")!} step={1} />);
    expect(document.querySelectorAll(".ub-address").length).toBe(0);
  });

  it("renders an unknown wording without blanking", () => {
    render(<UbPanel diagnosis={diagnose("ERROR: Brand new wording")!} step={1} />);
    expect(screen.getByText("Memory error")).toBeTruthy();
    expect(screen.getByText("Brand new wording")).toBeTruthy();
  });
});
