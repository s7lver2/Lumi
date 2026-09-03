"use client";

import { useEffect, useRef, useState } from "react";

const SECCIONES = [
  { id: "hero", etiqueta: "inicio" },
  { id: "interfaz", etiqueta: "interfaz" },
  { id: "modelos", etiqueta: "modelos" },
  { id: "agentes", etiqueta: "agentes" },
  { id: "cobertura", etiqueta: "cobertura" },
];

/** Indicador vertical de sección: una fila de puntos fija a la derecha que
 *  marca en qué tramo de la landing estás. Solo aparece mientras se hace
 *  scroll activamente — se oculta a los 1.4s de inactividad, o de entrada
 *  si estás arriba o abajo del todo, para no quedar de adorno permanente. */
export function IndicadorSecciones() {
  const [activo, setActivo] = useState(0);
  const [visible, setVisible] = useState(false);
  const ocultarRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const nodos = SECCIONES
      .map((s) => document.getElementById(s.id))
      .filter((n): n is HTMLElement => n !== null);
    if (nodos.length === 0) return;

    function medir() {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      const enExtremo = total <= 40 || y < 32 || y > total - 32;

      const centro = y + window.innerHeight * 0.4;
      let idx = 0;
      nodos.forEach((n, i) => {
        if (n.offsetTop <= centro) idx = i;
      });
      setActivo(idx);

      if (enExtremo) {
        setVisible(false);
        return;
      }
      setVisible(true);
      if (ocultarRef.current) clearTimeout(ocultarRef.current);
      ocultarRef.current = setTimeout(() => setVisible(false), 1400);
    }
    medir();
    window.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
      if (ocultarRef.current) clearTimeout(ocultarRef.current);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-center gap-3 transition-opacity duration-500 md:flex"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {SECCIONES.map((s, i) => (
        <a key={s.id} href={`#${s.id}`} title={s.etiqueta} className="jg-micro pointer-events-auto block p-1">
          <span
            className={
              i === activo
                ? "block h-[7px] w-[7px] rounded-full bg-fg transition-all duration-300"
                : "block h-[5px] w-[5px] rounded-full bg-subtle/45 transition-all duration-300"
            }
          />
        </a>
      ))}
    </div>
  );
}
