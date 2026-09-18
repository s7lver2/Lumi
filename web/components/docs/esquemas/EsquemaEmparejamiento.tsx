"use client";

import { useState } from "react";
import { Esquema } from "../Esquema";

const PARES = [
  { a: { x: 120, y: 66 }, b: { x: 428, y: 60 }, certeza: 0.91 },
  { a: { x: 60, y: 104 }, b: { x: 370, y: 100 }, certeza: 0.74 },
  { a: { x: 104, y: 104 }, b: { x: 412, y: 100 }, certeza: 0.68 },
  { a: { x: 200, y: 150 }, b: { x: 508, y: 150 }, certeza: 0.55 },
  { a: { x: 214, y: 88 }, b: { x: 520, y: 84 }, certeza: 0.5 },
  { a: { x: 40, y: 150 }, b: { x: 352, y: 150 }, certeza: 0.31 },
  { a: { x: 258, y: 88 }, b: { x: 564, y: 84 }, certeza: 0.22 },
];

export function EsquemaEmparejamiento({ etiqueta }: { etiqueta: string }) {
  const [umbral, setUmbral] = useState(0.46);
  const sobreviven = PARES.filter((p) => p.certeza >= umbral).length;

  return (
    <Esquema etiqueta={etiqueta}>
      <div className="rounded-[9px] border border-border bg-[#0b0c0e] p-2">
        <svg viewBox="0 0 600 188" width="100%" height="188">
          <g stroke="#26282c" strokeWidth="1" fill="none">
            <rect x="18" y="20" width="258" height="148" rx="6" />
            <rect x="324" y="20" width="258" height="148" rx="6" />
          </g>
          {PARES.map((p, i) => {
            const activo = p.certeza >= umbral;
            return (
              <line
                key={i}
                x1={p.a.x}
                y1={p.a.y}
                x2={p.b.x}
                y2={p.b.y}
                stroke={activo ? "#e8e8e6" : "#6a6c70"}
                strokeWidth="1"
                opacity={activo ? 0.72 : 0.3}
                strokeDasharray={activo ? undefined : "3 3"}
              />
            );
          })}
          {PARES.map((p, i) => (
            <g key={i} fill={p.certeza >= umbral ? "#e8e8e6" : "#6a6c70"}>
              <circle cx={p.a.x} cy={p.a.y} r="2.6" />
              <circle cx={p.b.x} cy={p.b.y} r="2.6" />
            </g>
          ))}
          <text x="18" y="13" fill="#6a6c70" fontSize="9" fontFamily="ui-monospace,Menlo,monospace">
            tu foto
          </text>
          <text x="324" y="13" fill="#6a6c70" fontSize="9" fontFamily="ui-monospace,Menlo,monospace">
            candidato
          </text>
        </svg>
      </div>
      <div className="mt-[14px] flex items-center gap-[14px]">
        <span className="whitespace-nowrap text-[10.5px] text-subtle">Umbral de certeza</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={umbral}
          onChange={(e) => setUmbral(Number(e.target.value))}
          className="h-[2px] flex-1 accent-fg"
        />
        <span className="whitespace-nowrap font-mono text-[11.5px] text-fg">
          {umbral.toFixed(2)} · {sobreviven} de {PARES.length}
        </span>
      </div>
      <div className="mt-3 flex gap-[18px]">
        <div className="flex items-center gap-[7px] text-[10.5px] text-subtle">
          <span className="block h-[2px] w-[14px] rounded-[2px] bg-fg" />
          correspondencia por encima del umbral
        </div>
        <div className="flex items-center gap-[7px] text-[10.5px] text-subtle">
          <span className="block h-[2px] w-[14px] rounded-[2px] bg-subtle opacity-50" />
          descartada
        </div>
      </div>
    </Esquema>
  );
}
