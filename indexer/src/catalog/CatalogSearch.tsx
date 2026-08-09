import { useEffect, useState } from "react";

import { api, type Resultados, type ResumenIndice } from "../lib/api";

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

  useEffect(() => {
    if (texto.trim().length < 2) { setRemoto(null); return; }
    let vivo = true;
    void api.catalogoBuscar(texto).then((r) => { if (vivo) setRemoto(r); }, () => {});
    return () => { vivo = false; };
  }, [texto]);

  const t = texto.trim().toLowerCase();
  const propios = t.length < 2 ? [] : locales.filter((i) => i.nombre.toLowerCase().includes(t));
  const abierto = t.length >= 2 && (propios.length > 0 || (remoto?.indices.length ?? 0) > 0 || (remoto?.cuentas.length ?? 0) > 0);

  return (
    <div className="relative">
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscar un índice o una cuenta…"
        className="w-full rounded-lg border border-border bg-panel px-3 py-1.5 text-[11.5px] text-fg placeholder:text-subtle"
      />
      {abierto && (
        <div className="absolute left-0 right-0 top-[34px] z-30 rounded-card border border-white/[.13]
          bg-[rgba(16,19,25,.94)] p-2 shadow-lg shadow-black/40 backdrop-blur-xl">
          {(propios.length > 0 || (remoto?.indices.length ?? 0) > 0) && (
            <p className="px-1.5 pb-1 text-[8.5px] uppercase tracking-[.13em] text-subtle">Índices</p>
          )}
          {propios.map((i, n) => (
            <button key={`l${i.id}`} onClick={() => onAbrirLocal(i.id)}
              style={{ animation: `jg-tile-sweep .3s ${n * 20}ms both` }}
              className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-[11px] text-fg hover:bg-white/[.05]">
              {i.nombre}
              <span className="font-mono text-[10px] text-subtle">en este equipo</span>
            </button>
          ))}
          {remoto?.indices.map((f, n) => (
            <a key={f.paquete} href={f.url} target="_blank" rel="noreferrer"
              style={{ animation: `jg-tile-sweep .3s ${(propios.length + n) * 20}ms both` }}
              className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-[11px] text-fg hover:bg-white/[.05]">
              {f.nombre}
              <span className="font-mono text-[10px] text-subtle">{f.autor} · {f.teselas} teselas</span>
            </a>
          ))}
          {(remoto?.cuentas.length ?? 0) > 0 && (
            <p className="mt-1.5 px-1.5 pb-1 text-[8.5px] uppercase tracking-[.13em] text-subtle">Cuentas</p>
          )}
          {remoto?.cuentas.map((c) => (
            <button key={c} onClick={() => onAbrirCuenta(c)}
              className="flex w-full rounded-md px-1.5 py-1 text-left font-mono text-[11px] text-fg hover:bg-white/[.05]">
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
