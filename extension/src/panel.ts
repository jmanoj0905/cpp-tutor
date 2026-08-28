import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

const NONCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// Backed by node:crypto rather than Math.random(): a CSP nonce that an
// attacker could predict defeats the point of the CSP, so the token needs a
// cryptographically secure source of randomness.
export function makeNonce(): string {
  const bytes = randomBytes(24);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += NONCE_ALPHABET[bytes[i] % NONCE_ALPHABET.length];
  return out;
}

/**
 * Turns the vite build's index.html into webview-legal HTML: local assets are
 * rewritten to vscode-webview:// uris, a CSP is inserted, and the container's
 * loopback port is injected as a global for frontend/src/api/client.ts to read.
 * Pure so it can be tested without a VSCode host.
 */
export function buildPanelHtml(opts: {
  indexHtml: string;
  cspSource: string;
  toWebviewUri: (assetPath: string) => string;
  port: number;
  nonce: string;
}): string {
  const { indexHtml, cspSource, toWebviewUri, port, nonce } = opts;

  // Only ./-prefixed paths are ours; https:// font links must survive.
  let html = indexHtml.replace(
    /(src|href)="(\.\/[^"]+)"/g,
    (_m, attr: string, path: string) => `${attr}="${toWebviewUri(path)}"`,
  );

  // Post-condition: if a future vite upgrade emits root-relative paths
  // (`="/assets/...`) or single-quoted attributes, the regex above would
  // silently pass them through untouched and they would 404 inside the
  // webview. Fail loudly instead of shipping a panel with dead assets.
  if (/="\.\//.test(html) || /="\/assets/.test(html)) {
    throw new Error("panel html: unrewritten local asset path survived the rewrite pass");
  }

  html = html.replace(/<script\b/g, `<script nonce="${nonce}"`);

  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    `img-src ${cspSource} data:`,
    `style-src ${cspSource} 'unsafe-inline' https://fonts.googleapis.com`,
    // Deliberately nonce-only, not `${cspSource}`-backed: a nonce-only
    // script-src is a stronger policy than a host-based one. The frontend
    // does not currently code-split, so there's no <link rel="modulepreload">
    // to worry about; if it ever does, those preload links are NOT covered
    // by a nonce and this policy would need to change alongside that.
    `script-src 'nonce-${nonce}'`,
    `font-src ${cspSource} https://fonts.gstatic.com`,
    `connect-src http://127.0.0.1:${port}`,
  ].join("; ");

  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${csp};">`,
    `<script nonce="${nonce}">window.__CPP_TUTOR_API = "http://127.0.0.1:${port}";</script>`,
  ].join("\n    ");

  const withHead = html.replace("<head>", `<head>\n    ${head}`);
  if (withHead === html) {
    throw new Error("panel html: no <head> found to insert the CSP into");
  }
  return withHead;
}

/** The single visualizer editor tab. */
export class VisualizerPanel {
  private static current?: vscode.WebviewPanel;

  static show(extensionUri: vscode.Uri, port: number): void {
    if (VisualizerPanel.current) {
      VisualizerPanel.current.reveal(vscode.ViewColumn.One);
      return;
    }
    const webRoot = vscode.Uri.joinPath(extensionUri, "web");

    // Read the build output before creating any panel. If it's missing (the
    // untouched dev tree, or a broken sideload), we want a clear error and no
    // UI at all -- not an empty orphan tab that createWebviewPanel would have
    // already put on screen, with no dispose handler registered to close it.
    let indexHtml: string;
    try {
      indexHtml = fs.readFileSync(vscode.Uri.joinPath(webRoot, "index.html").fsPath, "utf8");
    } catch {
      throw new Error(
        "cpp-tutor: the webview build is missing (extension/web). Reinstall the extension.",
      );
    }

    const panel = vscode.window.createWebviewPanel(
      "cppTutor.visualizer",
      "cpp-tutor",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        // The trace, the step index, and every panel selection live in React
        // state; rebuilding them on a tab switch would lose the user's place.
        retainContextWhenHidden: true,
        localResourceRoots: [webRoot],
      },
    );

    panel.webview.html = buildPanelHtml({
      indexHtml,
      cspSource: panel.webview.cspSource,
      toWebviewUri: (p) =>
        panel.webview.asWebviewUri(vscode.Uri.joinPath(webRoot, p.replace(/^\.\//, ""))).toString(),
      port,
      nonce: makeNonce(),
    });

    panel.onDidDispose(() => { VisualizerPanel.current = undefined; });
    VisualizerPanel.current = panel;
  }

  static disposeCurrent(): void {
    VisualizerPanel.current?.dispose();
    VisualizerPanel.current = undefined;
  }
}
