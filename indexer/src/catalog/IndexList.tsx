import { useEffect, useState } from "react";

import { api, type DependenciaRota, type ResumenIndice } from "../lib/api";
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
  const [rotas, setRotas] = useState<DependenciaRota[]>([]);
  // Qué índices tienen un modelo embebiendo AHORA MISMO, para la insignia de
  // la fila. Se sondea aparte de `indicesLista` porque cambia cada segundo y
  // la lista de índices no.
  const [embebiendo, setEmbebiendo] = useState<Set<number>>(new Set());

  useEffect(() => { void api.indicesLista().then(setIndices); }, []);
  useEffect(() => { void api.catalogoDependenciasRotas().then(setRotas, () => {}); }, []);
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

      {rotas.length > 0 && (
        <div className="rounded-card border border-warning/40 bg-warning/[.07] p-3.5">
          <p className="text-[11.5px] text-warning-fg">
            {rotas.length === 1 ? "Una dependencia" : `${rotas.length} dependencias`} de lo que
            publicaste ha desaparecido
          </p>
          <div className="mt-1.5 flex flex-col gap-1">
            {rotas.map((r) => (
              <div key={r.paquete} className="flex items-center justify-between text-[11px]">
                <span className="text-muted">
                  «{r.indice}» dependía de <span className="font-mono text-fg">{r.paquete}</span> de{" "}
                  <span className="font-mono">{r.autor}</span>
                </span>
                <span className="font-mono text-[10px] text-subtle">{r.quadkeys} teselas</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-muted">
            Esas teselas están libres otra vez: el reclamo se cayó con el paquete.
          </p>
        </div>
      )}

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
