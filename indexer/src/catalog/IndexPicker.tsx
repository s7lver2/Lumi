import { useEffect, useState } from "react";

import { api, type ResumenIndice } from "../lib/api";

/** El selector que aparece al entrar en Territorio o Ingesta sin haber
 *  abierto un índice. Deliberadamente NO es la pestaña "Proyectos" con otro
 *  nombre: aquí no hay barra de procedencia ni insignias por fila, porque no
 *  se viene a auditar un catálogo — se viene a elegir uno y seguir. Una
 *  tarjeta centrada, no una lista a toda pantalla, para que se note que es
 *  un paso intermedio y no el destino.
 *
 *  Ya no crea índices aquí: un índice nace dentro de un proyecto elegido de
 *  antemano (spec de pestaña de Proyectos), y este selector no tiene ningún
 *  proyecto delante — solo elige entre los que ya existen. Sin ninguno
 *  todavía, manda a Proyectos en vez de ofrecer un atajo sin proyecto. */
export function IndexPicker({ titulo, onAbrir }: { titulo: string; onAbrir: (id: number, nombre: string) => void }) {
  const [indices, setIndices] = useState<ResumenIndice[] | null>(null);

  useEffect(() => { void api.indicesLista().then(setIndices); }, []);

  if (indices === null) return null;

  return (
    <div className="grid h-full place-items-center p-8">
      <div className="lumi-anim w-full max-w-[420px] rounded-card border border-white/[.13]
        bg-[rgba(16,19,25,.72)] p-6 shadow-lg shadow-black/40 backdrop-blur-xl"
        style={{ animation: "jg-fade-rise 220ms cubic-bezier(.2,.85,.35,1) both" }}>
        <p className="text-[13px] text-fg">{titulo}</p>
        <p className="mt-1 text-[11px] text-subtle">
          Necesita saber en qué índice trabajar antes de seguir.
        </p>

        {indices.length === 0 ? (
          <p className="mt-4 text-[11.5px] leading-relaxed text-subtle">
            Todavía no hay ningún índice. Ve a <b className="font-normal text-fg">Proyectos</b> para
            crear el primero dentro de un proyecto.
          </p>
        ) : (
          <div className="mt-4 flex max-h-[280px] flex-col gap-1.5 overflow-y-auto">
            {indices.map((r) => (
              <button key={r.id} onClick={() => onAbrir(r.id, r.nombre)}
                className="jg-press flex items-center justify-between gap-3 rounded-lg border border-border
                  px-3 py-2 text-left transition-colors duration-200 hover:border-white/[.16]">
                <span className="truncate text-[12px] text-fg">{r.nombre}</span>
                <span className="shrink-0 font-mono text-[10px] text-subtle">
                  {r.imagenes.toLocaleString("es-ES")} imágenes
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
