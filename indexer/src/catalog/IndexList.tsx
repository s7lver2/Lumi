import { useEffect, useState } from "react";

import { api, type ResumenIndice } from "../lib/api";
import { Overlay } from "../ui/Overlay";
import { CatalogSearch } from "./CatalogSearch";
import { EmptyIndices } from "./EmptyIndices";
import { IndexRow } from "./IndexRow";
import { NewIndexDialog } from "./NewIndexDialog";
import { ProfileDialog } from "./ProfileDialog";
import { RemoteRepos } from "./RemoteRepos";

export function IndexList({ onAbrir }: { onAbrir: (id: number) => void }) {
  const [indices, setIndices] = useState<ResumenIndice[]>([]);
  const [creando, setCreando] = useState(false);
  const [cuenta, setCuenta] = useState<string | null>(null);
  // Qué índices tienen un modelo embebiendo AHORA MISMO, para la insignia de
  // la fila. Se sondea aparte de `indicesLista` porque cambia cada segundo y
  // la lista de índices no.
  const [embebiendo, setEmbebiendo] = useState<Set<number>>(new Set());

  useEffect(() => { void api.indicesLista().then(setIndices); }, []);
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
    <div className="relative mx-auto flex h-full max-w-[820px] flex-col gap-3 overflow-y-auto p-8">
      <div className="flex items-center gap-3">
        <p className="shrink-0 text-sm text-fg">Índices</p>
        <div className="flex-1">
          <CatalogSearch locales={indices} onAbrirLocal={onAbrir} onAbrirCuenta={setCuenta} />
        </div>
        {indices.length > 0 && (
          <button onClick={() => setCreando(true)}
            className="jg-press rounded-lg border border-border px-3 py-1.5 text-[11px] text-fg">
            + Nuevo índice
          </button>
        )}
      </div>
      {indices.length === 0
        ? <EmptyIndices onCrear={() => setCreando(true)} />
        : indices.map((r) => (
            <IndexRow key={r.id} r={r} embebiendo={embebiendo.has(r.id)} onAbrir={() => onAbrir(r.id)} />
          ))}

      <RemoteRepos />

      {cuenta && (
        <Overlay>
          <ProfileDialog cuenta={cuenta} onCerrar={() => setCuenta(null)} />
        </Overlay>
      )}

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
