import { describe, it, expect } from "vitest";
import { encodeHandoff, readHandoff } from "../src/handoff";

describe("handoff", () => {
  it("round-trips code through the hash", () => {
    const code = "int main() { return 0; }\n";
    expect(readHandoff(encodeHandoff(code, false))).toEqual({ code, run: false });
  });

  it("carries the auto-run flag", () => {
    expect(readHandoff(encodeHandoff("x", true))?.run).toBe(true);
  });

  it("survives non-ascii source (comments, string literals)", () => {
    const code = '// αβγ — naïve\nchar s[] = "héllo 🌍";';
    expect(readHandoff(encodeHandoff(code, true))?.code).toBe(code);
  });

  it("emits url-safe base64 so the hash needs no extra escaping", () => {
    // ">>>???" base64s to characters that plain base64 spells with + and /.
    const hash = encodeHandoff(">>>???".repeat(8), false);
    expect(hash.replace("#code=", "")).not.toMatch(/[+/=]/);
  });

  it("accepts a hash with or without the leading #", () => {
    const hash = encodeHandoff("int x;", false);
    expect(readHandoff(hash.slice(1))?.code).toBe("int x;");
  });

  it("returns null when there is no handoff in the hash", () => {
    expect(readHandoff("")).toBeNull();
    expect(readHandoff("#")).toBeNull();
    expect(readHandoff("#step=4")).toBeNull();
  });

  it("returns null rather than throwing on a corrupt payload", () => {
    expect(readHandoff("#code=!!!not-base64!!!")).toBeNull();
  });
});
