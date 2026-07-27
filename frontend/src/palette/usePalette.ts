import { useCallback, useRef, useState } from "react";

export function usePalette() {
  const [open, setOpen] = useState(false);
  const prevFocus = useRef<HTMLElement | null>(null);

  const restore = () => {
    const el = prevFocus.current;
    if (el && document.contains(el)) el.focus();
    prevFocus.current = null;
  };

  const toggle = useCallback(() => {
    setOpen((was) => {
      if (!was) {
        prevFocus.current = document.activeElement as HTMLElement | null;
        return true;
      }
      restore();
      return false;
    });
  }, []);

  const close = useCallback(() => {
    setOpen((was) => {
      if (was) restore();
      return false;
    });
  }, []);

  return { open, toggle, close };
}
