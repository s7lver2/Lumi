"use client";

import { useState } from "react";
import { Esquema } from "../Esquema";

type Ejemplo = {
  id: string;
  etiqueta: string;
  pregunta: string;
  barras: { verbalizador: string; probabilidad: number }[];
};

const EJEMPLOS: Ejemplo[] = [
  {
    id: "calle-francesa",
    etiqueta: "calle con rótulos",
    pregunta: '¿Qué idioma es más probable en esta foto?',
    barras: [
      { verbalizador: "francés", probabilidad: 0.62 },
      { verbalizador: "italiano", probabilidad: 0.21 },
      { verbalizador: "español", probabilidad: 0.11 },
      { verbalizador: "alemán", probabilidad: 0.06 },
    ],
  },
  {
    id: "carretera-desierto",
    etiqueta: "carretera despejada",
    pregunta: "¿Qué tipo de vegetación domina la escena?",
    barras: [
      { verbalizador: "arbustiva árida", probabilidad: 0.71 },
      { verbalizador: "bosque templado", probabilidad: 0.15 },
      { verbalizador: "tropical", probabilidad: 0.09 },
      { verbalizador: "ninguna visible", probabilidad: 0.05 },
    ],
  },
];

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
      <p className="mt-3 text-[12.5px] text-muted">{ejemplo.pregunta}</p>
      <div className="mt-3 flex flex-col gap-[9px]">
        {ejemplo.barras.map((b) => (
          <div key={b.verbalizador} className="flex items-center gap-3">
            <span className="w-[120px] shrink-0 text-[11px] text-subtle">{b.verbalizador}</span>
            <div className="h-[7px] flex-1 overflow-hidden rounded-[4px] bg-elevated">
              <div
                className="h-full rounded-[4px] bg-fg transition-[width] duration-300 ease-out"
                style={{ width: `${b.probabilidad * 100}%` }}
              />
            </div>
            <span className="w-[42px] shrink-0 text-right font-mono text-[11px] text-fg">
              {(b.probabilidad * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </Esquema>
  );
}
