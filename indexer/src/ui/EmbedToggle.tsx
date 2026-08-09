import { useEffect, useState } from "react";

import { api, type ProgresoCola } from "../lib/api";

/** Arrancar/pausar la cola de embebido. Vive junto a «Borrar índice» y
 *  «Sellar» en el detalle del índice, no suelto en una barra que aparecía en
 *  cualquier pantalla — sondea aparte de `QueueBar` porque el botón puede
 *  estar visible sin que las filas de progreso lo estén (o al revés). */
export function EmbedToggle() {
  const [filas, setFilas] = useState<ProgresoCola[]>([]);

  useEffect(() => {
    const tick = () => void api.colaProgreso().then(setFilas);
    tick();
    const t = setInterval(tick, 1200);
    return () => clearInterval(t);
  }, []);

  if (filas.length === 0) return null;
  const pausada = filas.some((p) => p.pausada);
  const hayTrabajo = filas.some((p) => p.indice_total > 0);

  async function alternar() {
    await api.colaPausar(!pausada);
    setFilas(await api.colaProgreso());
  }

  return (
    <button
      onClick={() => void alternar()}
      className={`jg-press rounded-lg border px-3 py-1.5 text-[11px] ${
        pausada && hayTrabajo
          ? "border-white/30 bg-white/[.08] text-fg"
          : "border-border text-fg"
      }`}
    >
      {pausada ? "Arrancar embebido" : "Pausar embebido"}
    </button>
  );
}
