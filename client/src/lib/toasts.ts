import { create } from "zustand";
import { api, type TareaModelo } from "./api";
import { useServer } from "./store";

/** Un fallo que se sabe viene de "falta instalar X" (`Analysis.falta_modelo`)
 *  en vez de texto libre a secas -- lanzarlo en vez de un `Error` normal es
 *  lo que le permite a quien lo atrapa (`ImageEditorPopup`, el popup de
 *  agentes...) ofrecer la instalación sin tener que adivinar del mensaje. */
export class FaltaModeloError extends Error {
  modeloId: string;
  constructor(modeloId: string, message: string) {
    super(message);
    this.name = "FaltaModeloError";
    this.modeloId = modeloId;
  }
}

export interface ToastAccion {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  titulo: string;
  detalle?: string;
  acciones: ToastAccion[];
  /** Se cierra solo pasado este tiempo. `undefined` = se queda hasta que el
   *  usuario lo cierre o una acción lo reemplace. */
  duracionMs?: number;
}

interface ToastState {
  toasts: Toast[];
  mostrar: (t: Omit<Toast, "id" | "acciones"> & { acciones?: ToastAccion[] }) => string;
  actualizar: (id: string, cambios: Partial<Omit<Toast, "id">>) => void;
  cerrar: (id: string) => void;
}

/** Cola de notificaciones transitorias, global a toda la app -- no solo al
 *  panel de admin, a diferencia de `ModelToasts`/`IndexToast` (que son su
 *  propio patrón, ad hoc, montado solo dentro de `AdminPanel`). Un usuario
 *  normal (no admin) también puede toparse con "falta instalar X" desde el
 *  editor de imagen o un agente, y merece enterarse igual. */
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  mostrar: (t) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { acciones: [], ...t, id }] }));
    return id;
  },
  actualizar: (id, cambios) => set((s) => ({
    toasts: s.toasts.map((x) => (x.id === id ? { ...x, ...cambios } : x)),
  })),
  cerrar: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** El caso concreto que motivó la cola: un análisis (agente o upscaler)
 *  terminó en error porque falta instalar un motor (`Analysis.falta_modelo`,
 *  `crates/lumi-proto/src/worker.rs::Msg::Fallo::falta_modelo`). Un admin ve
 *  un botón para lanzar la descarga ahora mismo, en segundo plano, sin salir
 *  de donde está; alguien sin permisos solo se entera de qué hace falta y a
 *  quién pedírselo -- `POST /v1/admin/models/download` es admin-only
 *  (`crates/lumid/src/routes/models.rs`), no hay atajo posible para él. */
export function ofrecerInstalarModelo(modeloId: string, motivo: string) {
  const { token, isAdmin } = useServer.getState();
  const id = useToasts.getState().mostrar({
    titulo: `Falta instalar "${modeloId}"`,
    detalle: motivo,
    acciones: isAdmin && token
      ? [{ label: "Instalar en segundo plano", onClick: () => void instalar(id, modeloId, token) }]
      : [{ label: "Pide a un administrador que lo instale", onClick: () => useToasts.getState().cerrar(id) }],
  });
}

async function instalar(id: string, modeloId: string, token: string) {
  const { actualizar, cerrar } = useToasts.getState();
  actualizar(id, { titulo: `Instalando "${modeloId}"…`, detalle: "Empezando…", acciones: [] });
  try {
    await api.post(`/v1/admin/models/download`, { items: [modeloId] }, token);
  } catch (e) {
    // P.ej. "modo guía, no se puede pedir aquí" si al registro le falta la
    // URL del peso -- un error real y útil, no uno que ocultar.
    actualizar(id, { titulo: `No se pudo instalar "${modeloId}"`, detalle: String(e), duracionMs: 8000 });
    setTimeout(() => cerrar(id), 8000);
    return;
  }
  // Mismo endpoint de sondeo que `ModelToasts` (panel de admin): sin SSE,
  // cada 3s hasta que la tarea deja de estar `running` (o desaparece).
  const t = setInterval(async () => {
    try {
      const tarea = await api.get<TareaModelo | null>("/v1/admin/model-task", token);
      if (!tarea) {
        clearInterval(t);
        actualizar(id, { titulo: `"${modeloId}" instalado`, detalle: "Listo -- ya se puede usar.", duracionMs: 5000 });
        setTimeout(() => cerrar(id), 5000);
        return;
      }
      actualizar(id, { detalle: tarea.pct != null ? `${tarea.item_actual ?? modeloId} · ${tarea.pct}%` : "Descargando…" });
    } catch {
      clearInterval(t);
    }
  }, 3000);
}
