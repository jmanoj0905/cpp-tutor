import { defineConfig } from "vitest/config";

// The extension's testable logic (service state machine, HTML builder) runs
// in a plain node environment. panel.ts itself imports vscode for its thin
// VisualizerPanel glue, but the exports under test (buildPanelHtml,
// makeNonce) never touch it -- so the alias below points that import at a
// minimal stub instead of pulling in the real editor-injected module.
export default defineConfig({
  test: { environment: "node", globals: true },
  resolve: { alias: { vscode: new URL("./tests/vscodeStub.ts", import.meta.url).pathname } },
});
