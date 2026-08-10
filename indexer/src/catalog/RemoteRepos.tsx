import { useEffect, useState } from "react";

import { api, type RepoRemoto } from "../lib/api";

/** Lo publicado desde este equipo, agrupado POR REPOSITORIO y no por índice:
 *  es como el operador lo ve en GitHub, y es donde va a mirar cuando algo no
 *  cuadre. */
export function RemoteRepos({ onContinuar }: { onContinuar?: (paquete: string) => void }) {
  const [repos, setRepos] = useState<RepoRemoto[]>([]);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = () => void api.catalogoMios().then(setRepos, () => {});
  useEffect(cargar, []);

  async function refrescar() {
    setRefrescando(true);
    try { await api.catalogoRefrescar(); cargar(); } finally { setRefrescando(false); }
  }

  if (repos.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] uppercase tracking-[.08em] text-subtle">Publicado</p>
        <button onClick={() => void refrescar()} disabled={refrescando}
          className="jg-press rounded-lg border border-border px-2.5 py-1 text-[10.5px] text-subtle disabled:opacity-40">
          {refrescando ? "Refrescando…" : "Refrescar"}
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {repos.map((r) => (
          <div key={r.repo} className="rounded-card border border-border bg-panel p-3">
            <p className="font-mono text-[10.5px] text-subtle">{r.repo}</p>
            <div className="mt-1.5 flex flex-col gap-1">
              {r.paquetes.map((p) => (
                <div key={p.paquete} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 text-fg">
                    {p.nombre}
                    {p.numero_version > 1 && (
                      <span className="font-mono text-[9px] text-subtle">v{p.numero_version}</span>
                    )}
                  </span>
                  {p.viva ? (
                    <span className="font-mono text-[10px] text-subtle">publicado</span>
                  ) : (
                    <span className="flex items-center gap-2 font-mono text-[10px] text-warning-fg">
                      no disponible
                      {onContinuar && (
                        <button onClick={() => onContinuar(p.paquete)} className="underline">
                          Continuar subida
                        </button>
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
