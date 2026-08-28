// vitest cannot resolve the `vscode` module (the editor injects it at runtime).
// panel.ts's tested exports never touch it, so an empty stub is enough.
export const Uri = { joinPath: () => ({ fsPath: "" }) };
export const ViewColumn = { One: 1 };
export const window = {};
