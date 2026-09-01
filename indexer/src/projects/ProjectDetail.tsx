import { useEffect, useState } from "react";

import { IndexRow } from "../catalog/IndexRow";
import { NewIndexDialog } from "../catalog/NewIndexDialog";
import { api, type Proyecto, type ResumenIndice } from "../lib/api";
import { Overlay } from "../ui/Overlay";

function fecha(epochSeg: number): string {
  return new Date(epochSeg * 1000).toLocaleDateString("es-ES");
}

/** El panel derecho de un proyecto: nombre, enlace a GitHub, las cuatro
 *  estadísticas agregadas (ya las trae `Proyecto` — sumadas en el backend
 *  sobre todos sus índices locales, publicados o no), y la lista de sus
 *  índices reutilizando `IndexRow`. */
export function ProjectDetail({ proyecto, onAbrirIndice, onCambiado }: {
  proyecto: Proyecto;
  onAbrirIndice: (id: number) => void;
  onCambiado: () => void;
}) {
  const [indices, setIndices] = useState<ResumenIndice[]>([]);
  const [creando, setCreando] = useState(false);
  const [embebiendo, setEmbebiendo] = useState<Set<number>>(new Set());

  const cargar = () => void api.indicesListaDeProyecto(proyecto.repo).then(setIndices);
  useEffect(cargar, [proyecto.repo]);

  useEffect(() => {
    const tick = () =>
      void api.colaProgreso().then((cola) => {
        const activos = cola.filter((c) => c.trabajando && c.indice_actual !== null).map((c) => c.indice_actual!);
        setEmbebiendo(new Set(activos));
      });
    tick();
    const t = setInterval(tick, 1500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto flex h-full max-w-[820px] flex-col gap-4 overflow-y-auto p-8">
      <div className="flex items-center gap-3">
        <p className="text-[15px] text-fg">{proyecto.repo}</p>
        {proyecto.privado && (
          <span className="rounded-full border border-border px-2 py-px text-[9px] text-subtle">privado</span>
        )}
        <a href={`https://github.com/${proyecto.repo}`} target="_blank" rel="noreferrer"
          className="jg-press ml-auto rounded-lg border border-border px-2.5 py-1.5 text-[10.5px] text-fg">
          Ver en GitHub ↗
        </a>
        <button onClick={() => setCreando(true)}
          className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg">
          + Nuevo índice
        </button>
      </div>

      <div className="flex gap-6">
        <Stat etiqueta="Índices" valor={proyecto.indices} />
        <Stat etiqueta="Teselas z14" valor={proyecto.teselas} />
        <Stat etiqueta="Imágenes" valor={proyecto.imagenes} />
        <Stat etiqueta="Última actividad"
          valor={proyecto.ultima_actividad !== null ? fecha(proyecto.ultima_actividad) : "—"} />
      </div>

      <div className="flex flex-col gap-3">
        {indices.length === 0 ? (
          <p className="rounded-card border border-dashed border-border p-6 text-center text-[11.5px] text-subtle">
            Este proyecto todavía no tiene índices. Crea el primero.
          </p>
        ) : (
          indices.map((r) => (
            <IndexRow key={r.id} r={r} embebiendo={embebiendo.has(r.id)} onAbrir={() => onAbrirIndice(r.id)} />
          ))
        )}
      </div>

      {creando && (
        <Overlay>
          <NewIndexDialog proyecto={proyecto.repo}
            onCancelar={() => setCreando(false)}
            onCreado={(id) => { setCreando(false); cargar(); onCambiado(); onAbrirIndice(id); }} />
        </Overlay>
      )}
    </div>
  );
}

function Stat({ etiqueta, valor }: { etiqueta: string; valor: number | string }) {
  return (
    <div>
      <p className="text-[8.5px] uppercase tracking-[.13em] text-subtle">{etiqueta}</p>
      <p className="mt-1 font-mono text-[15px] text-fg">
        {typeof valor === "number" ? valor.toLocaleString("es-ES") : valor}
      </p>
    </div>
  );
}
