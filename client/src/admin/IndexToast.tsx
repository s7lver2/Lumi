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

  useEffect(() => {
    let vivo = true;
    void startIndicesEvents(token);
    const un = listen<ProgresoInstalacion>("indices-progress", (e) => {
      if (!vivo) return;
      setProgreso(e.payload.terminado ? null : e.payload);
    });
    return () => { vivo = false; void un.then((f) => f()); };
  }, [token]);

  if (!progreso) return null;

  const pct = progreso.total > 0 ? Math.round((progreso.hechos / progreso.total) * 100) : 0;

  return (
    <button onClick={() => onIr("indices")}
      className="jg-press pointer-events-auto flex items-start gap-2.5 rounded-[11px] border border-white/[.14]
        bg-[rgba(20,22,26,.97)] p-[11px_12px] text-left shadow-lg shadow-black/40 backdrop-blur-xl"
      style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-fg">Instalando {progreso.paquete || "índice"}</div>
        <div className="mt-0.5 truncate font-mono text-[9.5px] text-subtle">
          {progreso.asset || "…"} · {pct}%
        </div>
        <div className="mt-[7px] h-[3px] overflow-hidden rounded-sm bg-elevated">
          <div className="h-full bg-fg transition-[width] duration-500 ease-expo" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 text-[9.5px] text-draw-fg">ver progreso →</div>
      </div>
    </button>
  );
}
