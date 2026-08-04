import { useEffect, useState } from "react";

/** Mantiene un popup montado `exitMs` después de que `open` pase a falso, para
 *  que pueda reproducir su animación de salida. Un `{open && <Popup/>}` a secas
 *  no puede animar el desmontaje: React quita el nodo en el mismo tick en que
 *  cambia la condición. El llamante renderiza siempre y usa `rendered` para
 *  decidir si hay nodo y `closing` para elegir el keyframe.
 *
 *  Portado tal cual de la v1 (`lib/useDismissable.ts`). */
export function useDismissable(open: boolean, exitMs: number): { rendered: boolean; closing: boolean } {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    setClosing(true);
    const t = setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, exitMs);
    return () => clearTimeout(t);
  }, [open, exitMs]);

  return { rendered, closing };
}
