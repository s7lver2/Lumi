import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { api, type Cuentas, type FichaRevision } from "../lib/api";

/** Rechazo por excepción: TODO llega aceptado y tú clicas lo malo. Aprobar tres
 *  mil fotos de una en una no lo hace nadie dos veces.
 *
 *  Descartar MARCA, no borra: en una rejilla de miles un clic accidental no
 *  puede ser irreversible. */
export function ReviewGrid({ indiceId, onEmbeber }: { indiceId: number; onEmbeber: () => void }) {
  const [fichas, setFichas] = useState<FichaRevision[]>([]);
  const [fuera, setFuera] = useState<Set<number>>(new Set());
  const [cuentas, setCuentas] = useState<Cuentas | null>(null);
  const [ultimo, setUltimo] = useState<number | null>(null);

  useEffect(() => { void api.revisionPendientes(indiceId).then(setFichas); }, [indiceId]);

  function clic(i: number, conMayus: boolean) {
    const nuevos = new Set(fuera);
    // Mayúsculas selecciona un rango: es lo que hace tratable descartar
    // veinte seguidas de la misma sesión mala.
    const desde = conMayus && ultimo !== null ? Math.min(ultimo, i) : i;
    const hasta = conMayus && ultimo !== null ? Math.max(ultimo, i) : i;
    for (let k = desde; k <= hasta; k++) {
      const id = fichas[k].id;
      if (nuevos.has(id)) nuevos.delete(id); else nuevos.add(id);
    }
    setUltimo(i);
    setFuera(nuevos);
  }

  async function cerrar() {
    if (fuera.size > 0) await api.revisionRechazar(indiceId, [...fuera]);
    setCuentas(await api.revisionAceptarResto(indiceId));
    onEmbeber();
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-[16px_18px]">
        <p className="mb-3 text-[10.5px] text-subtle">
          clic para descartar · <b className="font-normal text-fg">May</b>+clic para un rango
        </p>
        <div className="grid grid-cols-6 gap-2.5">
          {fichas.map((f, i) => {
            const no = fuera.has(f.id);
            return (
              <button
                key={f.id}
                onClick={(ev) => clic(i, ev.shiftKey)}
                aria-pressed={no}
                className={`relative aspect-[4/3] overflow-hidden rounded-md border border-border
                  ${no ? "opacity-30 ring-[1.5px] ring-danger" : ""}`}
              >
                <img src={convertFileSrc(f.ruta)} alt="" loading="lazy"
                  className="h-full w-full object-cover" />
                <span className="absolute bottom-1 left-1 rounded-[3px] bg-black/50 px-1 py-px
                  font-mono text-[8px] text-white/75">
                  {f.licencia ?? f.fuente}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="w-[300px] border-l border-border bg-[rgba(16,18,21,.5)] p-[20px_18px]">
        <p className="text-[8.5px] uppercase tracking-[.13em] text-subtle">Lo que entra al índice</p>
        <div className="mt-3 flex flex-col gap-2 text-[11.5px]">
          <div className="flex"><span className="flex-1">aceptadas</span>
            <span className="font-mono">{fichas.length - fuera.size}</span></div>
          <div className="flex text-danger-fg"><span className="flex-1">fuera por ti</span>
            <span className="font-mono">{fuera.size}</span></div>
        </div>
        <p className="mt-4 text-[10.5px] leading-relaxed text-subtle">
          Descartar aquí <b className="font-normal text-fg">no borra el fichero</b>: lo marca. Una
          imagen sin vector sigue siendo material que se puede recuperar si cambias de opinión.
        </p>
        {cuentas && (
          <p className="mt-3 font-mono text-[10px] text-subtle">
            {cuentas.aceptadas} aceptadas · {cuentas.rechazadas} rechazadas
          </p>
        )}
        <button onClick={() => void cerrar()}
          className="jg-press mt-5 w-full rounded-lg bg-accent py-[7px] text-[11.5px] font-medium text-black">
          Embeber {fichas.length - fuera.size}
        </button>
      </aside>
    </div>
  );
}
