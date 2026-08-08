import { useEffect, useState } from "react";

import { api, type ProgresoCola } from "../lib/api";

/** La cola de embebido, visible. Aparece solo cuando hay trabajo: una barra
 *  permanente al 100 % es ruido, y el sondeo termina cuando el trabajo
 *  termina — misma lección que el paso de servicios y que la descarga. */
export function QueueBar() {
  const [p, setP] = useState<ProgresoCola | null>(null);

  useEffect(() => {
    const t = setInterval(() => { void api.colaProgreso().then(setP); }, 1200);
    return () => clearInterval(t);
  }, []);

  if (!p || (!p.trabajando && p.hechas === 0)) return null;
  const pct = p.total ? (p.hechas / p.total) * 100 : 0;

  // `pausada` sale del backend, que es quien manda: un estado local aquí sería
  // una segunda fuente de verdad, y quedaría mintiendo en cuanto la cola se
  // pausara por cualquier otra vía.
  async function alternar() {
    await api.colaPausar(!p!.pausada);
    setP(await api.colaProgreso());
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-border bg-[rgba(16,18,21,.6)] px-4 py-2">
      <span className="text-[10.5px] text-subtle">
        {p.pausada ? "Embebido en pausa" : p.trabajando ? "Embebiendo" : "Embebido al día"}
      </span>
      <span className="h-1 flex-1 overflow-hidden rounded-[2px] bg-elevated">
        <i className="block h-full bg-fg transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-[10px] text-muted">{p.hechas}/{p.total}</span>
      {p.saltadas > 0 && (
        // Una saltada es un RESULTADO ya anotado, no un fallo pendiente.
        <span className="font-mono text-[10px] text-subtle">{p.saltadas} saltadas</span>
      )}
      {p.reinicios > 0 && (
        // Un reinicio es una AVERÍA que ya se recuperó. Se enseña porque un
        // trabajador que se muere repetidamente es un síntoma, no un detalle.
        <span className="font-mono text-[10px] text-warning-fg">{p.reinicios} reinicios</span>
      )}
      <button onClick={() => void alternar()}
        className="jg-press rounded-lg border border-border px-2.5 py-1 text-[10.5px] text-fg">
        {p.pausada ? "Reanudar" : "Pausar"}
      </button>
    </div>
  );
}
