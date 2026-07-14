// Pure shortcut resolution — no React, no DOM. The single source of truth for
// which key does what; HelpOverlay renders SHORTCUT_TABLE so the cheat sheet
// cannot drift from the real bindings.

export type KeyDescriptor = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  defaultPrevented: boolean;
};

export type ShortcutContext = {
  mode: "edit" | "trace";
  inEditable: boolean;
  helpOpen: boolean;
  loading: boolean;
};

export type Action =
  | "prev" | "next" | "first" | "last"
  | "visualize" | "stop" | "toggleHelp" | "closeHelp" | "toggleTree";

export const SHORTCUT_TABLE: {
  keys: string;
  description: string;
  mode: "edit" | "trace" | "any";
}[] = [
  { keys: "Ctrl/Cmd+Enter", description: "Visualize execution", mode: "edit" },
  { keys: "← / →", description: "Previous / next step", mode: "trace" },
  { keys: "Home / End", description: "First / last step", mode: "trace" },
  { keys: "Esc", description: "Stop trace (or close this help)", mode: "trace" },
  { keys: "T", description: "Toggle Memory / Call Tree panel", mode: "trace" },
  { keys: "?", description: "Toggle this help", mode: "any" },
];

export function resolveShortcut(e: KeyDescriptor, ctx: ShortcutContext): Action | null {
  if (e.defaultPrevented) return null; // CodeMirror (autocomplete, fold…) got there first

  const noMods = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;

  if (e.key === "Escape" && noMods && !e.repeat) {
    if (ctx.helpOpen) return "closeHelp";
    return ctx.mode === "trace" ? "stop" : null;
  }

  // Exactly one of ctrl/meta: accept both conventions everywhere rather than
  // sniffing the platform.
  if (e.key === "Enter" && e.ctrlKey !== e.metaKey && !e.altKey && !e.shiftKey && !e.repeat) {
    return ctx.mode === "edit" && !ctx.loading ? "visualize" : null;
  }

  // Everything below must stay out of the way while the user is typing or
  // focused on an element that consumes arrows (inputs, the editor…).
  if (ctx.inEditable) return null;

  // Shift is whatever produced "?" on this layout; only ctrl/meta/alt disqualify.
  if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
    return "toggleHelp";
  }

  if (ctx.mode !== "trace" || !noMods) return null;

  switch (e.key) {
    case "ArrowLeft": return "prev";
    case "ArrowRight": return "next"; // repeat allowed: hold to scrub
    case "Home": return e.repeat ? null : "first";
    case "End": return e.repeat ? null : "last";
    case "t": return e.repeat ? null : "toggleTree";
    default: return null;
  }
}
