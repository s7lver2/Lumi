import { useEffect, useState } from "react";

import { api, type ResumenIndice } from "../lib/api";
import { Overlay } from "../ui/Overlay";
import { IndexRow } from "./IndexRow";
import { NewIndexDialog } from "./NewIndexDialog";

export function IndexList({ onAbrir }: { onAbrir: (id: number) => void }) {
  const [indices, setIndices] = useState<ResumenIndice[]>([]);
  const [creando, setCreando] = useState(false);

  useEffect(() => { void api.indicesLista().then(setIndices); }, []);

  return (
    <div className="relative mx-auto flex h-full max-w-[820px] flex-col gap-3 overflow-y-auto p-8">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg">Índices</p>
        <button onClick={() => setCreando(true)}
          className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg">
          + Nuevo índice
        </button>
      </div>
      {indices.length === 0 && (
        <p className="text-[11.5px] text-subtle">Todavía no hay ningún índice en este equipo.</p>
      )}
      {indices.map((r) => (
        <IndexRow key={r.id} r={r} onAbrir={() => onAbrir(r.id)} />
      ))}

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
