export type Settings = {
  fontSize: "S" | "M" | "L";
  lineNumbers: "relative" | "absolute";
  showPasteButton: boolean;
  recent: string[];
};

export const STORAGE_KEY = "cpp-tutor:settings";

export const DEFAULTS: Settings = {
  fontSize: "M",
  lineNumbers: "relative",
  showPasteButton: true,
  recent: [],
};

export const FONT_PX: Record<Settings["fontSize"], string> = { S: "11px", M: "12px", L: "14px" };

const RECENT_CAP = 5;

export function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      fontSize: parsed.fontSize ?? DEFAULTS.fontSize,
      lineNumbers: parsed.lineNumbers ?? DEFAULTS.lineNumbers,
      showPasteButton: parsed.showPasteButton ?? DEFAULTS.showPasteButton,
      recent: Array.isArray(parsed.recent) ? parsed.recent.slice(0, RECENT_CAP) : [],
    };
  } catch {
    return DEFAULTS;
  }
}

export function save(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage full / disabled — settings just won't persist */
  }
}

export function apply(s: Settings): void {
  document.documentElement.style.setProperty("--data-font-size", FONT_PX[s.fontSize]);
}

export function pushRecent(s: Settings, id: string): Settings {
  const recent = [id, ...s.recent.filter((x) => x !== id)].slice(0, RECENT_CAP);
  return { ...s, recent };
}
