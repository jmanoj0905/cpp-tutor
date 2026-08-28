import { defineConfig } from "vitest/config";

// The extension's testable logic (service state machine, HTML builder) never
// imports vscode, so it runs in a plain node environment.
export default defineConfig({
  test: { environment: "node", globals: true },
});
