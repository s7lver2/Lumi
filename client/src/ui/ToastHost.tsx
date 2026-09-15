import { useEffect } from "react";
import { useToasts, type Toast } from "../lib/toasts";
import { Icon } from "./Icon";

/** Cola de notificaciones global -- mismo idioma visual que
 *  `ModelToasts`/`IndexToast` (panel de admin), pero montada una vez en
 *  `App.tsx` para que cualquier pantalla, no solo admin, pueda ofrecer
 *  "falta instalar X" (`ofrecerInstalarModelo`, `lib/toasts.ts`). Esquina
 *  contraria a la de admin (bottom-4 LEFT) para no solaparse si algún día
 *  coinciden en pantalla. */
export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[70] flex flex-col gap-2.5" style={{ width: 320 }}>
      {toasts.map((t) => <ToastCard key={t.id} toast={t} />)}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const cerrar = useToasts((s) => s.cerrar);

  useEffect(() => {
    if (toast.duracionMs == null) return;
    const t = setTimeout(() => cerrar(toast.id), toast.duracionMs);
    return () => clearTimeout(t);
  }, [toast.id, toast.duracionMs, cerrar]);

  return (
    <div className="pointer-events-auto flex items-start gap-2.5 rounded-[11px] border border-white/[.14]
        bg-[rgba(20,22,26,.97)] p-[11px_12px] shadow-lg shadow-black/40 backdrop-blur-xl"
      style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-fg">{toast.titulo}</div>
        {toast.detalle && <div className="mt-0.5 font-mono text-[9.5px] text-subtle">{toast.detalle}</div>}
        {toast.acciones.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {toast.acciones.map((a) => (
              <button key={a.label} onClick={a.onClick}
                className="jg-press text-[9.5px] text-draw-fg hover:text-fg">
                {a.label} →
              </button>
            ))}
          </div>
        )}
      </div>
      <button onClick={() => cerrar(toast.id)} aria-label="Cerrar"
        className="jg-press shrink-0 text-subtle hover:text-fg">
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}
