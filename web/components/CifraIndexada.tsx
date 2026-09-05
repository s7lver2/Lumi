"use client";
import { useEffect, useRef, useState } from "react";
import { usarRevelado } from "./usarRevelado";
import { formatoPorcentaje } from "./Cobertura";

function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3);
}

/** La cifra grande de "Cuánto mundo ya reconoce Lumi" cuenta desde 0 hasta
 *  el porcentaje real en cuanto el bloque entra en viewport — mismo patrón
 *  que `usarConteo`, pero sin redondear a entero: un porcentaje tan pequeño
 *  como 0.001% se perdería del todo si se contara en enteros. Server
 *  component aparte (`Cobertura`) porque el `await` al catálogo no puede
 *  vivir en un "use client". */
export function CifraIndexada({ porcentaje }: { porcentaje: number }) {
  const { ref, visible } = usarRevelado<HTMLSpanElement>();
  const [valor, setValor] = useState(0);
  const arrancadoRef = useRef(false);

  useEffect(() => {
    if (!visible || arrancadoRef.current) return;
    arrancadoRef.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValor(porcentaje);
      return;
    }
    const inicio = performance.now();
    const duracionMs = 900;
    let id: number;
    function paso(ahora: number) {
      const t = Math.min(1, (ahora - inicio) / duracionMs);
      setValor(porcentaje * easeOutCubic(t));
      if (t < 1) id = requestAnimationFrame(paso);
    }
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, porcentaje]);

  return (
    <span ref={ref} className="tabular-nums">
      {formatoPorcentaje(valor)}
    </span>
  );
}
