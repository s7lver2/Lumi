import { useEffect, useState } from "react";

import { api, type Resultados, type ResumenIndice } from "../lib/api";
import { Icon } from "../ui/Icon";

/** El buscador y su desplegable. Resuelve primero contra lo local —que es
 *  instantáneo— y completa con lo remoto cuando llega: escribir y esperar a la
 *  red para ver el índice que tienes delante sería absurdo.
 *
 *  La altura del desplegable no se anima: eso es layout. */
export function CatalogSearch({ locales, onAbrirLocal, onAbrirCuenta }: {
  locales: ResumenIndice[];
  onAbrirLocal: (id: number) => void;
  onAbrirCuenta: (cuenta: string) => void;
}) {
  const [texto, setTexto] = useState("");
  const [remoto, setRemoto] = useState<Resultados | null>(null);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (texto.trim().length < 2) { setRemoto(null); setBuscando(false); return; }
    let vivo = true;
    setBuscando(true);
    void api.catalogoBuscar(texto).then(
      (r) => { if (vivo) { setRemoto(r); setBuscando(false); } },
      () => { if (vivo) setBuscando(false); },
    );
    return () => { vivo = false; };
  }, [texto]);

  const t = texto.trim().toLowerCase();
  const activo = t.length >= 2;
  const propios = activo ? locales.filter((i) => i.nombre.toLowerCase().includes(t)) : [];
  const sinResultados = activo && !buscando
    && propios.length === 0 && (remoto?.indices.length ?? 0) === 0 && (remoto?.cuentas.length ?? 0) === 0;
  const abierto = activo && (propios.length > 0 || (remoto?.indices.length ?? 0) > 0
    || (remoto?.cuentas.length ?? 0) > 0 || sinResultados || buscando);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-white/[.13] bg-[rgba(16,19,25,.82)]
        px-3 py-2 shadow-lg shadow-black/40 backdrop-blur-xl">
        <Icon name="search" size={13} className="shrink-0 text-subtle" />
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar un índice o una cuenta…"
          className="w-full bg-transparent text-[12px] text-fg outline-none placeholder:text-subtle"
        />
        {buscando && <Icon name="spinner" size={12} className="shrink-0 animate-spin text-subtle" />}
        {!buscando && texto && (
          <button onClick={() => setTexto("")} className="shrink-0 text-subtle hover:text-fg">
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      {abierto && (
        <div className="lumi-anim absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-[420px] overflow-y-auto
          rounded-lg border border-white/[.13] bg-[rgba(16,19,25,.94)] p-2 shadow-lg shadow-black/40 backdrop-blur-xl"
          style={{ animation: "jg-fade-rise 160ms cubic-bezier(.2,.85,.35,1) both" }}>
          {sinResultados && (
            <p className="px-1.5 py-2 text-[11px] text-subtle">Nada con «{texto.trim()}», ni en local ni en el catálogo.</p>
          )}
          {(propios.length > 0 || (remoto?.indices.length ?? 0) > 0) && (
            <p className="px-1.5 pb-1 text-[8.5px] uppercase tracking-[.13em] text-subtle">Índices</p>
          )}
          {propios.map((i, n) => (
            <button key={`l${i.id}`} onClick={() => onAbrirLocal(i.id)}
              style={{ animation: `jg-fade-rise 160ms ${n * 20}ms cubic-bezier(.2,.85,.35,1) both` }}
              className="flex w-full items-center justify-between rounded-md px-1.5 py-1.5 text-left text-[11px] text-fg hover:bg-white/[.06]">
              {i.nombre}
              <span className="font-mono text-[10px] text-subtle">en este equipo</span>
            </button>
          ))}
          {remoto?.indices.map((f, n) => (
            <a key={f.paquete} href={f.url} target="_blank" rel="noreferrer"
              style={{ animation: `jg-fade-rise 160ms ${(propios.length + n) * 20}ms cubic-bezier(.2,.85,.35,1) both` }}
              className="flex w-full items-center justify-between rounded-md px-1.5 py-1.5 text-left text-[11px] text-fg hover:bg-white/[.06]">
              {f.nombre}
              <span className="font-mono text-[10px] text-subtle">
                {f.autor} · {f.teselas} teselas{f.numero_version > 1 ? ` · v${f.numero_version}` : ""}
              </span>
            </a>
          ))}
          {(remoto?.cuentas.length ?? 0) > 0 && (
            <p className="mt-1.5 px-1.5 pb-1 text-[8.5px] uppercase tracking-[.13em] text-subtle">Cuentas</p>
          )}
          {remoto?.cuentas.map((c) => (
            <button key={c} onClick={() => onAbrirCuenta(c)}
              className="flex w-full rounded-md px-1.5 py-1.5 text-left font-mono text-[11px] text-fg hover:bg-white/[.06]">
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
