import { describe, expect, it } from "vitest";
import {
  resolveShortcut, SHORTCUT_TABLE,
  type KeyDescriptor, type ShortcutContext,
} from "../src/shortcuts/keymap";

const key = (over: Partial<KeyDescriptor>): KeyDescriptor => ({
  key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  repeat: false, defaultPrevented: false, ...over,
});
const ctx = (over: Partial<ShortcutContext> = {}): ShortcutContext => ({
  mode: "trace", inEditable: false, helpOpen: false, loading: false, ...over,
});

describe("stepping keys", () => {
  it("resolves arrows and Home/End in trace mode", () => {
    expect(resolveShortcut(key({ key: "ArrowLeft" }), ctx())).toBe("prev");
    expect(resolveShortcut(key({ key: "ArrowRight" }), ctx())).toBe("next");
    expect(resolveShortcut(key({ key: "Home" }), ctx())).toBe("first");
    expect(resolveShortcut(key({ key: "End" }), ctx())).toBe("last");
  });

  it("does not resolve in edit mode", () => {
    for (const k of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(resolveShortcut(key({ key: k }), ctx({ mode: "edit" }))).toBeNull();
    }
  });

  it("does not resolve when focus is editable", () => {
    for (const k of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(resolveShortcut(key({ key: k }), ctx({ inEditable: true }))).toBeNull();
    }
  });

  it("requires exact modifiers", () => {
    expect(resolveShortcut(key({ key: "ArrowRight", ctrlKey: true }), ctx())).toBeNull();
    expect(resolveShortcut(key({ key: "ArrowRight", metaKey: true }), ctx())).toBeNull();
    expect(resolveShortcut(key({ key: "ArrowRight", altKey: true }), ctx())).toBeNull();
    expect(resolveShortcut(key({ key: "ArrowRight", shiftKey: true }), ctx())).toBeNull();
    expect(resolveShortcut(key({ key: "Home", shiftKey: true }), ctx())).toBeNull();
  });

  it("allows key repeat for prev/next only", () => {
    expect(resolveShortcut(key({ key: "ArrowLeft", repeat: true }), ctx())).toBe("prev");
    expect(resolveShortcut(key({ key: "ArrowRight", repeat: true }), ctx())).toBe("next");
    expect(resolveShortcut(key({ key: "Home", repeat: true }), ctx())).toBeNull();
    expect(resolveShortcut(key({ key: "End", repeat: true }), ctx())).toBeNull();
  });
});

describe("visualize (Ctrl/Cmd+Enter)", () => {
  it("resolves with ctrl or meta in edit mode, even inside the editor", () => {
    expect(resolveShortcut(key({ key: "Enter", ctrlKey: true }), ctx({ mode: "edit" }))).toBe("visualize");
    expect(resolveShortcut(key({ key: "Enter", metaKey: true }), ctx({ mode: "edit" }))).toBe("visualize");
    expect(resolveShortcut(
      key({ key: "Enter", ctrlKey: true }),
      ctx({ mode: "edit", inEditable: true }),
    )).toBe("visualize");
  });

  it("does not resolve: plain Enter, both mods, extra mods, repeat, trace mode, loading", () => {
    expect(resolveShortcut(key({ key: "Enter" }), ctx({ mode: "edit" }))).toBeNull();
    expect(resolveShortcut(key({ key: "Enter", ctrlKey: true, metaKey: true }), ctx({ mode: "edit" }))).toBeNull();
    expect(resolveShortcut(key({ key: "Enter", ctrlKey: true, shiftKey: true }), ctx({ mode: "edit" }))).toBeNull();
    expect(resolveShortcut(key({ key: "Enter", ctrlKey: true, altKey: true }), ctx({ mode: "edit" }))).toBeNull();
    expect(resolveShortcut(key({ key: "Enter", ctrlKey: true, repeat: true }), ctx({ mode: "edit" }))).toBeNull();
    expect(resolveShortcut(key({ key: "Enter", ctrlKey: true }), ctx({ mode: "trace" }))).toBeNull();
    expect(resolveShortcut(key({ key: "Enter", ctrlKey: true }), ctx({ mode: "edit", loading: true }))).toBeNull();
  });
});

describe("Escape", () => {
  it("closes help first, in any mode", () => {
    expect(resolveShortcut(key({ key: "Escape" }), ctx({ helpOpen: true }))).toBe("closeHelp");
    expect(resolveShortcut(key({ key: "Escape" }), ctx({ mode: "edit", helpOpen: true }))).toBe("closeHelp");
  });

  it("stops the trace otherwise, even from editable focus", () => {
    expect(resolveShortcut(key({ key: "Escape" }), ctx())).toBe("stop");
    expect(resolveShortcut(key({ key: "Escape" }), ctx({ inEditable: true }))).toBe("stop");
  });

  it("does not resolve: edit mode without help, modifiers, repeat", () => {
    expect(resolveShortcut(key({ key: "Escape" }), ctx({ mode: "edit" }))).toBeNull();
    expect(resolveShortcut(key({ key: "Escape", ctrlKey: true }), ctx())).toBeNull();
    expect(resolveShortcut(key({ key: "Escape", repeat: true }), ctx())).toBeNull();
  });
});

describe("help toggle (?)", () => {
  it("resolves with or without shift, in both modes", () => {
    expect(resolveShortcut(key({ key: "?", shiftKey: true }), ctx())).toBe("toggleHelp");
    expect(resolveShortcut(key({ key: "?" }), ctx({ mode: "edit" }))).toBe("toggleHelp");
  });

  it("does not resolve when typing, with ctrl/meta/alt, or on repeat", () => {
    expect(resolveShortcut(key({ key: "?", shiftKey: true }), ctx({ inEditable: true }))).toBeNull();
    expect(resolveShortcut(key({ key: "?", ctrlKey: true }), ctx())).toBeNull();
    expect(resolveShortcut(key({ key: "?", metaKey: true }), ctx())).toBeNull();
    expect(resolveShortcut(key({ key: "?", altKey: true }), ctx())).toBeNull();
    expect(resolveShortcut(key({ key: "?", shiftKey: true, repeat: true }), ctx())).toBeNull();
  });
});

describe("global guards", () => {
  it("never resolves an event something else already handled", () => {
    expect(resolveShortcut(key({ key: "ArrowRight", defaultPrevented: true }), ctx())).toBeNull();
    expect(resolveShortcut(key({ key: "Escape", defaultPrevented: true }), ctx())).toBeNull();
    expect(resolveShortcut(
      key({ key: "Enter", ctrlKey: true, defaultPrevented: true }),
      ctx({ mode: "edit" }),
    )).toBeNull();
  });

  it("ignores unbound keys", () => {
    expect(resolveShortcut(key({ key: "a" }), ctx())).toBeNull();
    expect(resolveShortcut(key({ key: "ArrowUp" }), ctx())).toBeNull();
  });
});

describe("toggleTree shortcut", () => {
  it("t in trace mode toggles the tree tab", () => {
    expect(resolveShortcut(key({ key: "t" }), ctx())).toBe("toggleTree");
  });

  it("t is inert in edit mode, in editables, and with modifiers", () => {
    expect(resolveShortcut(key({ key: "t" }), ctx({ mode: "edit" }))).toBeNull();
    expect(resolveShortcut(key({ key: "t" }), ctx({ inEditable: true }))).toBeNull();
    expect(resolveShortcut(key({ key: "t", ctrlKey: true }), ctx())).toBeNull();
  });

  it("t does not repeat on hold", () => {
    expect(resolveShortcut(key({ key: "t", repeat: true }), ctx())).toBeNull();
  });

  it("appears in the shortcut table", () => {
    expect(SHORTCUT_TABLE.some((r) => r.keys === "T")).toBe(true);
  });
});

describe("SHORTCUT_TABLE", () => {
  it("documents every binding", () => {
    const keys = SHORTCUT_TABLE.map((r) => r.keys);
    expect(keys).toContain("Ctrl/Cmd+Enter");
    expect(keys).toContain("← / →");
    expect(keys).toContain("Home / End");
    expect(keys).toContain("Esc");
    expect(keys).toContain("?");
  });
});
