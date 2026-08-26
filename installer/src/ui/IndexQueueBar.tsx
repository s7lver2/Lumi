import { useEffect, useState } from "react";

import { api, type ProgresoIndiceEmbed } from "../lib/api";

/** La cola de embebido, pero de ESTE índice, no de la cola entera. `QueueBar`
 *  (la global) enseña el trabajador entero, que procesa los índices con
 *  pendientes por turnos — con dos índices a la vez, su fila para un modelo
 *  podía enseñar el total de OTRO índice mientras se miraba el detalle de
 *  este, y los dos números no tenían nada que ver entre sí. Esta pregunta
 *  directamente por `id`, así que el total siempre es el de este índice. */
export function IndexQueueBar({ indiceId }: { indiceId: number }) {
  const [filas, setFilas] = useState<ProgresoIndiceEmbed[]>([]);

  useEffect(() => {
    const tick = () => void api.indiceProgresoEmbebido(indiceId).then(setFilas);
    tick();
    const t = setInterval(tick, 1200);
    return () => clearInterval(t);
  }, [indiceId]);

  // total > 0 no basta: una vez que un modelo tuvo algún vector, total no
  // vuelve a bajar nunca, y la fila se quedaba ahí para siempre diciendo
  // "100% · en espera de otro índice" aunque no quedara nada por hacer.
  const visibles = filas.filter((p) => p.total > 0 && p.hechas < p.total);
  if (visibles.length === 0) return null;

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-[rgba(16,18,21,.6)] px-4 py-2.5">
      {visibles.map((p) => {
        const pct = p.total ? (p.hechas / p.total) * 100 : 0;
        const estado = p.pausada
          ? "en pausa"
          : p.activo
            ? `lote ${p.lote_hechas}/${p.lote_total}`
            : "en espera de otro índice";

        return (
          <div key={p.modelo_id} className="flex min-w-0 items-center gap-2.5">
            <span className="w-16 shrink-0 truncate font-mono text-[9.5px] text-subtle">{p.modelo_id}</span>
            <span className="h-[5px] w-10 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-elevated">
              <i className="block h-full bg-fg transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </span>
            <span className="w-7 shrink-0 text-right font-mono text-[10px] text-fg">{Math.round(pct)}%</span>
            <span className="hidden shrink-0 font-mono text-[10px] text-muted min-[420px]:inline">
              {p.hechas} de {p.total}
            </span>
            <span className="min-w-0 flex-[2] truncate text-[10px] text-subtle" title={estado}>
              {estado}
            </span>
            {p.guardado_fallos > 0 && (
              // Un lote ya embebido que no se pudo subir a Qdrant: se
              // reintenta solo cada 5s, pero sin esto no había forma de
              // distinguir "avanza despacio" de "atascado reintentando".
              <span
                className="shrink-0 font-mono text-[10px] text-warning-fg"
                title="lotes embebidos que no se pudieron subir a Qdrant y se están reintentando"
              >
                {p.guardado_fallos} sin subir
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
