/**
 * Builds the URL the visualizer is opened at, optionally carrying the active
 * editor's source. The hand-off rides in the URL hash (`#code=<base64url>`),
 * decoded by frontend/src/handoff.ts: the hash is the one channel that works
 * for both open targets -- VSCode's Simple Browser and an external browser --
 * and it never leaves the machine (a fragment is not sent to the server).
 *
 * Pure, so it is testable without a VSCode host; nothing here imports vscode.
 */

/**
 * Encoded-payload ceiling. Browsers cap URL length (Safari is the tightest of
 * the mainstream ones); a source file big enough to hit this is not something
 * the tracer would finish anyway, so fail with a clear message rather than
 * silently opening a truncated program.
 */
export const MAX_HANDOFF_CHARS = 32_000;

export interface Handoff {
  code: string;
  /** Trace on load instead of waiting for a Visualize click. */
  run: boolean;
}

export function visualizerUrl(port: number, handoff?: Handoff): string {
  const base = `http://127.0.0.1:${port}/`;
  if (!handoff) return base;

  const payload = Buffer.from(handoff.code, "utf8").toString("base64url");
  if (payload.length > MAX_HANDOFF_CHARS) {
    throw new Error(
      "cpp-tutor: this file is too large to hand off to the visualizer — " +
        "paste a smaller excerpt into the visualizer's editor instead.",
    );
  }
  return `${base}#code=${payload}${handoff.run ? "&run=1" : ""}`;
}

/** The subset of vscode.TextDocument this module needs. */
export interface DocumentLike {
  languageId: string;
  fileName: string;
  getText(): string;
}

export type SourceResult = { ok: true; code: string } | { ok: false; message: string };

const C_LIKE_IDS = new Set(["c", "cpp", "cuda-cpp", "objective-cpp"]);
const C_LIKE_EXTS = /\.(c|cc|cp|cpp|cxx|c\+\+|h|hh|hpp|hxx|ipp|inl|C|H)$/;

/**
 * The active editor is only a hand-off candidate if it actually holds C/C++
 * source. The language id is checked first; the extension is the fallback for
 * files VSCode has not associated (a `.cc` opened as plaintext).
 */
export function sourceFrom(doc: DocumentLike | undefined): SourceResult {
  if (!doc) {
    return { ok: false, message: "Open a C or C++ file to visualize it." };
  }
  if (!C_LIKE_IDS.has(doc.languageId) && !C_LIKE_EXTS.test(doc.fileName)) {
    return { ok: false, message: "The active file is not C or C++." };
  }
  const code = doc.getText();
  if (!code.trim()) {
    return { ok: false, message: "The active file is empty." };
  }
  return { ok: true, code };
}
