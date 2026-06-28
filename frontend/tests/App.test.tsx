import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../src/App";

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
});
