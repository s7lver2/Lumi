"use client";
import { usarRevelado } from "../usarRevelado";

/** Contenedor común de los cinco esquemas del núcleo. Se revela al entrar
 *  en pantalla con el mismo lenguaje que el resto del sitio (jg-reveal-up,
 *  ver ArquitecturaMini) — antes aparecían ya puestos, sin ninguna entrada,
 *  el único bloque de /docs que no respiraba nada al hacer scroll. */
export function Esquema({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  const { ref, visible } = usarRevelado<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="mt-7 rounded-card border border-border bg-panel px-5 pb-[18px] pt-[22px]"
      style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both" } : { opacity: 0 }}
    >
      <div className="font-mono text-[9.5px] uppercase tracking-[.12em] text-subtle">{etiqueta}</div>
      <div className="mt-[18px]">{children}</div>
    </div>
  );
}
