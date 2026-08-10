import { useEffect, useState } from "react";

import { api, type IndiceInstalado } from "../lib/api";
import { InstallFlow } from "./InstallFlow";

const KB = 1024;
function tamano(bytes: number): string {
  if (bytes < KB * KB) return `${(bytes / KB).toFixed(0)} KB`;
  if (bytes < KB * KB * KB) return `${(bytes / KB / KB).toFixed(1)} MB`;
  return `${(bytes / KB / KB / KB).toFixed(2)} GB`;
}

/** Lo instalado en el servidor: quién lo publicó, cuánto ocupa, y
 *  desinstalar. Sin esto el disco del servidor se llena sin que nadie sepa de
 *  qué — la misma razón por la que existe QueueRow para la cola. */
export function IndicesPanel({ token }: { token: string }) {
  const [lista, setLista] = useState<IndiceInstalado[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instalando, setInstalando] = useState(false);
  const [borrando, setBorrando] = useState<string | null>(null);

  function cargar() {
    api.get<IndiceInstalado[]>("/v1/indices", token)
      .then((v) => { setLista(v); setError(null); })
      .catch((e) => setError(String(e)));
  }
  useEffect(cargar, [token]);

  async function desinstalar(paquete: string) {
    setBorrando(paquete);
    try {
      await api.del(`/v1/indices/${encodeURIComponent(paquete)}`, token);
      cargar();
    } catch (e) {
      setError(String(e));
    } finally {
      setBorrando(null);
    }
  }

  const teselas = (lista ?? []).reduce((s, i) => s + i.teselas, 0);
  const bytes = (lista ?? []).reduce((s, i) => s + i.bytes, 0);
  const modelos = new Set((lista ?? []).map((i) => i.modelo)).size;

  return (
    <div className="rounded-card border border-border p-3.5">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[12.5px] text-fg">Índices</p>
        <button onClick={() => setInstalando(true)}
          className="rounded-lg border border-white/15 px-2.5 py-1 text-[10.5px] text-fg hover:border-white/30">
          Instalar del catálogo…
        </button>
      </div>
      <p className="mb-3 text-[11px] text-muted">el corpus contra el que responde el motor</p>

      {error && <p className="text-[11px] text-danger-fg">{error}</p>}
      {!error && lista === null && <p className="text-[11px] text-subtle">cargando</p>}

      {lista && lista.length === 0 && (
        <p className="text-[11px] text-subtle">nada instalado todavía</p>
      )}

      {lista && lista.length > 0 && (
        <>
          <div className="mb-3 flex gap-4 font-mono text-[11px] text-muted">
            <span><b className="text-fg">{teselas}</b> teselas</span>
            <span><b className="text-fg">{tamano(bytes)}</b> en disco</span>
            <span><b className="text-fg">{modelos}</b> {modelos === 1 ? "modelo" : "modelos"}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {lista.map((i) => (
              <div key={i.paquete} className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[11.5px] text-fg">{i.nombre}</span>
                    {i.completo
                      ? <span className="rounded-full bg-white/[.08] px-1.5 py-0.5 text-[9px] text-fg">firma verificada</span>
                      : <span className="rounded-full bg-warning/[.12] px-1.5 py-0.5 text-[9px] text-warning-fg">a medias</span>}
                  </div>
                  <p className="truncate font-mono text-[10px] text-subtle">
                    @{i.autor} · {i.teselas} teselas · {tamano(i.bytes)} · {i.modelo} {i.version}
                  </p>
                </div>
                <button onClick={() => void desinstalar(i.paquete)} disabled={borrando === i.paquete}
                  className="shrink-0 rounded border border-white/15 px-2 py-1 text-[10px] text-muted
                    hover:border-danger/40 hover:text-danger-fg disabled:opacity-40">
                  {borrando === i.paquete ? "borrando…" : "Desinstalar"}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {instalando && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={(e) => e.target === e.currentTarget && setInstalando(false)}>
          <InstallFlow token={token}
            onCerrar={() => setInstalando(false)}
            onInstalado={() => { setInstalando(false); cargar(); }} />
        </div>
      )}
    </div>
  );
}
