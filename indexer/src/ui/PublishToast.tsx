import { useEffect, useRef, useState } from "react";

import { descartar, estadoActual, suscribir, type EstadoPublicacion } from "../publish/publishTracker";
import { Icon } from "./Icon";

/** Un aviso de que algo sigue subiendo en segundo plano, con independencia de
 *  qué pantalla esté abierta ahora mismo — cerrar el diálogo de publicar no
 *  para el trabajo, y sin este aviso no había forma de volver a encontrarlo.
 *  Se queda unos segundos tras terminar y luego se retira solo; cerrarlo a
 *  mano en cualquier momento también vale. */
export function PublishToast({ onAbrir }: { onAbrir: (indiceId: number) => void }) {
  const [estado, setEstado] = useState<EstadoPublicacion | null>(estadoActual());
  const cierreAutomatico = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => suscribir(setEstado), []);

  useEffect(() => {
    if (cierreAutomatico.current) { clearTimeout(cierreAutomatico.current); cierreAutomatico.current = null; }
    if (estado?.progreso.terminado) {
      cierreAutomatico.current = setTimeout(descartar, 5000);
    }
    return () => { if (cierreAutomatico.current) clearTimeout(cierreAutomatico.current); };
  }, [estado]);

  if (!estado) return null;
  const { progreso } = estado;
  const pct = progreso.total > 0 ? (progreso.hechos / progreso.total) * 100 : 0;

  return (
    <button
      onClick={() => onAbrir(estado.indiceId)}
      className="jg-press fixed bottom-4 right-4 z-[70] w-[300px] rounded-lg border border-white/[.13]
        bg-[rgba(16,19,25,.92)] p-3 text-left shadow-lg shadow-black/40 backdrop-blur-xl"
      style={{ animation: "jg-fade-rise .28s cubic-bezier(.16,1,.3,1) both" }}
    >
      <div className="flex items-center gap-2">
        {progreso.terminado
          ? <Icon name={progreso.error ? "alert" : "check"} size={12} className={progreso.error ? "text-danger-fg" : "text-fg"} />
          : <Icon name="spinner" size={12} className="animate-spin text-subtle" />}
        <span className="flex-1 truncate text-[11.5px] text-fg">
          {progreso.error ? "No se pudo publicar" : progreso.terminado ? "Publicado" : `Publicando «${estado.nombre}»`}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); descartar(); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); descartar(); } }}
          className="shrink-0 text-subtle hover:text-fg"
        >
          <Icon name="x" size={11} />
        </span>
      </div>
      {!progreso.terminado && (
        <>
          <span className="mt-2 block h-1 overflow-hidden rounded-[2px] bg-elevated">
            <i className="block h-full bg-fg transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </span>
          <p className="mt-1.5 truncate font-mono text-[9.5px] text-subtle">
            {progreso.asset || "preparando…"} · {progreso.hechos}/{progreso.total}
          </p>
        </>
      )}
      {progreso.error && <p className="mt-1.5 text-[10px] leading-relaxed text-danger-fg">{progreso.error}</p>}
    </button>
  );
}
