// frontend/src/palette/CommandPalette.tsx
import { useMemo, useState } from "react";
import {
  buildCommands, rank, emptyOrder,
  type Command, type CommandCtx, type PaletteHandlers,
} from "./commands";
import type { Settings } from "../settings/settings";

const GROUP_ORDER: Command["group"][] = ["Navigation", "Actions", "View", "Settings", "Help"];

export function CommandPalette({
  ctx, handlers, settings, onRun, onClose,
}: {
  ctx: CommandCtx;
  handlers: PaletteHandlers;
  settings: Settings;
  onRun: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);

  // Full context-filtered registry (incl. dynamic jump-to-step) for this query.
  const all = useMemo(
    () => buildCommands(ctx, handlers, settings, query),
    [ctx, handlers, settings, query],
  );

  const searching = query.trim() !== "";
  // Flat visible list drives keyboard selection in both modes.
  const flat = useMemo(
    () => (searching ? rank(all, query) : emptyOrder(all, settings.recent)),
    [all, query, searching, settings.recent],
  );

  const clampSel = (i: number) => (flat.length === 0 ? 0 : (i + flat.length) % flat.length);

  const run = (c: Command) => {
    c.run();
    onRun(c.id);
  };

  const onQuery = (v: string) => { setQuery(v); setSel(0); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => clampSel(i + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => clampSel(i - 1)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const c = flat[sel];
      if (c) run(c);
      return;
    }
  };

  const row = (c: Command) => {
    const idx = flat.indexOf(c);
    return (
      <li
        key={c.id}
        role="option"
        aria-selected={idx === sel}
        className={"cmdk-row" + (idx === sel ? " cmdk-row-sel" : "")}
        onMouseEnter={() => setSel(idx)}
        onMouseDown={(e) => { e.preventDefault(); run(c); }}
      >
        <span className="cmdk-title">{c.title}</span>
        {c.hint && <span className="cmdk-hint">{c.hint}</span>}
      </li>
    );
  };

  return (
    <div className="cmdk-backdrop" onMouseDown={onClose}>
      <div className="cmdk-panel" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="cmdk-input"
          autoFocus
          value={query}
          placeholder="Type a command, or a step number…"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-activedescendant=""
        />
        <ul className="cmdk-list" role="listbox">
          {searching
            ? flat.map(row)
            : GROUP_ORDER.flatMap((g) => {
                const items = flat.filter((c) => c.group === g);
                if (items.length === 0) return [];
                return [
                  <li key={`h-${g}`} className="cmdk-group" aria-hidden="true">{g}</li>,
                  ...items.map(row),
                ];
              })}
          {flat.length === 0 && <li className="cmdk-empty">No matching commands</li>}
        </ul>
      </div>
    </div>
  );
}
