// apps/web/lib/useDismissable.ts
"use client";
import { useEffect, useState } from "react";

/** Keeps a popup/toast mounted for `exitMs` after `isOpen` flips to false so
 * it can play a closing animation instead of vanishing instantly — plain
 * `{isOpen && <Popup/>}` conditional rendering has no way to animate an
 * unmount since React removes the DOM node the same tick the condition
 * flips. Callers render unconditionally and use `rendered`/`closing` to
 * pick which keyframe to apply. */
export function useDismissable(isOpen: boolean, exitMs: number): { rendered: boolean; closing: boolean } {
  const [rendered, setRendered] = useState(isOpen);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRendered(true);
      setClosing(false);
      return;
    }
    setClosing(true);
    const timeout = setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, exitMs);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return { rendered, closing };
}
