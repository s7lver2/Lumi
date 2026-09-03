"use client";
import { usarRevelado } from "./usarRevelado";

/** Marca el tránsito entre dos secciones de la landing con un trazo que
 *  se dibuja al entrar en viewport (scaleX 0→1, origen centro) — un latido
 *  breve en la costura, en vez de que una sección simplemente termine y la
 *  siguiente empiece sin más. Ninguna sección "sale" de escena: solo la
 *  entrada de la siguiente se marca, igual que el resto del revelado del
 *  sitio (usarRevelado, un solo disparo). */
export function SeparadorSeccion() {
  const { ref, visible } = usarRevelado<HTMLDivElement>("-30% 0px");

  return (
    <div ref={ref} className="mx-auto flex max-w-[1180px] justify-center px-7">
      <span
        className="h-px w-24 bg-border"
        style={{
          transform: visible ? "scaleX(1)" : "scaleX(0)",
          opacity: visible ? 1 : 0,
          transition: "transform .9s cubic-bezier(.16,1,.3,1), opacity .6s cubic-bezier(.16,1,.3,1)",
        }}
      />
    </div>
  );
}
