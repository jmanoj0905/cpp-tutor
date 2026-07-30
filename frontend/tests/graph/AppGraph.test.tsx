import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../../src/App";
import dfsList from "../fixtures/graph/dfs_list.json";
import vectorTrace from "../fixtures/vector-trace.json";
import { fetchTrace } from "../../src/api/client";
import type { Trace } from "../../src/types/trace";

// Approach (B) from the task-12 brief: mirror tests/App.test.tsx and drive the
// whole app through its public UI (mock fetchTrace, click Visualize, then move
// the real VCR step slider) rather than exporting Workspace and hand-assembling
// its ~10 required props. Workspace has more required props than the plan's
// literal example test passes, and reaching a "graph built" step requires
// driving player state anyway -- so going through the actual App + Vcr slider
// is both simpler and less brittle than a partial Workspace render.

vi.mock("../../src/api/client", () => ({
  fetchTrace: vi.fn(),
}));

describe("App graph tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers a Graph tab for a graph program and renders the panel when opened", async () => {
    (fetchTrace as any).mockResolvedValue(dfsList as unknown as Trace);
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });

    // Graph is a peer tab next to Memory / Call Tree, not a stacked region.
    const graphTab = screen.getByRole("tab", { name: /^graph$/i });
    // Panel is not mounted while another tab is active.
    expect(container.querySelector(".graph-panel")).toBeNull();

    fireEvent.click(graphTab);
    // Step to a point where the dfs_list graph is actually built, then the
    // panel is present.
    const slider = screen.getByLabelText("Execution step");
    const total = (dfsList as any).trace.length;
    let found = false;
    for (let s = 0; s < total; s++) {
      fireEvent.change(slider, { target: { value: String(s) } });
      if (container.querySelector(".graph-panel")) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("offers no Graph tab for a non-graph trace", async () => {
    (fetchTrace as any).mockResolvedValue(vectorTrace as unknown as Trace);
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /visualize/i }));
    await screen.findByRole("button", { name: /^stop$/i });

    expect(screen.queryByRole("tab", { name: /^graph$/i })).toBeNull();

    const slider = screen.getByLabelText("Execution step");
    const total = (vectorTrace as any).trace.length;
    for (let s = 0; s < total; s++) {
      fireEvent.change(slider, { target: { value: String(s) } });
      expect(container.querySelector(".graph-panel")).toBeNull();
    }
  });
});
