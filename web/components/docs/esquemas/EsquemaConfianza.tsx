"use client";

import { useMemo, useState } from "react";
import { Esquema } from "../Esquema";

type Hipotesis = { id: string; lugar: string; base: number; contradiceAgente: boolean };

const HIPOTESIS: Hipotesis[] = [
  { id: "a", lugar: "Lyon, Francia", base: 0.78, contradiceAgente: false },
  { id: "b", lugar: "Turín, Italia", base: 0.64, contradiceAgente: true },
  { id: "c", lugar: "Ginebra, Suiza", base: 0.51, contradiceAgente: true },
];

const PISO_PENALIZACION = 0.15;

export function EsquemaConfianza() {
  const [peso, setPeso] = useState(0.3);

  const ordenadas = useMemo(() => {
    const conFinal = HIPOTESIS.map((h) => {
      const factor = h.contradiceAgente ? Math.max(1 - peso, PISO_PENALIZACION) : 1;
      return { ...h, final: h.base * factor };
    });
    return conFinal.sort((a, b) => b.final - a.final);
  }, [peso]);

  return (
    <Esquema etiqueta="esquema · mueve el peso del agente de idioma">
      <div className="flex flex-col gap-[10px]">
        {ordenadas.map((h) => (
          <div key={h.id} className="flex items-center gap-3 transition-transform duration-300">
            <span className="w-[130px] shrink-0 text-[11.5px] text-fg">{h.lugar}</span>
            <div className="h-[9px] flex-1 overflow-hidden rounded-[4px] bg-elevated">
              <div
                className={`h-full rounded-[4px] transition-[width] duration-300 ease-out ${h.contradiceAgente ? "bg-warning" : "bg-fg"}`}
                style={{ width: `${h.final * 100}%` }}
              />
            </div>
            <span className="w-[46px] shrink-0 text-right font-mono text-[11px] text-fg">{(h.final * 100).toFixed(0)}%</span>
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
