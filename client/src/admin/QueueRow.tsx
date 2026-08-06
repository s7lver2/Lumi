import { useEffect, useState } from "react";
import { api, type QueueView } from "../lib/api";
import { Icon } from "../ui/Icon";

/** PROVISIONAL. El subsistema 3 rehace el panel entero; esto solo tiene que
 *  funcionar y usar los tokens.
 *
 *  Existe porque «la cola parece estar siempre en pausa» no se puede
 *  diagnosticar desde la franja de telemetría: esa solo dice `queue_paused`,
 *  un booleano sin decir POR QUÉ. Aquí se ve cada trabajador uno por uno —si
 *  ninguno ha dicho `listo` todavía, o si ninguno llegó a arrancar. */
export function QueueRow({ token }: { token: string }) {
  const [q, setQ] = useState<QueueView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      api.get<QueueView>("/v1/queue", token)
        .then((v) => { if (vivo) { setQ(v); setError(null); } })
        .catch((e) => { if (vivo) setError(String(e)); });
    void cargar();
    // Cada 2 s y no con el SSE de resultados: este panel es de diagnóstico,
    // no necesita la latencia de un evento y sondear es más simple.
    const t = setInterval(cargar, 2000);
    return () => { vivo = false; clearInterval(t); };
  }, [token]);

  const pausada = q !== null && !q.trabajadores.some((w) => w.listo);

  return (
    <div className="rounded-card border border-border p-3.5">
      <div className="flex items-center gap-2">
        <p className="text-[12.5px] text-fg">Cola</p>
        {pausada && (
          <span className="rounded-full bg-warning/[.12] px-2 py-0.5 text-[9.5px] text-warning-fg">
            en pausa · ningún trabajador listo
          </span>
        )}
      </div>
      <p className="mb-3 text-[11px] text-muted">quién está repartido y quién no ha arrancado</p>

      {error && <p className="text-[11px] text-danger-fg">{error}</p>}
      {!error && q === null && <p className="text-[11px] text-subtle">cargando</p>}

      {q && (
        <>
          <div className="mb-3 flex gap-4 text-[11px] text-muted">
            <span><b className="font-mono text-fg">{q.pendientes}</b> pendientes</span>
            <span><b className="font-mono text-fg">{q.en_curso}</b> en curso</span>
          </div>

          {q.trabajadores.length === 0 ? (
            <p className="text-[11px] text-subtle">ningún trabajador ha llegado a lanzarse</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {q.trabajadores.map((w) => (
                <div key={w.dispositivo}
                  className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-1.5">
                  <Icon name={w.listo ? "check" : "clock"} size={12}
                    className={w.listo ? "text-draw-fg" : "text-subtle"} />
                  <span className="font-mono text-[11px] text-fg">{w.dispositivo}</span>
                  <span className="text-[10.5px] text-subtle">
                    {w.listo
                      ? (w.modelo ? `listo · ${w.modelo}` : "listo · sin modelo cargado")
                      : "cargando todavía"}
                  </span>
                  {w.trabajo !== null && (
                    <span className="ml-auto font-mono text-[10.5px] text-muted">
                      análisis #{w.trabajo}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
