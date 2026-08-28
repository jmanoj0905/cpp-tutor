import { describe, it, expect } from "vitest";
import { buildPanelHtml, makeNonce } from "../src/panel";

// Shaped like the real vite output: relative asset paths plus the Google Fonts
// links that frontend/index.html carries.
const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="./favicon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono&display=swap" rel="stylesheet" />
    <title>cpp-tutor</title>
    <script type="module" crossorigin src="./assets/index-abc123.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-def456.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

const build = (port = 51234) =>
  buildPanelHtml({
    indexHtml: INDEX,
    cspSource: "vscode-resource://host",
    toWebviewUri: (p) => `vscode-resource://host/web/${p.replace(/^\.\//, "")}`,
    port,
    nonce: "NONCE123",
  });

describe("buildPanelHtml", () => {
  it("rewrites every relative asset to a webview uri", () => {
    const html = build();
    expect(html).toContain("vscode-resource://host/web/assets/index-abc123.js");
    expect(html).toContain("vscode-resource://host/web/assets/index-def456.css");
    expect(html).toContain("vscode-resource://host/web/favicon.png");
    expect(html).not.toContain('"./assets/');
  });

  it("leaves the remote font links alone", () => {
    expect(build()).toContain("https://fonts.googleapis.com/css2?family=JetBrains+Mono");
  });

  it("injects the api base pointing at the container's loopback port", () => {
    expect(build(55555)).toContain('window.__CPP_TUTOR_API = "http://127.0.0.1:55555"');
  });

  it("puts the nonce on every script tag", () => {
    const html = build();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    for (const tag of scripts) expect(tag).toContain('nonce="NONCE123"');
  });

  it("emits a CSP that locks connect-src to the one port in use", () => {
    const html = build(55555);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src http://127.0.0.1:55555");
    expect(html).not.toContain("connect-src *");
  });

  it("permits the runtime styles CodeMirror injects and the font hosts", () => {
    const html = build();
    expect(html).toMatch(/style-src [^;]*'unsafe-inline'/);
    expect(html).toMatch(/style-src [^;]*https:\/\/fonts\.googleapis\.com/);
    expect(html).toMatch(/font-src [^;]*https:\/\/fonts\.gstatic\.com/);
  });

  it("leaves no reference to the default dev backend", () => {
    expect(build()).not.toContain("localhost:8000");
  });

  it("places the CSP meta tag inside <head>, not after it", () => {
    const html = build();
    const headOpen = html.indexOf("<head>");
    const headClose = html.indexOf("</head>");
    const cspIndex = html.indexOf("Content-Security-Policy");
    expect(headOpen).toBeGreaterThanOrEqual(0);
    expect(headClose).toBeGreaterThan(headOpen);
    expect(cspIndex).toBeGreaterThan(headOpen);
    expect(cspIndex).toBeLessThan(headClose);
  });

  it("injects the api base script before the app bundle script", () => {
    const html = build();
    const apiIndex = html.indexOf("window.__CPP_TUTOR_API");
    const bundleIndex = html.indexOf("assets/index-abc123.js");
    expect(apiIndex).toBeGreaterThanOrEqual(0);
    expect(bundleIndex).toBeGreaterThan(apiIndex);
  });
});

describe("makeNonce", () => {
  it("produces a fresh alphanumeric token each call", () => {
    const a = makeNonce();
    expect(a).toMatch(/^[A-Za-z0-9]{16,}$/);
    expect(a).not.toBe(makeNonce());
  });
});
