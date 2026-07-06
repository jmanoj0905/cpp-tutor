import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("favicon", () => {
  it("uses the PNG favicon asset", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const icon = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');

    expect(icon?.getAttribute("type")).toBe("image/png");
    expect(icon?.getAttribute("href")).toBe("/favicon.png");

    const favicon = readFileSync(resolve(process.cwd(), "public/favicon.png"));
    expect([...favicon.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
