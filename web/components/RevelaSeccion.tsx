"use client";
import type { ReactNode } from "react";
import { usarRevelado } from "./usarRevelado";

/** Envoltorio cliente para revelar al hacer scroll el contenido de una
 *  sección que en sí es un server component (p.ej. `Cobertura`, que hace
 *  `await` a un catálogo remoto y no puede llevar "use client"). Un solo
 *  bloque, sin stagger por hijo — la sección solo tiene un mapa y dos
 *  párrafos, no una rejilla de tarjetas. */
export function RevelaSeccion({ children }: { children: ReactNode }) {
  const { ref, visible } = usarRevelado<HTMLDivElement>();
  return (
    <div ref={ref} style={visible ? { animation: "jg-reveal-up .8s cubic-bezier(.16,1,.3,1) both" } : { opacity: 0 }}>
      {children}
    </div>
  );
}
