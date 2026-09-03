"use client";
import { useEffect, useRef, useState } from "react";

function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3);
}

/** Anima un número entero de 0 hasta `objetivo` en cuanto `activo` pasa a
 *  true — no falsea el dato, solo hace visible su llegada. Corre una sola
 *  vez por instancia (no se reinicia si `activo` parpadea) y bajo
 *  prefers-reduced-motion salta directo al valor final, sin frames. */
export function usarConteo(objetivo: number, activo: boolean, duracionMs = 700) {
  const [valor, setValor] = useState(0);
  const arrancadoRef = useRef(false);

  useEffect(() => {
    if (!activo || arrancadoRef.current) return;
    arrancadoRef.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValor(objetivo);
      return;
    }
    const inicio = performance.now();
    let id: number;
    function paso(ahora: number) {
      const t = Math.min(1, (ahora - inicio) / duracionMs);
      setValor(Math.round(objetivo * easeOutCubic(t)));
      if (t < 1) id = requestAnimationFrame(paso);
    }
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, objetivo]);

  return valor;
}
