import { describe, it, expect } from "vitest";
import { visualizerUrl, sourceFrom, MAX_HANDOFF_CHARS } from "../src/handoff";

describe("visualizerUrl", () => {
  it("points at the container's loopback port", () => {
    expect(visualizerUrl(51234)).toBe("http://127.0.0.1:51234/");
  });

  it("puts the source in the hash, never the query", () => {
    const url = visualizerUrl(8000, { code: "int main(){}", run: true });
    expect(url.startsWith("http://127.0.0.1:8000/#code=")).toBe(true);
    expect(url).not.toContain("?");
  });

  it("marks an auto-trace hand-off and leaves a plain one unmarked", () => {
    expect(visualizerUrl(8000, { code: "x", run: true })).toContain("&run=1");
    expect(visualizerUrl(8000, { code: "x", run: false })).not.toContain("run=1");
  });

  it("encodes url-safe base64 the frontend can decode", () => {
    const code = '// αβγ\nchar s[] = "héllo 🌍";';
    const hash = visualizerUrl(8000, { code, run: false }).split("#")[1];
    const payload = new URLSearchParams(hash).get("code")!;
    expect(payload).not.toMatch(/[+/=]/);
    expect(Buffer.from(payload, "base64url").toString("utf8")).toBe(code);
  });

  it("refuses a file too big to survive a url", () => {
    expect(() => visualizerUrl(8000, { code: "x".repeat(MAX_HANDOFF_CHARS * 2), run: false }))
      .toThrow(/too large/i);
  });
});

describe("sourceFrom", () => {
  const doc = (languageId: string, fileName: string) => ({
    languageId, fileName, getText: () => "int main(){}",
  });

  it("rejects having no editor open", () => {
    expect(sourceFrom(undefined)).toEqual({ ok: false, message: expect.stringMatching(/open a c/i) });
  });

  it("takes c and c++ documents by language id", () => {
    for (const id of ["c", "cpp"]) {
      expect(sourceFrom(doc(id, "/tmp/a.cpp"))).toEqual({ ok: true, code: "int main(){}" });
    }
  });

  it("falls back to the extension when the language id is unset", () => {
    for (const f of ["/tmp/a.cc", "/tmp/a.hpp", "/tmp/a.C", "/tmp/a.cxx", "/tmp/a.h", "/tmp/a.c"]) {
      expect(sourceFrom(doc("plaintext", f)).ok).toBe(true);
    }
  });

  it("rejects a document that is neither", () => {
    const r = sourceFrom(doc("python", "/tmp/a.py"));
    expect(r.ok).toBe(false);
  });

  it("rejects an empty document rather than tracing nothing", () => {
    expect(sourceFrom({ languageId: "cpp", fileName: "/a.cpp", getText: () => "  \n" }).ok).toBe(false);
  });
});
