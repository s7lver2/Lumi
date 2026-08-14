import { useEffect, useState } from "react";
import { api, type TareaModelo } from "../lib/api";
import type { Seccion } from "./Sidebar";

export function ModelToasts({ token, onIr, licenciasPendientes }: {
  token: string;
  onIr: (s: Seccion) => void;
  /** Estado de ESTA sesión del panel (ModelosView lo levanta): no hay tarea
   *  todavía mientras la pantalla de licencias sigue abierta, así que no hay
   *  nada que el servidor pueda descubrir sobre esto. */
  licenciasPendientes: boolean;
}) {
  const [tarea, setTarea] = useState<TareaModelo | null>(null);

  useEffect(() => {
    let vivo = true;
    async function sondear() {
      try {
        const t = await api.get<TareaModelo | null>("/v1/admin/model-task", token);
        if (vivo) setTarea(t);
      } catch { /* red caída un instante: se reintenta en el próximo tick */ }
    }
    void sondear();
    const i = setInterval(sondear, 3000);
    return () => { vivo = false; clearInterval(i); };
  }, [token]);

  if (!tarea && !licenciasPendientes) return null;

  return (
    <>
      {tarea && (
        <button onClick={() => onIr("modelos")}
          className="jg-press pointer-events-auto flex items-start gap-2.5 rounded-[11px] border border-white/[.14]
            bg-[rgba(20,22,26,.97)] p-[11px_12px] text-left shadow-lg shadow-black/40 backdrop-blur-xl"
          style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-fg">Descargando modelos</div>
            <div className="mt-0.5 font-mono text-[9.5px] text-subtle">
              {tarea.item_actual ?? "…"}{tarea.pct != null ? ` · ${tarea.pct}%` : ""}
            </div>
            {tarea.pct != null && (
              <div className="mt-[7px] h-[3px] overflow-hidden rounded-sm bg-elevated">
                <div className="h-full bg-fg transition-[width] duration-500 ease-expo" style={{ width: `${tarea.pct}%` }} />
              </div>
            )}
            <div className="mt-2 text-[9.5px] text-draw-fg">ver progreso →</div>
          </div>
        </button>
      )}
      {licenciasPendientes && (
        <button onClick={() => onIr("modelos")}
          className="jg-press pointer-events-auto flex items-start gap-2.5 rounded-[11px] border border-white/[.14]
            bg-[rgba(20,22,26,.97)] p-[11px_12px] text-left shadow-lg shadow-black/40 backdrop-blur-xl"
          style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-fg">Hay licencias por aceptar</div>
            <div className="mt-0.5 text-[9.5px] text-subtle">La descarga no sigue sin esto.</div>
            <div className="mt-2 text-[9.5px] text-draw-fg">revisar licencias →</div>
          </div>
        </button>
      )}
    </>
  );
}
