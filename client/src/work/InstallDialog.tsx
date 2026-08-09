import { useEffect, useState } from "react";

import { api } from "../lib/api";

export interface Nodo {
  paquete: string; autor: string; url: string; sha256: string;
  bytes: number; quadkeys: number; profundidad: number; roto: boolean;
}
export interface Grafo {
  nodos: Nodo[]; bytes_total: number; quadkeys_total: number; rotas: string[];
}

const KB = 1024;
function tamano(bytes: number): string {
  if (bytes < KB * KB) return `${(bytes / KB).toFixed(0)} KB`;
  if (bytes < KB * KB * KB) return `${(bytes / KB / KB).toFixed(1)} MB`;
  return `${(bytes / KB / KB / KB).toFixed(2)} GB`;
}

/** Instalar es descargar un grafo, y ese grafo ES el árbol de «hecho con la
 *  colaboración de»: no se construye aparte.
 *
 *  Cada firma se comprueba al abrir. Una dependencia rota no aborta la
 *  instalación —se instala lo que hay y se dice qué falta—, pero una firma que
 *  no cuadra sí: no hay «instalar igualmente». */
export function InstallDialog({ url, token, onCerrar }: {
  url: string; token?: string; onCerrar: () => void;
}) {
  const [grafo, setGrafo] = useState<Grafo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<Grafo>(`/v1/catalogo/grafo?url=${encodeURIComponent(url)}`, token)
      .then(setGrafo, (e) => setError(String(e)));
  }, [url, token]);

  const personas = new Set(grafo?.nodos.map((n) => n.autor)).size;

  return (
    <div className="w-[480px] rounded-2xl border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <p className="text-sm text-white">Instalar índice</p>

      {error && <p className="mt-3 text-[11px] leading-relaxed text-[#e8705f]">{error}</p>}

      {grafo && (
        <>
          <div className="mt-3 flex flex-col gap-1">
            {grafo.nodos.map((n, i) => (
              <div key={n.paquete} className="flex items-center gap-2 text-[11px]"
                style={{ paddingLeft: n.profundidad * 14, animation: `fade .3s ${i * 40}ms both` }}>
                <span className="font-mono text-[10px] text-white/40">
                  {n.profundidad > 0 ? "└─" : "●"}
                </span>
                <span className="flex-1 text-white">{n.paquete}</span>
                <span className="font-mono text-[10px] text-white/45">
                  {n.autor} · {n.quadkeys} teselas · {tamano(n.bytes)}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px]">
            <span className="text-white/60">
              {grafo.nodos.length} paquetes de {personas} {personas === 1 ? "persona" : "personas"}
            </span>
            <span className="font-mono text-white">{tamano(grafo.bytes_total)}</span>
          </div>

          {grafo.rotas.length > 0 && (
            <div className="mt-3 rounded-xl border border-[#ef9f27]/40 bg-[#ef9f27]/[.07] p-3">
              <p className="text-[11px] text-[#ef9f27]">
                {grafo.rotas.length === 1 ? "Una dependencia ya no existe" : `${grafo.rotas.length} dependencias ya no existen`}
              </p>
              <p className="mt-1 font-mono text-[10px] text-white/50">{grafo.rotas.join(", ")}</p>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-white/60">
                El índice sirve igual, incompleto y honesto: se instala lo que hay.
              </p>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onCerrar}
              className="rounded-lg border border-white/15 px-3.5 py-2 text-[11.5px] text-white/70">
              Cancelar
            </button>
            <button
              className="rounded-lg bg-[#378add] px-3.5 py-2 text-[11.5px] font-medium text-black">
              {grafo.rotas.length > 0 ? "Instalar sin esa zona" : "Instalar"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
