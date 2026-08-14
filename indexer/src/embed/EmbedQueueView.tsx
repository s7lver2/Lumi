import { useEffect, useState } from "react";

import { api, type ProgresoCola, type ResumenIndice } from "../lib/api";
import { Icon } from "../ui/Icon";

/** La cola de embebido entera, como destino propio del carril — no colgada
 *  del detalle de un índice concreto (eso se rompía en cuanto ese índice se
 *  borraba, se sellaba o simplemente se cerraba el diálogo). Un bucle por
 *  modelo, la misma `ProgresoCola` que ya servía `EmbedToggle`/`IndexQueueBar`,
 *  aquí mostrada completa: en qué índice está cada modelo, cuánto lleva ese
 *  índice entero y cuánto el lote de 32 que tiene entre manos ahora mismo. */
export function EmbedQueueView() {
  const [filas, setFilas] = useState<ProgresoCola[]>([]);
  const [indices, setIndices] = useState<ResumenIndice[]>([]);

  useEffect(() => {
    const tick = () => void api.colaProgreso().then(setFilas);
    tick();
    const t = setInterval(tick, 1200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const tick = () => void api.indicesLista().then(setIndices);
    tick();
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, []);

  const nombreDe = (id: number | null) => indices.find((i) => i.id === id)?.nombre ?? (id ? `índice ${id}` : null);
  const pausada = filas.some((p) => p.pausada);
  const hayTrabajo = filas.some((p) => p.indice_total > 0 || p.trabajando);

  async function alternar() {
    await api.colaPausar(!pausada);
    setFilas(await api.colaProgreso());
  }

  return (
    <div className="mx-auto flex h-full max-w-[820px] flex-col gap-3 overflow-y-auto p-8">
      <div className="flex items-center gap-3">
        <p className="flex-1 text-sm text-fg">Embebido</p>
        {filas.length > 0 && (
          <button onClick={() => void alternar()}
            className={`jg-press rounded-lg border px-3 py-1.5 text-[11px] ${
              pausada && hayTrabajo ? "border-white/30 bg-white/[.08] text-fg" : "border-border text-fg"
            }`}>
            {pausada ? "Arrancar embebido" : "Pausar embebido"}
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted">
        Un bucle por modelo de recuperación, cada uno con su propia GPU-tiempo — un modelo al
        100% no espera a otro que todavía le falta.
      </p>

      {filas.length === 0 && (
        <div className="mt-6 flex flex-col items-center gap-2 text-center text-muted">
          <Icon name="embebido" size={22} />
          <p className="max-w-[38ch] text-[11.5px] leading-relaxed">
            Sin modelos registrados, o ningún índice les ha dado trabajo todavía.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {filas.map((p) => {
          const nombreIndice = nombreDe(p.indice_actual);
          const pctLote = p.total ? Math.round((p.hechas / p.total) * 100) : 0;
          const pctIndice = p.indice_total ? Math.round((p.indice_hechas / p.indice_total) * 100) : 0;
          return (
            <div key={p.modelo_id} className="rounded-lg border border-border bg-panel px-3.5 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="w-24 shrink-0 truncate font-mono text-[11px] text-fg">{p.modelo_id}</span>
                <span className="font-mono text-[9.5px] text-subtle">{p.dispositivo || "…"}</span>
                <span className="min-w-0 flex-1 truncate text-right text-[10.5px] text-muted">
                  {p.pausada
                    ? "en pausa"
                    : p.trabajando && nombreIndice
                      ? `«${nombreIndice}» · lote ${p.hechas}/${p.total}`
                      : "en espera de un índice con trabajo"}
                </span>
              </div>
              {p.trabajando && nombreIndice && (
                <>
                  <div className="mt-2 h-[3px] overflow-hidden rounded-sm bg-elevated">
                    <div className="h-full bg-fg transition-[width] duration-500"
                      style={{ width: `${pctLote}%` }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[9.5px] text-subtle">
                    <span>lote {pctLote}%</span>
                    <span>índice entero: {p.indice_hechas} de {p.indice_total} ({pctIndice}%)</span>
                  </div>
                </>
              )}
              {(p.saltadas > 0 || p.reinicios > 0 || p.guardado_fallos > 0) && (
                <div className="mt-1.5 flex gap-3 font-mono text-[9.5px] text-warning-fg">
                  {p.saltadas > 0 && <span>{p.saltadas} saltadas</span>}
                  {p.reinicios > 0 && <span>{p.reinicios} reinicios</span>}
                  {p.guardado_fallos > 0 && <span>{p.guardado_fallos} sin subir</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
