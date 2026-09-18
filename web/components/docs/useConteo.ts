"use client";
import { useEffect, useRef, useState } from "react";

/** Anima un número hacia su valor real en vez de dejarlo saltar de golpe —
 *  mismo principio que `jg-barra-llena` (globals.css) pero para texto, que
 *  una animación CSS no puede interpolar por sí sola. Reinicia desde el
 *  valor anterior cada vez que `valor` cambia (cambiar de foto, mover un
 *  umbral), así que una cifra que baja también se ve bajar, no solo subir. */
export function useConteo(valor: number, duracionMs = 500) {
  const [mostrado, setMostrado] = useState(valor);
  const desde = useRef(valor);
  const marco = useRef<number>(0);

  useEffect(() => {
    const inicio = desde.current;
    const delta = valor - inicio;
    if (delta === 0) return;
    const t0 = performance.now();
    function paso(ahora: number) {
      const p = Math.min(1, (ahora - t0) / duracionMs);
      // ease-out-expo — mismo perfil que el resto de micro-interacciones del sitio.
      const suavizado = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setMostrado(inicio + delta * suavizado);
      if (p < 1) marco.current = requestAnimationFrame(paso);
      else desde.current = valor;
    }
    marco.current = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(marco.current);
  }, [valor, duracionMs]);

  return mostrado;
}
