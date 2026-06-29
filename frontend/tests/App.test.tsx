import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../src/App";
import vectorTrace from "./fixtures/vector-trace.json";
import { fetchTrace } from "../src/api/client";
import type { Trace } from "../src/types/trace";

vi.mock("../src/api/client", () => ({
  fetchTrace: vi.fn(),
}));

describe("App shell", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts in editing state: Visualize shown, Stop absent", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: /visualize/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^stop$/i })).toBeNull();
  });

  it("shows Stop and hides Visualize after a successful visualize", async () => {
    (fetchTrace as any).mockResolvedValue(vectorTrace as unknown as Trace);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });
    expect(screen.queryByRole("button", { name: /visualize/i })).toBeNull();
  });
});
