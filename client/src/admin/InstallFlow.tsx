import { useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { api, type ProgresoInstalacion } from "../lib/api";
import { startIndicesEvents } from "../lib/bridge";
import { InstallDialog } from "../work/InstallDialog";

const KB = 1024;
function tamano(bytes: number): string {
  if (bytes < KB * KB) return `${(bytes / KB).toFixed(0)} KB`;
  if (bytes < KB * KB * KB) return `${(bytes / KB / KB).toFixed(1)} MB`;
  return `${(bytes / KB / KB / KB).toFixed(2)} GB`;
}

/** Pega la URL de una ficha, resuelve su grafo con `InstallDialog` y, al
 *  confirmar, lanza la instalación y sigue su progreso por SSE — el mismo
 *  puente que el cliente ya usa para `/v1/queue/events`.
 *
 *  Firma inválida: el error del endpoint (que `InstallDialog` ya enseña tal
 *  cual) para aquí, sin botón de continuar. Dependencia caída: el aviso ámbar
 *  de `InstallDialog` y el botón pasa a decir "Instalar sin esa zona" —
 *  ninguno de los dos casos se suaviza. */
export function InstallFlow({ token, onCerrar, onInstalado }: {
  token: string;
  onCerrar: () => void;
  onInstalado: () => void;
}) {
  const [url, setUrl] = useState("");
  const [pedido, setPedido] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<ProgresoInstalacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    if (!pedido) return;
    try {
      await api.post("/v1/indices", { url: pedido }, token);
    } catch (e) {
      setError(String(e));
      return;
    }
    setProgreso({
      paquete: "", asset: "", hechos: 0, total: 1,
      asset_bytes_hechos: 0, asset_bytes_total: 0,
      registro: [], terminado: false, error: null, rotas: [],
    });
    await startIndicesEvents(token);
    let cerrado = false;
    const un = await listen<ProgresoInstalacion>("indices-progress", (e) => {
      setProgreso(e.payload);
      if (e.payload.terminado) {
        cerrado = true;
        un();
        if (!e.payload.error) onInstalado();
      }
    });
    // Si el flujo se corta sin haber llegado a `terminado`, la barra se
    // quedaría quieta indefinidamente y no habría forma de saber por qué —
    // era exactamente el falso "se ha colgado la instalación". El daemon
    // sigue instalando por su cuenta; lo que se ha perdido es el progreso,
    // y eso es lo que hay que decir.
    const unCaido = await listen<string>("indices-down", (e) => {
      if (cerrado) return;
      cerrado = true;
      un();
      unCaido();
      setProgreso((p) => p && {
        ...p,
        terminado: true,
        error: e.payload
          ? `se perdió el progreso de la instalación: ${e.payload}. El servidor sigue por su cuenta; vuelve a abrir esta ventana para ver cómo acabó`
          : "se perdió el progreso de la instalación. El servidor sigue por su cuenta; vuelve a abrir esta ventana para ver cómo acabó",
      });
    });
  }

  if (progreso) {
    // Fracción del asset EN CURSO, no solo "hechos/total" — para un
    // paquete de un único asset grande, hechos/total se queda en 0 hasta
    // que termina entero; sumar la fracción de bytes del asset actual es
    // lo que hace que la barra avance de verdad mientras se descarga.
    const fraccionAssetActual =
      progreso.asset_bytes_total > 0 ? progreso.asset_bytes_hechos / progreso.asset_bytes_total : 0;
    const pct =
      progreso.total > 0
        ? Math.round(((progreso.hechos + fraccionAssetActual) / progreso.total) * 100)
        : 0;
    return (
      <div className="w-[480px] rounded-2xl border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
        <p className="text-sm text-white">
          {progreso.terminado ? (progreso.error ? "La instalación falló" : "Instalado") : "Instalando…"}
        </p>
        <p className="mt-1 font-mono text-[10.5px] text-white/50">
          {progreso.paquete}{progreso.asset ? ` · ${progreso.asset}` : ""}
          {progreso.asset_bytes_total > 0
            ? ` · ${tamano(progreso.asset_bytes_hechos)} / ${tamano(progreso.asset_bytes_total)}`
            : ""}
        </p>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-[#378add] transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 flex max-h-[160px] flex-col gap-1 overflow-y-auto font-mono text-[10.5px] text-white/45">
          {progreso.registro.map((l, i) => <p key={i}>{l}</p>)}
        </div>
        {progreso.error && <p className="mt-2 text-[11px] text-[#e8705f]">{progreso.error}</p>}
        {progreso.terminado && (
          <div className="mt-4 flex justify-end">
            <button onClick={onCerrar}
              className="rounded-lg border border-white/15 px-3.5 py-2 text-[11.5px] text-white/70">
              Cerrar
            </button>
          </div>
        )}
      </div>
    );
  }

  if (pedido) {
    return (
      <InstallDialog url={pedido} token={token}
        onCerrar={() => setPedido(null)}
        onConfirm={() => void confirmar()} />
    );
  }

  return (
    <div className="w-[420px] rounded-2xl border border-white/[.13] bg-[rgba(16,19,25,.66)] p-[20px_22px] backdrop-blur-xl">
      <p className="text-sm text-white">Instalar del catálogo</p>
      <p className="mt-1 text-[11px] leading-relaxed text-white/50">
        Pega la URL de la <span className="font-mono text-white/70">ficha.json</span> del índice.
      </p>
      <input value={url} onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…/ficha.json"
        className="mt-3 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 font-mono text-[11px] text-white
          outline-none focus:border-white/35" />
      {error && <p className="mt-2 text-[11px] text-[#e8705f]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCerrar} className="rounded-lg border border-white/15 px-3.5 py-2 text-[11.5px] text-white/70">
          Cancelar
        </button>
        <button onClick={() => url.trim() && setPedido(url.trim())} disabled={!url.trim()}
          className="rounded-lg bg-[#378add] px-3.5 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
          Continuar
        </button>
      </div>
    </div>
  );
}
