import { useEffect, useState } from "react";

import { api, type CapaRemota, type Modelo } from "../lib/api";

/** Un vector ES el modelo: no hay conversión entre `lumi-2 2.1` y `2.2`. Lo
 *  que sí se evita para siempre es volver a comprarle píxeles al proveedor —
 *  publicar una capa nueva no resube ni un byte de imagen.
 *
 *  Dos capas del mismo modelo firmadas por personas distintas conviven: se
 *  listan las dos con su autor y no se borra ninguna, porque no hay autoridad
 *  que pueda decidir eso. */
export function ModelLayers({ onPublicarCapa, onEmbeberEnLocal }: {
  onPublicarCapa?: (paquete: string, modelo: string) => void;
  onEmbeberEnLocal?: (modelo: string) => void;
}) {
  const [capas, setCapas] = useState<CapaRemota[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);

  useEffect(() => { void api.catalogoCapas().then(setCapas, () => {}); }, []);
  useEffect(() => { void api.modelosLista().then(setModelos); }, []);

  // Un modelo instalado aquí para el que nadie ha publicado capa: no es un
  // motivo para rechazar el paquete, es un motivo para embeberlo en local.
  const sinCapa = modelos.filter((m) => !capas.some((c) => c.modelo === m.id));

  if (capas.length === 0 && sinCapa.length === 0) return null;

  return (
    <div className="mt-6">
      <p className="text-[10.5px] uppercase tracking-[.08em] text-subtle">Capas de modelo</p>

      {sinCapa.length > 0 && (
        <div className="mt-2 rounded-card border border-warning/40 bg-warning/[.07] p-3">
          <p className="text-[11px] text-warning-fg">
            Nadie ha publicado capa para {sinCapa.map((m) => m.nombre).join(", ")}
          </p>
          <div className="mt-1.5 flex gap-2">
            {sinCapa.map((m) => (
              <button key={m.id} onClick={() => onEmbeberEnLocal?.(m.id)}
                className="jg-press rounded-lg border border-border px-2.5 py-1 text-[10.5px] text-fg">
                Embeber {m.nombre} en local
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-col gap-1">
        {capas.map((c) => (
          <div key={`${c.paquete}-${c.modelo}-${c.autor}`}
            className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-[11px]">
            <span className="text-fg">{c.paquete}</span>
            <span className="font-mono text-[10px] text-subtle">
              {c.modelo} {c.version} · {c.dims}-d · {c.autor}
              {c.del_autor_del_cuerpo ? " · autor del cuerpo" : ""}
            </span>
            <button onClick={() => onPublicarCapa?.(c.paquete, c.modelo)}
              className="jg-press rounded-lg border border-border px-2.5 py-1 text-[10.5px] text-fg">
              Publicar capa
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
