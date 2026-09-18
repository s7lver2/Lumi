"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Esquema } from "../Esquema";
import { useConteo } from "../useConteo";

type Hipotesis = { id: string; lugar: string; base: number; contradiceAgente: boolean };

// Turín parte POR DELANTE de Lyon en confianza geométrica pura (0.83 vs
// 0.78, a propósito): con el agente de idioma en 0 la geometría sola se
// equivoca de ciudad, y hace falta mover el peso para que la hipótesis
// correcta adelante a la que solo parece más sólida — si Lyon ganara desde
// el principio, mover el slider nunca reordenaría nada y el esquema no
// enseñaría lo único que tiene que enseñar.
const HIPOTESIS: Hipotesis[] = [
  { id: "a", lugar: "Lyon, Francia", base: 0.78, contradiceAgente: false },
  { id: "b", lugar: "Turín, Italia", base: 0.83, contradiceAgente: true },
  { id: "c", lugar: "Ginebra, Suiza", base: 0.51, contradiceAgente: true },
];

const PISO_PENALIZACION = 0.15;

function Fila({ h, esPrimera }: { h: Hipotesis & { final: number }; esPrimera: boolean }) {
  const porcentaje = useConteo(h.final * 100);
  return (
    <div className="flex items-center gap-3">
      <span className={`w-[130px] shrink-0 text-[11.5px] transition-colors duration-300 ${esPrimera ? "text-fg" : "text-muted"}`}>
        {esPrimera && <span className="jg-reveal-up mr-[6px] inline-block text-subtle">→</span>}
        {h.lugar}
      </span>
      <div className="h-[9px] flex-1 overflow-hidden rounded-[4px] bg-elevated">
        <div
          className={`h-full rounded-[4px] transition-[width] duration-500 ease-[cubic-bezier(.16,1,.3,1)] ${h.contradiceAgente ? "bg-warning" : "bg-fg"}`}
          style={{ width: `${h.final * 100}%` }}
        />
      </div>
      <span className="w-[46px] shrink-0 text-right font-mono text-[11px] text-fg">{porcentaje.toFixed(0)}%</span>
    </div>
  );
}

/** Reordena de verdad al mover el peso — no solo cambian los porcentajes,
 *  las filas físicamente cambian de sitio (FLIP manual: se mide la
 *  posición antes de reordenar, se coloca ahí con un `translateY` sin
 *  transición, y en el fotograma siguiente se suelta con transición — así
 *  el navegador anima desde la posición vieja a la nueva en vez de saltar).
 *  Sin esto, "las hipótesis se reordenan por confianza" era una frase que
 *  el propio esquema no enseñaba. */
export function EsquemaConfianza() {
  const [peso, setPeso] = useState(0.3);

  const ordenadas = useMemo(() => {
    const conFinal = HIPOTESIS.map((h) => {
      const factor = h.contradiceAgente ? Math.max(1 - peso, PISO_PENALIZACION) : 1;
      return { ...h, final: h.base * factor };
    });
    return conFinal.sort((a, b) => b.final - a.final);
  }, [peso]);

  const filaRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const posicionesPrevias = useRef<Record<string, number>>({});

  useLayoutEffect(() => {
    ordenadas.forEach((h) => {
      const el = filaRefs.current[h.id];
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const anterior = posicionesPrevias.current[h.id];
      if (anterior !== undefined) {
        const delta = anterior - top;
        if (Math.abs(delta) > 0.5) {
          el.style.transition = "none";
          el.style.transform = `translateY(${delta}px)`;
          requestAnimationFrame(() => {
            el.style.transition = "transform .45s cubic-bezier(.16,1,.3,1)";
            el.style.transform = "";
          });
        }
      }
      posicionesPrevias.current[h.id] = top;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenadas.map((h) => h.id).join(",")]);

  return (
    <Esquema etiqueta="esquema · mueve el peso del agente de idioma">
      <div className="flex flex-col gap-[10px]">
        {ordenadas.map((h, i) => (
          <div key={h.id} ref={(el) => { filaRefs.current[h.id] = el; }}>
            <Fila h={h} esPrimera={i === 0} />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-[14px] border-t border-border pt-[14px]">
        <span className="whitespace-nowrap text-[10.5px] text-subtle">Peso del agente de idioma</span>
        <input
          type="range"
          min={0}
          max={0.85}
          step={0.01}
          value={peso}
          onChange={(e) => setPeso(Number(e.target.value))}
          className="h-[2px] flex-1 accent-fg"
        />
        <span className="whitespace-nowrap font-mono text-[11.5px] text-fg">{(peso * 100).toFixed(0)}%</span>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-subtle">
        Turín y Ginebra pierden confianza a medida que el agente de idioma pesa más — porque
        contradicen el francés detectado en la señalética— pero nunca desaparecen: el piso es{" "}
        {(PISO_PENALIZACION * 100).toFixed(0)}% de su valor base, no cero.
      </p>
    </Esquema>
  );
}
