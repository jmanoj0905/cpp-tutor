/**
 * The VSCode extension hands the active editor's source to this app through
 * the URL hash (`#code=<base64url>&run=1`). The hash is the only channel that
 * works for every way the extension can open the visualizer -- VSCode's Simple
 * Browser and an external browser alike -- and it never reaches the server.
 *
 * Pure: no DOM, no window. App.tsx passes location.hash in.
 */
export interface Handoff {
  code: string;
  /** Trace immediately on load instead of waiting for a Visualize click. */
  run: boolean;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  // atob rejects an unpadded length-4k+1 string; pad back to a multiple of 4.
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** base64url of the UTF-8 source, so non-ascii comments/literals survive. */
export function encodeHandoff(code: string, run: boolean): string {
  const payload = toBase64Url(new TextEncoder().encode(code));
  return `#code=${payload}${run ? "&run=1" : ""}`;
}

export function readHandoff(hash: string): Handoff | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const payload = params.get("code");
  if (!payload) return null;
  try {
    return { code: new TextDecoder().decode(fromBase64Url(payload)), run: params.get("run") === "1" };
  } catch {
    // A truncated or hand-edited hash is not worth blanking the editor over.
    return null;
  }
}
