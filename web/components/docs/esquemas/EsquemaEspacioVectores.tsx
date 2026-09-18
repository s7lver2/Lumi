"use client";

import { useState } from "react";
import { Esquema } from "../Esquema";

const PUNTOS = [
  { id: 0, x: 90, y: 70 },
  { id: 1, x: 150, y: 40 },
  { id: 2, x: 210, y: 95 },
  { id: 3, x: 260, y: 50 },
  { id: 4, x: 320, y: 110 },
  { id: 5, x: 130, y: 130 },
  { id: 6, x: 380, y: 70 },
  { id: 7, x: 430, y: 130 },
  { id: 8, x: 470, y: 60 },
  { id: 9, x: 510, y: 120 },
];

const CONSULTA = { x: 340, y: 90 };

// Vecinos ilustrativos en cada espacio — el mismo punto de consulta tiene
// vecinos casi opuestos según qué mide la distancia.
const VECINOS_PIXEL = [4, 6, 7];
const VECINOS_LUGAR = [1, 5, 9];

export function EsquemaEspacioVectores() {
  const [espacio, setEspacio] = useState<"pixel" | "lugar">("pixel");
  const vecinos = espacio === "pixel" ? VECINOS_PIXEL : VECINOS_LUGAR;

  return (
    <Esquema etiqueta="esquema · señala tu foto y compara los dos espacios">
      <div className="rounded-[9px] border border-border bg-[#0b0c0e] p-3">
        <svg viewBox="0 0 560 170" width="100%" height="170">
          {/* El anillo de "tu foto" respira despacio de fondo — un latido en
              reposo, no una carga: se detiene solo (jg-lock-breathe ya lo
              usa el resto del sitio para lo mismo, "esto sigue vivo"). */}
          {/* jg-lock-breathe controla su propia opacidad (.7 → 1 en bucle):
              el gris apagado del trazo, no un opacity estático, es lo que
              mantiene este anillo como un pulso de fondo discreto. */}
          <circle
            cx={CONSULTA.x}
            cy={CONSULTA.y}
            r="10"
            fill="none"
            stroke="#6a6c70"
            strokeWidth="1"
            className="jg-lock-breathe"
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          />
          {vecinos.map((id, i) => {
            const p = PUNTOS[id];
            return (
              <line
                key={`${espacio}-${id}`}
                x1={CONSULTA.x}
                y1={CONSULTA.y}
                x2={p.x}
                y2={p.y}
                stroke="#e8e8e6"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.6"
                className="jg-vecino-fluye"
                style={{ animationDelay: `${i * 0.06}s` }}
              />
            );
          })}
          {PUNTOS.map((p, i) => (
            <circle
              key={p.id}
              cx={p.x}
              cy={p.y}
              r={vecinos.includes(p.id) ? 5 : 3}
              fill={vecinos.includes(p.id) ? "#e8e8e6" : "#3a3d42"}
              className="jg-rasgo-in transition-[r,fill] duration-300"
              style={{ animationDelay: `${i * 0.04}s`, transformBox: "fill-box", transformOrigin: "center" }}
            />
          ))}
          <circle cx={CONSULTA.x} cy={CONSULTA.y} r="6.5" fill="none" stroke="#e8e8e6" strokeWidth="1.6" />
          <circle cx={CONSULTA.x} cy={CONSULTA.y} r="2" fill="#e8e8e6" />
          <text x={CONSULTA.x + 10} y={CONSULTA.y - 10} fill="#6a6c70" fontSize="9" fontFamily="ui-monospace,Menlo,monospace">
            tu foto
          </text>
        </svg>
      </div>
      <div className="mt-[14px] flex items-center gap-3">
        <button
          type="button"
          onClick={() => setEspacio("pixel")}
          className={`jg-micro rounded-[8px] border px-3 py-[6px] text-[11.5px] ${
            espacio === "pixel" ? "border-white/[.34] text-fg" : "border-border text-subtle"
          }`}
        >
          Parecido de píxeles
        </button>
        <button
          type="button"
          onClick={() => setEspacio("lugar")}
          className={`jg-micro rounded-[8px] border px-3 py-[6px] text-[11.5px] ${
            espacio === "lugar" ? "border-white/[.34] text-fg" : "border-border text-subtle"
          }`}
        >
          Parecido de lugar
        </button>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-subtle">
        {espacio === "pixel"
          ? "Agrupados por color y composición — sin noción de dónde está cada sitio."
          : "Agrupados por el modelo de recuperación: dos fotos de la misma esquina quedan cerca aunque se parezcan poco a simple vista."}
      </p>
    </Esquema>
  );
}
