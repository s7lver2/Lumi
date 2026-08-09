import { useEffect, useState } from "react";

import { api, type ResumenIndice } from "../lib/api";
import { Overlay } from "../ui/Overlay";
import { EmptyIndices } from "./EmptyIndices";
import { NewIndexDialog } from "./NewIndexDialog";

/** El selector que aparece al entrar en Territorio o Ingesta sin haber
 *  abierto un índice. Deliberadamente NO es la pestaña "Índices" con otro
 *  nombre: aquí no hay barra de procedencia ni insignias por fila, porque no
 *  se viene a auditar un catálogo — se viene a elegir uno y seguir. Una
 *  tarjeta centrada, no una lista a toda pantalla, para que se note que es
 *  un paso intermedio y no el destino. */
export function IndexPicker({ titulo, onAbrir }: { titulo: string; onAbrir: (id: number) => void }) {
  const [indices, setIndices] = useState<ResumenIndice[] | null>(null);
  const [creando, setCreando] = useState(false);

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
          <EmptyIndices onCrear={() => setCreando(true)} />
        ) : (
          <>
            <div className="mt-4 flex max-h-[280px] flex-col gap-1.5 overflow-y-auto">
              {indices.map((r) => (
                <button key={r.id} onClick={() => onAbrir(r.id)}
                  className="jg-press flex items-center justify-between gap-3 rounded-lg border border-border
                    px-3 py-2 text-left transition-colors duration-200 hover:border-white/[.16]">
                  <span className="truncate text-[12px] text-fg">{r.nombre}</span>
                  <span className="shrink-0 font-mono text-[10px] text-subtle">
                    {r.imagenes.toLocaleString("es-ES")} imágenes
                  </span>
                </button>
              ))}
            </div>
            <button onClick={() => setCreando(true)}
              className="jg-press mt-3.5 w-full rounded-lg border border-border py-2 text-[11.5px] text-fg">
              + Nuevo índice
            </button>
          </>
        )}
      </div>

      {creando && (
        <Overlay>
          <NewIndexDialog
            onCancelar={() => setCreando(false)}
            onCreado={(id) => { setCreando(false); onAbrir(id); }}
          />
        </Overlay>
      )}
    </div>
  );
}
