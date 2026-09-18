"use client";

import { useState } from "react";
import { Esquema } from "../Esquema";

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

/** El interior de un agente, con una foto real en vez de una escena
 *  inventada sin imagen (spec 2026-09-17 §2): la pregunta se le hace al VLM
 *  en inglés —el verbalizador real, no una traducción de exposición— y la
 *  barra es la confianza que sale del softmax sobre esos verbalizadores,
 *  no un número puesto a mano. Las dos fotos y sus hipótesis son las
 *  mismas que usa la landing en `AgentesVisual.tsx`. */
export function EsquemaAgente() {
  const [activo, setActivo] = useState(0);
  const ejemplo = EJEMPLOS[activo];

  return (
    <Esquema etiqueta="esquema · cambia la imagen de ejemplo">
      <div className="flex gap-2">
        {EJEMPLOS.map((e, i) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setActivo(i)}
            className={`jg-micro rounded-[8px] border px-3 py-[6px] text-[11.5px] ${
              i === activo ? "border-white/[.34] text-fg" : "border-border text-subtle"
            }`}
          >
            {e.etiqueta}
          </button>
        ))}
      </div>
      <div className="mt-[14px] flex flex-col gap-4 sm:flex-row sm:items-start">
        <img
          src={ejemplo.imagen}
          alt={ejemplo.alt}
          style={{ aspectRatio: ejemplo.aspecto }}
          className="w-full shrink-0 rounded-[8px] border border-border object-cover sm:w-[168px]"
        />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] leading-snug text-muted">&ldquo;{ejemplo.pregunta}&rdquo;</p>
          <div className="mt-3 flex flex-col gap-[9px]">
            {ejemplo.barras.map((b) => (
              <div key={b.verbalizador} className="flex items-center gap-3">
                <span className="w-[142px] shrink-0 truncate text-[11px] text-subtle">{b.verbalizador.trim()}</span>
                <div className="h-[7px] flex-1 overflow-hidden rounded-[4px] bg-elevated">
                  <div
                    className="h-full rounded-[4px] bg-fg transition-[width] duration-300 ease-out"
                    style={{ width: `${b.probabilidad * 100}%` }}
                  />
                </div>
                <span className="w-[36px] shrink-0 text-right font-mono text-[11px] text-fg">
                  {(b.probabilidad * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Esquema>
  );
}
