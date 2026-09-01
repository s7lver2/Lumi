import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { type EstadoActualizacionLumid, type EventoAdmin } from "../lib/api";
import { startAdminEvents } from "../lib/bridge";
import { Icon } from "../ui/Icon";
import type { Seccion } from "./Sidebar";

/** Mismo patrón que IndexToast: se monta una vez en AdminPanel para que
 *  navegar de sección no lo oculte. Un evento reemplaza al anterior — no
 *  hay cola de toasts, igual que IndexToast tampoco la tiene. Cubre las dos
 *  cosas que hoy llegan por `/v1/admin/events` (crédito y acceso): son el
 *  mismo canal y el mismo hueco en pantalla, así que es un solo componente
 *  que decide qué texto pintar según qué variante llegó, no dos toasts
 *  compitiendo por la misma esquina.
 *
 *  El progreso de actualización (#70) no llega por ese canal de eventos —
 *  es estado sondeado, no un evento puntual — así que se recibe aparte
 *  (`actualizacion`, elevado a `AdminPanel` para no duplicar el sondeo) y
 *  se pinta con el mismo hueco/estilo de toast cuando no hay ningún evento
 *  de verdad que mostrar y el admin no está ya viendo la pestaña. */
export function AdminEventToast({ token, onIr, actualizacion, enActualizaciones }: {
  token: string;
  onIr: (s: Seccion) => void;
  actualizacion: EstadoActualizacionLumid | null;
  enActualizaciones: boolean;
}) {
  const [ev, setEv] = useState<EventoAdmin | null>(null);
  const [cerrado, setCerrado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void startAdminEvents(token);
    const un = listen<EventoAdmin>("admin-events", (e) => {
      // Sin toast para esto: es una señal muda para la página de Cola, no
      // algo que el resto del panel deba anunciar.
      if (!vivo || e.payload === "ColaCambio") return;
      setCerrado(false);
      setEv(e.payload);
    });
    return () => { vivo = false; void un.then((f) => f()); };
  }, [token]);

  // El filtro en el listener ya descarta "ColaCambio" antes de `setEv`, pero
  // el tipo `EventoAdmin` sigue incluyendo ese string plano — se estrecha
  // aquí para que lo de abajo pueda usar `in` sobre las variantes objeto.
  if (!ev || cerrado || typeof ev === "string") {
    if (actualizacion?.aplicando && !enActualizaciones) {
      return (
        <div className="jg-press pointer-events-auto flex items-start gap-2.5 rounded-[11px] border border-white/[.14]
            bg-[rgba(20,22,26,.97)] p-[11px_12px] text-left shadow-lg shadow-black/40 backdrop-blur-xl"
          style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
          <button onClick={() => onIr("actualizaciones")} className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-1.5 text-[11.5px] text-fg">
              <Icon name="refresh" size={12} />
              Actualizando el servidor…
            </div>
            <div className="mt-0.5 truncate text-[9.5px] text-subtle">
              Si hay trabajo en curso, espera a que termine antes de reiniciar
            </div>
          </button>
        </div>
      );
    }
    return null;
  }

  const titulo = "SolicitudCredito" in ev
    ? `${ev.SolicitudCredito.username} pidió más cupo ${ev.SolicitudCredito.tipo}`
    : "SolicitudAcceso" in ev
    ? `${ev.SolicitudAcceso.display_name} pide una cuenta`
    : `Cliente en versión ${ev.SolicitudVersion.version_cliente} no pudo conectar`;
  const detalle = "SolicitudCredito" in ev
    ? `${ev.SolicitudCredito.valor_actual} → ${ev.SolicitudCredito.valor_propuesto}`
    : "SolicitudAcceso" in ev
    ? ev.SolicitudAcceso.message.slice(0, 48)
    : "actualiza el servidor para que pueda entrar";

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
