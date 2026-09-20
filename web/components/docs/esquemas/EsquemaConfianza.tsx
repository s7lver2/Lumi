"use client";

import { useConteo } from "../useConteo";
import { Esquema } from "../Esquema";

type Hipotesis = { id: string; lugar: string; inliers: number; confianza: number };

// Mismo criterio que la ficha real: la confianza sube con las
// correspondencias geométricas que sostienen la hipótesis, no con un factor
// externo ajustable -- Lyon gana aquí porque RoMa encontró más
// correspondencias consistentes, no porque nada la "prefiera".
const HIPOTESIS: Hipotesis[] = [
  { id: "a", lugar: "Lyon, Francia", inliers: 412, confianza: 0.83 },
  { id: "b", lugar: "Turín, Italia", inliers: 268, confianza: 0.61 },
  { id: "c", lugar: "Ginebra, Suiza", inliers: 97, confianza: 0.34 },
];

function Fila({ h, esPrimera }: { h: Hipotesis; esPrimera: boolean }) {
  const porcentaje = useConteo(h.confianza * 100);
  return (
    <div className="flex items-center gap-3">
      <span className={`w-[130px] shrink-0 text-[11.5px] transition-colors duration-300 ${esPrimera ? "text-fg" : "text-muted"}`}>
        {esPrimera && <span className="jg-reveal-up mr-[6px] inline-block text-subtle">→</span>}
        {h.lugar}
      </span>
      <div className="h-[9px] flex-1 overflow-hidden rounded-[4px] bg-elevated">
        <div
          className="h-full rounded-[4px] bg-fg transition-[width] duration-500 ease-[cubic-bezier(.16,1,.3,1)]"
          style={{ width: `${h.confianza * 100}%` }}
        />
      </div>
      <span className="w-[46px] shrink-0 text-right font-mono text-[11px] text-fg">{porcentaje.toFixed(0)}%</span>
    </div>
  );
}

/** El ranking sale directo de la confianza geométrica de la verificación --
 *  más correspondencias (`inliers`) sostenidas frente a la escena, más
 *  confianza. No hay ningún factor externo que lo reordene: lo que se ve
 *  aquí es exactamente lo que el investigador ve en el veredicto real. */
export function EsquemaConfianza() {
  const ordenadas = [...HIPOTESIS].sort((a, b) => b.confianza - a.confianza);

  return (
    <Esquema etiqueta="esquema · ranking por confianza geométrica">
      <div className="flex flex-col gap-[10px]">
        {ordenadas.map((h, i) => (
          <Fila key={h.id} h={h} esPrimera={i === 0} />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-[26px] gap-y-2 border-t border-border pt-[14px]">
        {ordenadas.map((h) => (
          <div key={h.id} className="flex items-center gap-1.5 font-mono text-[10.5px] text-subtle">
            <span className="text-fg">{h.inliers}</span> correspondencias · {h.lugar.split(",")[0]}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-subtle">
        Cuantas más correspondencias geométricas sostienen una hipótesis, más confianza se le
        asigna -- sin piso ni factor externo que la mueva de sitio.
      </p>
    </Esquema>
  );
}
