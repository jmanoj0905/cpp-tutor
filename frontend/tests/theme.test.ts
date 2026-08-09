import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// vitest runs with `frontend/` as cwd (see package.json scripts).
const css = readFileSync(resolve("src/index.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Every `--name:` declared in the :root block. */
function declaredVars(source: string): Set<string> {
  const root = source.slice(source.indexOf(":root"), source.indexOf("\n}"));
  return new Set([...root.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

/**
 * Every `var(--name)` referenced with NO fallback. A reference *with* a
 * fallback (`var(--split, 50%)`) is safe by construction and is how the app
 * reads values injected from JS inline styles, so those are not required to
 * exist in :root.
 */
function referencedVars(source: string): string[] {
  return [...source.matchAll(/var\((--[a-z0-9-]+)\s*([,)])/g)]
    .filter((m) => m[2] === ")")
    .map((m) => m[1]);
}

describe("theme variables", () => {
  // A `var(--undefined)` inside a shorthand makes the whole declaration
  // invalid at computed-value time: the property silently falls back to its
  // initial value (border-style: none) instead of erroring. That is how nine
  // rules lost their borders while still *looking* correct in the source.
  it("references no custom property that is not declared in :root", () => {
    const declared = declaredVars(css);
    const undeclared = [...new Set(referencedVars(css))].filter(
      (name) => !declared.has(name),
    );
    expect(undeclared).toEqual([]);
  });

  // `--border-dotted` is a full shorthand ("1px dotted #111"). Pasting more
  // border components after it produces "1px dotted #111 dotted #111", which
  // is malformed and dropped wholesale. Width-only needs are --border-w.
  it("never appends border components after a shorthand token", () => {
    const malformed = [...css.matchAll(/var\(--border-dotted\)\s+\S+/g)].map(
      (m) => m[0],
    );
    expect(malformed).toEqual([]);
  });
});
