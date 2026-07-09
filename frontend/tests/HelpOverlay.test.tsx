import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HelpOverlay } from "../src/shortcuts/HelpOverlay";
import { SHORTCUT_TABLE } from "../src/shortcuts/keymap";

describe("HelpOverlay", () => {
  it("is a dialog listing every binding from SHORTCUT_TABLE", () => {
    render(<HelpOverlay onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeTruthy();
    for (const row of SHORTCUT_TABLE) {
      expect(screen.getByText(row.keys)).toBeTruthy();
      expect(screen.getByText(row.description)).toBeTruthy();
    }
  });

  it("calls onClose from the close button and the backdrop, not the panel", () => {
    const onClose = vi.fn();
    render(<HelpOverlay onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector(".help-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
