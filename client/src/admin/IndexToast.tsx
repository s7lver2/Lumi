import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { type ProgresoInstalacion } from "../lib/api";
import { startIndicesEvents } from "../lib/bridge";
import type { Seccion } from "./Sidebar";

/** Igual que ModelToasts: se monta una vez en AdminPanel, no dentro de
 *  Índices, para que instalar un índice y navegar a otra sección no lo
 *  esconda de la vista. `app.indices_en_curso` en el servidor es una única
 *  fotografía — si ya hay una instalación en marcha al abrir el puente,
 *  la primera línea SSE la trae de vuelta sin que haga falta pedirla aparte. */
export function IndexToast({ token, onIr }: { token: string; onIr: (s: Seccion) => void }) {
  const [progreso, setProgreso] = useState<ProgresoInstalacion | null>(null);
  const [cerrado, setCerrado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void startIndicesEvents(token);
    const un = listen<ProgresoInstalacion>("indices-progress", (e) => {
      if (!vivo) return;
      setCerrado(false);
      setProgreso(e.payload);
    });
    return () => { vivo = false; void un.then((f) => f()); };
  }, [token]);

  if (!progreso || cerrado) return null;

  // Fracción del asset EN CURSO, no solo "hechos/total" — para un paquete
  // de un único asset grande, hechos/total se queda en 0 hasta que termina
  // entero; sumar la fracción de bytes del asset actual es lo que hace que
  // la barra avance de verdad mientras se descarga.
  const fraccionAssetActual =
    progreso.asset_bytes_total > 0 ? progreso.asset_bytes_hechos / progreso.asset_bytes_total : 0;
  const pct =
    progreso.total > 0
      ? Math.round(((progreso.hechos + fraccionAssetActual) / progreso.total) * 100)
      : 0;
  const fallo = progreso.terminado && !!progreso.error;

  return (
    <div className="jg-press pointer-events-auto flex items-start gap-2.5 rounded-[11px] border border-white/[.14]
        bg-[rgba(20,22,26,.97)] p-[11px_12px] text-left shadow-lg shadow-black/40 backdrop-blur-xl"
      style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
      <button onClick={() => onIr("indices")} className="min-w-0 flex-1 text-left">
        <div className="text-[11px] text-fg">
          {progreso.terminado
            ? (fallo ? "La instalación falló" : "Índice instalado")
            : `Instalando ${progreso.paquete || "índice"}`}
        </div>
        <div className="mt-0.5 truncate font-mono text-[9.5px] text-subtle">
          {fallo ? progreso.error : `${progreso.asset || "…"} · ${pct}%`}
        </div>
        {!fallo && (
          <div className="mt-[7px] h-[3px] overflow-hidden rounded-sm bg-elevated">
            <div className="h-full bg-fg transition-[width] duration-500 ease-expo" style={{ width: `${pct}%` }} />
          </div>
        )}
        {!progreso.terminado && <div className="mt-2 text-[9.5px] text-draw-fg">ver progreso →</div>}
      </button>
      {progreso.terminado && (
        <button onClick={() => setCerrado(true)} className="shrink-0 text-[11px] text-subtle hover:text-fg">
          ✕
        </button>
      )}
    </div>
  );
}
