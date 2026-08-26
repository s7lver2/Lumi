import { useEffect, useState } from "react";

import { api, type Modelo } from "../lib/api";
import { Icon } from "../ui/Icon";

export function ModelsStep({ onListo }: { onListo: () => void }) {
  const [modelos, setModelos] = useState<Modelo[]>([]);
  useEffect(() => { void api.modelosLista().then(setModelos); }, []);

  return (
    <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <p className="text-sm text-fg">Modelos disponibles</p>
      <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
        Un índice puede llevar vectores de varios a la vez. Los dos de abajo son los que traen dentro
        los paquetes de la v1, así que sin ellos no se podría abrir nada de lo ya publicado.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {modelos.map((m) => (
          <div key={m.id} className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-2">
            <Icon name="layers" size={13} className="text-fg" />
            <span className="flex-1 text-xs text-fg">{m.nombre}</span>
            <span className="font-mono text-[10px] text-subtle">{m.base} · {m.dims}-d · v{m.version}</span>
          </div>
        ))}
      </div>
      <div className="mt-[17px] flex justify-end">
        <button onClick={onListo} className="jg-press rounded-lg bg-accent px-4 py-2 text-[11.5px] font-medium text-black">
          Entrar
        </button>
      </div>
    </div>
  );
}
