import { describe, it, expect, vi } from "vitest";
import { fetchTrace } from "../src/api/client";

describe("fetchTrace", () => {
  it("posts code and returns parsed trace", async () => {
    const fake = { code: "x", trace: [{ line: 1, event: "step_line", func_name: "main", stack_to_render: [], heap: {}, globals: {}, ordered_globals: [], stdout: "" }] };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fake }) as any;
    const res = await fetchTrace("int main(){}", "cpp");
    expect("trace" in res && res.trace.length).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith("http://localhost:8000/api/trace", expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "int main(){}", lang: "cpp" }) }));
  });

  it("throws when server returns non-ok status", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as any;
    await expect(fetchTrace("while(1){}", "cpp")).rejects.toThrow(/Program ran too long/);
  });
});
