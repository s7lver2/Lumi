"use client";

import { useRef, useState } from "react";
import { Esquema } from "../Esquema";
import { useConteo } from "../useConteo";

type Ejemplo = {
  id: string;
  etiqueta: string;
  /** Misma foto que usa la landing en `AgentesVisual.tsx` — no una nueva:
   *  así el ejemplo es una foto real ya publicada en el sitio, no una
   *  escena inventada sin nada que enseñar. */
  imagen: string;
  alt: string;
  aspecto: number;
  pregunta: string;
  barras: { verbalizador: string; probabilidad: number }[];
};

const EJEMPLOS: Ejemplo[] = [
  {
    id: "escritura",
    etiqueta: "escritura",
    imagen: "/agentes/idioma-shinjuku.webp",
    alt: "Cruce de Kabukicho, Shinjuku, con rótulos en japonés",
    aspecto: 1600 / 1067,
    pregunta: "The writing on the signs in this photo is most likely",
    barras: [
      { verbalizador: " japonés (katakana)", probabilidad: 0.88 },
      { verbalizador: " japonés (kanji)", probabilidad: 0.07 },
      { verbalizador: " coreano (hangul)", probabilidad: 0.03 },
      { verbalizador: " chino simplificado", probabilidad: 0.02 },
    ],
  },
  {
    id: "matricula",
    etiqueta: "matrícula",
    imagen: "/agentes/matricula-coche.webp",
    alt: "Opel Corsa-e naranja con matrícula de banda azul europea",
    aspecto: 1600 / 1067,
    pregunta: "The registration plate on this vehicle most likely belongs to",
    barras: [
      { verbalizador: " Alemania", probabilidad: 0.89 },
      { verbalizador: " Países Bajos", probabilidad: 0.06 },
      { verbalizador: " Bélgica", probabilidad: 0.05 },
    ],
  },
];

function Barra({ verbalizador, probabilidad, retraso, clave }: { verbalizador: string; probabilidad: number; retraso: number; clave: string }) {
  const mostrado = useConteo(probabilidad * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-[142px] shrink-0 truncate text-[11px] text-subtle">{verbalizador.trim()}</span>
      <div className="h-[7px] flex-1 overflow-hidden rounded-[4px] bg-elevated">
        <div
          key={clave}
          className="jg-barra-llena h-full rounded-[4px] bg-fg"
          style={{ "--fin": `${probabilidad * 100}%`, animationDelay: `${retraso}s` } as React.CSSProperties}
        />
      </div>
      <span className="w-[36px] shrink-0 text-right font-mono text-[11px] text-fg">{mostrado.toFixed(0)}%</span>
    </div>
  );
}

/** El interior de un agente, con una foto real en vez de una escena
 *  inventada sin imagen (spec 2026-09-17 §2): la pregunta se le hace al VLM
 *  en inglés —el verbalizador real, no una traducción de exposición— y la
 *  barra es la confianza que sale del softmax sobre esos verbalizadores,
 *  no un número puesto a mano. Las dos fotos y sus hipótesis son las
 *  mismas que usa la landing en `AgentesVisual.tsx`. */
export function EsquemaAgente() {
  const [activo, setActivo] = useState(0);
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicador, setIndicador] = useState<{ left: number; width: number } | null>(null);
  const ejemplo = EJEMPLOS[activo];

  function mover(i: number) {
    setActivo(i);
    const el = botones.current[i];
    if (el) setIndicador({ left: el.offsetLeft, width: el.offsetWidth });
  }

  return (
    <Esquema etiqueta="esquema · cambia la imagen de ejemplo">
      <div className="relative flex gap-2">
        {indicador && (
          <div
            className="absolute top-0 h-full rounded-[8px] border border-white/[.34] transition-[left,width] duration-300 ease-out"
            style={{ left: indicador.left, width: indicador.width }}
            aria-hidden
          />
        )}
        {EJEMPLOS.map((e, i) => (
          <button
            key={e.id}
            ref={(el) => {
              botones.current[i] = el;
              if (el && !indicador && i === activo) setIndicador({ left: el.offsetLeft, width: el.offsetWidth });
            }}
            type="button"
            onClick={() => mover(i)}
            className={`jg-micro relative z-10 rounded-[8px] border px-3 py-[6px] text-[11.5px] transition-colors ${
              i === activo ? "border-transparent text-fg" : "border-border text-subtle hover:text-muted"
            }`}
          >
            {e.etiqueta}
          </button>
        ))}
      </div>
      <div className="relative mt-[14px] min-h-[104px] overflow-hidden">
        <div key={ejemplo.id} className="jg-agente-entra flex flex-col gap-4 sm:flex-row sm:items-start">
          <img
            src={ejemplo.imagen}
            alt={ejemplo.alt}
            style={{ aspectRatio: ejemplo.aspecto }}
            className="w-full shrink-0 rounded-[8px] border border-border object-cover transition-transform duration-500 hover:scale-[1.03] sm:w-[168px]"
          />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] leading-snug text-muted">&ldquo;{ejemplo.pregunta}&rdquo;</p>
            <div className="mt-3 flex flex-col gap-[9px]">
              {ejemplo.barras.map((b, i) => (
                <Barra key={b.verbalizador} clave={`${ejemplo.id}-${b.verbalizador}`} verbalizador={b.verbalizador} probabilidad={b.probabilidad} retraso={i * 0.07} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Esquema>
  );
}
