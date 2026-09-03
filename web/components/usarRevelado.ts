"use client";
import { useEffect, useRef, useState } from "react";

/** Revelado de entrada al hacer scroll: dispara una vez, cuando el
 *  elemento entra en viewport, y no vuelve a ocultarse. Más ligero que
 *  `usarEscenaViva` — no hay bucle rAF que detener, así que no necesita
 *  mirar `prefers-reduced-motion` a mano: el bloque CSS global ya reduce
 *  la animación de entrada a duración casi nula en ese caso. */
export function usarRevelado<T extends HTMLElement>(margen = "-10% 0px") {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: margen },
    );
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, visible };
}
