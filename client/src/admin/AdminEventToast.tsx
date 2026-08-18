import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { type EventoAdmin } from "../lib/api";
import { startAdminEvents } from "../lib/bridge";
import type { Seccion } from "./Sidebar";

/** Mismo patrón que IndexToast: se monta una vez en AdminPanel para que
 *  navegar de sección no lo oculte. Un evento reemplaza al anterior — no
 *  hay cola de toasts, igual que IndexToast tampoco la tiene. Cubre las dos
 *  cosas que hoy llegan por `/v1/admin/events` (crédito y acceso): son el
 *  mismo canal y el mismo hueco en pantalla, así que es un solo componente
 *  que decide qué texto pintar según qué variante llegó, no dos toasts
 *  compitiendo por la misma esquina. */
export function AdminEventToast({ token, onIr }: { token: string; onIr: (s: Seccion) => void }) {
  const [ev, setEv] = useState<EventoAdmin | null>(null);
  const [cerrado, setCerrado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void startAdminEvents(token);
    const un = listen<EventoAdmin>("admin-events", (e) => {
      if (!vivo) return;
      setCerrado(false);
      setEv(e.payload);
    });
    return () => { vivo = false; void un.then((f) => f()); };
  }, [token]);

  if (!ev || cerrado) return null;

  const titulo = "SolicitudCredito" in ev
    ? `${ev.SolicitudCredito.username} pidió más cupo ${ev.SolicitudCredito.tipo}`
    : `${ev.SolicitudAcceso.display_name} pide una cuenta`;
  const detalle = "SolicitudCredito" in ev
    ? `${ev.SolicitudCredito.valor_actual} → ${ev.SolicitudCredito.valor_propuesto}`
    : ev.SolicitudAcceso.message.slice(0, 48);

  return (
    <div className="jg-press pointer-events-auto flex items-start gap-2.5 rounded-[11px] border border-white/[.14]
        bg-[rgba(20,22,26,.97)] p-[11px_12px] text-left shadow-lg shadow-black/40 backdrop-blur-xl"
      style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
      <button onClick={() => onIr("solicitudes")} className="min-w-0 flex-1 text-left">
        <div className="text-[11.5px] text-fg">{titulo}</div>
        <div className="mt-0.5 truncate font-mono text-[9.5px] text-subtle">{detalle}</div>
      </button>
      <button onClick={() => setCerrado(true)} className="shrink-0 text-[11px] text-subtle hover:text-fg">✕</button>
    </div>
  );
}
