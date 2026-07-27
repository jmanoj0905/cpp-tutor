// frontend/tests/CommandPalette.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { CommandPalette } from "../src/palette/CommandPalette";
import { DEFAULTS } from "../src/settings/settings";

const base = {
  ctx: { mode: "trace" as const },
  settings: DEFAULTS,
  onRun: () => {},
  onClose: () => {},
};

describe("CommandPalette", () => {
  it("shows group headers on empty query", () => {
    render(<CommandPalette {...base} handlers={{}} />);
    expect(screen.getByText("Navigation")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("filters to a flat list (no headers) when typing", () => {
    render(<CommandPalette {...base} handlers={{}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "next" } });
    expect(screen.getByText("Next step")).toBeTruthy();
    expect(screen.queryByText("Navigation")).toBeNull(); // headers hidden while searching
    expect(screen.queryByText("Stop trace")).toBeNull(); // filtered out
  });

  it("runs the selected command on Enter and reports its id", () => {
    const next = vi.fn();
    const onRun = vi.fn();
    render(<CommandPalette {...base} handlers={{ next }} onRun={onRun} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "next" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(next).toHaveBeenCalledOnce();
    expect(onRun).toHaveBeenCalledWith("next");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<CommandPalette {...base} handlers={{}} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("marks the active setting value with a check", () => {
    render(<CommandPalette {...base} handlers={{}} settings={{ ...DEFAULTS, fontSize: "L" }} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "font large" } });
    expect(screen.getByText("✓")).toBeTruthy();
  });
});
