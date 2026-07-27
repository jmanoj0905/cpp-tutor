import type { Settings } from "../settings/settings";

// Subsequence fuzzy match. Returns null when `query` chars do not all appear
// in order within `text`; otherwise a score where higher is better: longest
// contiguous run dominates, then an earlier first-match, then shorter text.
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q === "") return 0;

  let ti = 0;
  let firstIndex = -1;
  let contiguous = 0;
  let bestContiguous = 0;
  let prev = -2;

  for (const c of q) {
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] === c) { found = j; break; }
    }
    if (found === -1) return null;
    if (firstIndex === -1) firstIndex = found;
    contiguous = found === prev + 1 ? contiguous + 1 : 1;
    if (contiguous > bestContiguous) bestContiguous = contiguous;
    prev = found;
    ti = found + 1;
  }

  return bestContiguous * 1000 - firstIndex * 10 - t.length;
}

export type CommandCtx = { mode: "edit" | "trace" };

export type PaletteHandlers = Partial<{
  visualize: () => void;
  stop: () => void;
  prev: () => void;
  next: () => void;
  first: () => void;
  last: () => void;
  toggleTree: () => void;
  clearBreakpoints: () => void;
  goto: (n: number) => void;
  pasteOverEditor: () => void;
  toggleHelp: () => void;
  setFontSize: (v: Settings["fontSize"]) => void;
  setLineNumbers: (v: Settings["lineNumbers"]) => void;
  setShowPasteButton: (v: boolean) => void;
}>;

export type Command = {
  id: string;
  title: string;
  hint?: string;
  keywords?: string;
  group: "Navigation" | "Actions" | "View" | "Settings" | "Help";
  when?: (ctx: CommandCtx) => boolean;
  run: () => void;
};

const noop = () => {};

export function filterByContext(cmds: Command[], ctx: CommandCtx): Command[] {
  return cmds.filter((c) => !c.when || c.when(ctx));
}

export function rank(cmds: Command[], query: string): Command[] {
  return cmds
    .map((c, i) => ({ c, i, score: fuzzyScore(query, `${c.title} ${c.keywords ?? ""}`) }))
    .filter((r): r is { c: Command; i: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.c);
}

export function emptyOrder(cmds: Command[], recent: string[]): Command[] {
  const byId = new Map(cmds.map((c) => [c.id, c]));
  const recentCmds = recent.map((id) => byId.get(id)).filter((c): c is Command => !!c);
  const recentIds = new Set(recentCmds.map((c) => c.id));
  return [...recentCmds, ...cmds.filter((c) => !recentIds.has(c.id))];
}

const check = (active: boolean) => (active ? "✓" : undefined);

export function buildCommands(
  ctx: CommandCtx,
  h: PaletteHandlers,
  s: Settings,
  query: string,
): Command[] {
  const inEdit = (c: CommandCtx) => c.mode === "edit";
  const inTrace = (c: CommandCtx) => c.mode === "trace";

  const all: Command[] = [
    // Actions
    { id: "visualize", title: "Visualize execution", hint: "Ctrl+↵", group: "Actions", when: inEdit, run: h.visualize ?? noop },
    { id: "stop", title: "Stop trace", hint: "Esc", group: "Actions", when: inTrace, run: h.stop ?? noop },
    { id: "clear-bp", title: "Clear all breakpoints", keywords: "remove", group: "Actions", when: inTrace, run: h.clearBreakpoints ?? noop },
    { id: "paste", title: "Paste over editor", keywords: "clipboard replace", group: "Actions", when: inEdit, run: h.pasteOverEditor ?? noop },
    // Navigation
    { id: "next", title: "Next step", hint: "→", group: "Navigation", when: inTrace, run: h.next ?? noop },
    { id: "prev", title: "Previous step", hint: "←", group: "Navigation", when: inTrace, run: h.prev ?? noop },
    { id: "first", title: "First step", hint: "Home", group: "Navigation", when: inTrace, run: h.first ?? noop },
    { id: "last", title: "Last step", hint: "End", group: "Navigation", when: inTrace, run: h.last ?? noop },
    // View
    { id: "toggle-tree", title: "Toggle Memory / Call Tree", keywords: "graph calltree", hint: "T", group: "View", when: inTrace, run: h.toggleTree ?? noop },
    // Settings — font
    { id: "font-S", title: "Font size: Small", keywords: "text", hint: check(s.fontSize === "S"), group: "Settings", run: () => h.setFontSize?.("S") },
    { id: "font-M", title: "Font size: Medium", keywords: "text", hint: check(s.fontSize === "M"), group: "Settings", run: () => h.setFontSize?.("M") },
    { id: "font-L", title: "Font size: Large", keywords: "text", hint: check(s.fontSize === "L"), group: "Settings", run: () => h.setFontSize?.("L") },
    // Settings — line numbers
    { id: "ln-rel", title: "Line numbers: Relative", keywords: "gutter vim", hint: check(s.lineNumbers === "relative"), group: "Settings", run: () => h.setLineNumbers?.("relative") },
    { id: "ln-abs", title: "Line numbers: Absolute", keywords: "gutter", hint: check(s.lineNumbers === "absolute"), group: "Settings", run: () => h.setLineNumbers?.("absolute") },
    // Settings — paste button
    { id: "pb-show", title: "Paste button: Shown", keywords: "clipboard toolbar", hint: check(s.showPasteButton), group: "Settings", run: () => h.setShowPasteButton?.(true) },
    { id: "pb-hide", title: "Paste button: Hidden", keywords: "clipboard toolbar", hint: check(!s.showPasteButton), group: "Settings", run: () => h.setShowPasteButton?.(false) },
    // Help
    { id: "help", title: "Toggle keyboard help", keywords: "shortcuts", hint: "?", group: "Help", run: h.toggleHelp ?? noop },
  ];

  const available = filterByContext(all, ctx);

  // Dynamic: jump-to-step from a numeric query (bare "5" or "step 5"), trace only.
  const m = query.trim().match(/^(?:step\s+)?(\d+)$/i);
  if (m && ctx.mode === "trace") {
    const n = Number(m[1]);
    available.unshift({
      id: "jump-step",
      title: `Jump to step ${n}`,
      group: "Navigation",
      run: () => h.goto?.(n),
    });
  }

  return available;
}
