"use client";
import { useEffect, useState, type RefObject } from "react";

/** `viva` = la sección está en pantalla y toca animar. `reducido` = el usuario
 *  pidió menos movimiento, así que la escena debe quedarse en un fotograma
 *  legible en vez de correr su bucle. Ojo: el bloque CSS de
 *  prefers-reduced-motion NO detiene un bucle de requestAnimationFrame — hay
 *  que mirarlo aquí a mano (mismo fallo que el bug #98 del cliente). */
export function usarEscenaViva(ref: RefObject<HTMLElement | null>) {
  const [viva, setViva] = useState(false);
  const [reducido, setReducido] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sinc = () => setReducido(mq.matches);
    sinc();
    mq.addEventListener("change", sinc);
    return () => mq.removeEventListener("change", sinc);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => setViva(e.isIntersecting),
      { rootMargin: "10% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);

  return { viva, reducido };
}
