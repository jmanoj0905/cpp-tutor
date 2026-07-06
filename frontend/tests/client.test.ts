import { describe, it, expect, vi } from "vitest";
import { fetchTrace } from "../src/api/client";

describe("fetchTrace", () => {
  it("posts code and returns parsed trace", async () => {
    const fake = { code: "x", trace: [{ line: 1, event: "step_line", func_name: "main", stack_to_render: [], heap: {}, globals: {}, ordered_globals: [], stdout: "" }] };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(fake) }) as any;
    const res = await fetchTrace("int main(){}", "cpp");
    expect("trace" in res && res.trace.length).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith("http://localhost:8000/api/trace", expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "int main(){}", lang: "cpp" }) }));
  });

  it("throws when server returns non-ok status", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as any;
    await expect(fetchTrace("while(1){}", "cpp")).rejects.toThrow(/Program ran too long/);
  });
});

describe("parseTraceJson", () => {
  it("preserves integers beyond Number.MAX_SAFE_INTEGER as strings", async () => {
    const { parseTraceJson } = await import("../src/api/client");
    const text = '{"heap":{"0x1":["C_ARRAY","0x1",["C_DATA","0x1","_Bit_type",18446744073709551615]]},"n":[-9007199254740993]}';
    const out = parseTraceJson(text) as any;
    expect(out.heap["0x1"][2][3]).toBe("18446744073709551615");
    expect(out.n[0]).toBe("-9007199254740993");
  });
  it("leaves safe integers, floats, and digit strings untouched", async () => {
    const { parseTraceJson } = await import("../src/api/client");
    const text = '{"a":9007199254740991,"b":3.5,"c":1234567890123456789.5,"s":"12345678901234567890","line":12}';
    const out = parseTraceJson(text) as any;
    expect(out.a).toBe(9007199254740991);
    expect(out.b).toBe(3.5);
    expect(out.c).toBe(Number("1234567890123456789.5"));
    expect(out.s).toBe("12345678901234567890");
    expect(out.line).toBe(12);
  });
});
