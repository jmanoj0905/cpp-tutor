import { describe, it, expect, vi } from "vitest";
import { fetchTrace } from "../src/api/client";

describe("fetchTrace", () => {
  it("posts code and returns parsed trace", async () => {
    const fake = { code: "x", trace: [{ line: 1, event: "step_line", func_name: "main", stack_to_render: [], heap: {}, globals: {}, ordered_globals: [], stdout: "" }] };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fake }) as any;
    const res = await fetchTrace("int main(){}", "cpp");
    expect("trace" in res && res.trace.length).toBe(1);
  });
});
