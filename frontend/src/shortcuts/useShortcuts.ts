import { useEffect, useRef } from "react";
import { resolveShortcut, type Action, type ShortcutContext } from "./keymap";

export type ShortcutHandlers = Partial<Record<Action, () => void>>;

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// jsdom has no isContentEditable, so match the attribute instead.
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (EDITABLE_TAGS.has(target.tagName)) return true;
  return target.closest("[contenteditable], .cm-editor") !== null;
}

// One window keydown listener for the app. Bubble phase, so CodeMirror keymaps
// run first and their preventDefault() makes resolveShortcut bail.
export function useShortcuts(
  ctx: Omit<ShortcutContext, "inEditable">,
  handlers: ShortcutHandlers,
) {
  const latest = useRef({ ctx, handlers });
  latest.current = { ctx, handlers };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { ctx, handlers } = latest.current;
      const action = resolveShortcut(event, {
        ...ctx,
        inEditable: isEditableTarget(event.target),
      });
      if (!action) return;
      const handler = handlers[action];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
