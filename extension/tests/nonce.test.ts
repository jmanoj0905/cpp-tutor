import { describe, it, expect } from "vitest";
import { makeNonce } from "../src/nonce";

describe("makeNonce", () => {
  it("produces a fresh alphanumeric token each call", () => {
    const a = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9]{16,}$/);
    expect(a).not.toBe(makeNonce());
  });
});
