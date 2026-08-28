import { defineConfig } from "vitest/config";

// The extension's testable logic (service state machine, url/hand-off
// builders, nonce) runs in a plain node environment and never touches the
// editor-injected `vscode` module. The alias below points any stray import at
// a minimal stub so vitest can resolve it.
export default defineConfig({
  test: { environment: "node", globals: true },
  resolve: { alias: { vscode: new URL("./tests/vscodeStub.ts", import.meta.url).pathname } },
});
