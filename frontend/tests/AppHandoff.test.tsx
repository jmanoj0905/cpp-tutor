import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import App from "../src/App";
import vectorTrace from "./fixtures/vector-trace.json";
import { fetchTrace } from "../src/api/client";
import { encodeHandoff } from "../src/handoff";
import type { Trace } from "../src/types/trace";

vi.mock("../src/api/client", () => ({ fetchTrace: vi.fn() }));

const HANDED = "int main() { int handed_off = 1; return handed_off; }";

/** The extension opens the visualizer at `.../#code=…`; jsdom lets us set it. */
function withHash(hash: string) {
  window.location.hash = hash;
}

describe("editor hand-off from the VSCode extension", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { window.location.hash = ""; });

  it("loads the handed-off source into the editor instead of the sample", () => {
    withHash(encodeHandoff(HANDED, false));
    render(<App />);
    expect(screen.getByText(/handed_off/)).toBeTruthy();
    expect(fetchTrace).not.toHaveBeenCalled();
  });

  it("traces immediately when the hand-off asks for it", async () => {
    (fetchTrace as any).mockResolvedValue(vectorTrace as unknown as Trace);
    withHash(encodeHandoff(HANDED, true));
    render(<App />);
    await screen.findByRole("button", { name: /^stop$/i });
    expect(fetchTrace).toHaveBeenCalledWith(HANDED, "cpp");
  });

  it("picks up a second hand-off delivered to an already-loaded page", async () => {
    (fetchTrace as any).mockResolvedValue(vectorTrace as unknown as Trace);
    render(<App />);
    withHash(encodeHandoff("int second() { return 2; }", true));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await screen.findByRole("button", { name: /^stop$/i });
    expect(fetchTrace).toHaveBeenCalledWith("int second() { return 2; }", "cpp");
  });

  it("keeps the sample program when there is no hand-off", () => {
    render(<App />);
    expect(screen.getByText(/cpp-tutor/i)).toBeTruthy();
    expect(screen.queryByText(/handed_off/)).toBeNull();
  });
});
