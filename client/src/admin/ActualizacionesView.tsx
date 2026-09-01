import { useEffect, useState } from "react";
import { api, type EstadoActualizacionLumid } from "../lib/api";
import { Icon } from "../ui/Icon";
import { Seccion } from "./AdminPanel";

/** El sondeo (cada 4s, sin canal en vivo dedicado — ver el techo anotado en
 *  el plan) vive ahora en `AdminPanel`, no aquí: así `AdminEventToast`
 *  también puede leer el mismo estado para avisar del progreso aunque el
 *  admin esté en otra pestaña (#70), sin sondear el endpoint dos veces. */
export function ActualizacionesView({ token, estado, onEstado }: {
  token: string;
  estado: EstadoActualizacionLumid | null;
  onEstado: (e: EstadoActualizacionLumid) => void;
}) {
  // Flag optimista: se pone a `true` en el clic, solo para deshabilitar los
  // botones al instante sin esperar al próximo sondeo. La fuente de verdad
  // es siempre `estado.aplicando` (backend) — en cuanto el sondeo confirma
  // que el backend ya no está aplicando nada (terminó, falló o hizo
  // timeout), este flag se reconcilia con esa realidad, así nunca se queda
  // pegado en "Actualizando…" (#69).
  const [aplicandoLocal, setAplicandoLocal] = useState(false);
  const [comprobando, setComprobando] = useState(false);
  const aplicando = aplicandoLocal || Boolean(estado?.aplicando);
  useEffect(() => {
    if (estado && !estado.aplicando) setAplicandoLocal(false);
  }, [estado]);

  async function comprobarAhora() {
    setComprobando(true);
    try {
      onEstado(await api.post<EstadoActualizacionLumid>("/v1/admin/actualizacion/comprobar", {}, token));
    } finally {
      setComprobando(false);
    }
  }

  async function actualizarServidor() {
    setAplicandoLocal(true);
    await api.post("/v1/admin/actualizacion/aplicar", {}, token);
    // No hay nada más que hacer aquí: el propio servidor va a caer y volver
    // (o a quedarse en mantenimiento esperando la cola) — el sondeo que
    // vive en AdminPanel, no esta llamada, es lo que refleja el progreso.
  }

  return (
    <Seccion titulo="Actualizaciones" grupo="Operación">
      {!estado && <p className="text-[11px] text-muted">Cargando…</p>}
      {estado && (
        <div className="rounded-card border border-border bg-panel p-[16px_18px]">
          <div className="flex flex-wrap gap-11">
            <Campo etiqueta="Instalada" valor={estado.version_instalada} />
            {estado.disponible && <Campo etiqueta="Disponible" valor={estado.disponible.version} nueva />}
          </div>

          {estado.retirada && (
            <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-warning-fg">
              <Icon name="alert" size={13} />
              Tu versión instalada fue retirada. Actualiza en cuanto puedas.
            </p>
          )}

          {estado.error && (
            <p className="mt-3 text-[11.5px] text-subtle">No se pudo comprobar: {estado.error}</p>
          )}

          {estado.disponible && (
            <p className="mt-3 whitespace-pre-wrap text-[12px] text-muted">{estado.disponible.notas}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => void actualizarServidor()}
              disabled={!estado.disponible || aplicando || comprobando}
              className="jg-press rounded-lg bg-accent px-3 py-1.5 text-[11.5px] font-medium text-black disabled:opacity-40"
            >
              {aplicando ? "Actualizando…" : "Actualizar servidor"}
            </button>
            <button
              onClick={() => void comprobarAhora()}
              disabled={comprobando || aplicando}
              className="jg-press rounded-lg border border-white/15 px-3 py-1.5 text-[11.5px] text-fg disabled:opacity-40"
            >
              {comprobando ? "Comprobando…" : "Comprobar ahora"}
            </button>
          </div>

          {aplicando && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-draw-fg">
              <Icon name="refresh" size={12} />
              Aplicando — si hay trabajo en curso, el servidor espera a que termine antes de reiniciar.
            </p>
          )}
        </div>
      )}
    </Seccion>
  );
}

function Campo({ etiqueta, valor, nueva }: { etiqueta: string; valor: string; nueva?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-subtle">{etiqueta}</span>
      <span className={`font-mono text-[17px] tabular-nums ${nueva ? "text-fg" : "text-fg"}`}>{valor}</span>
    </div>
  );
}
