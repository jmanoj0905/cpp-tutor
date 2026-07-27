import { describe, it, expect, beforeEach } from "vitest";
import { load, save, apply, pushRecent, DEFAULTS, STORAGE_KEY, FONT_PX } from "../src/settings/settings";

beforeEach(() => localStorage.clear());

describe("settings load/save", () => {
  it("returns defaults when storage is empty", () => {
    expect(load()).toEqual(DEFAULTS);
  });

  it("merges partial/legacy JSON over defaults", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontSize: "L" }));
    const s = load();
    expect(s.fontSize).toBe("L");
    expect(s.lineNumbers).toBe("relative"); // filled from defaults
    expect(s.showPasteButton).toBe(true);
    expect(s.recent).toEqual([]);
  });

  it("returns defaults on corrupt JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(load()).toEqual(DEFAULTS);
  });

  it("round-trips through save", () => {
    const s = { ...DEFAULTS, fontSize: "S" as const, showPasteButton: false };
    save(s);
    expect(load()).toEqual(s);
  });
});

describe("apply", () => {
  it("sets the font-size CSS var", () => {
    apply({ ...DEFAULTS, fontSize: "L" });
    expect(document.documentElement.style.getPropertyValue("--data-font-size")).toBe(FONT_PX.L);
  });
});

describe("pushRecent", () => {
  it("moves id to front, dedupes, caps at 5", () => {
    let s = DEFAULTS;
    for (const id of ["a", "b", "c", "d", "e", "f"]) s = pushRecent(s, id);
    expect(s.recent).toEqual(["f", "e", "d", "c", "b"]);
    s = pushRecent(s, "d");
    expect(s.recent).toEqual(["d", "f", "e", "c", "b"]);
  });
});
