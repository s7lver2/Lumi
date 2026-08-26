import { useEffect, useState } from "react";
import { api, type EstadoActualizacionLumid } from "../lib/api";
import { Icon } from "../ui/Icon";
import { Seccion } from "./AdminPanel";

/** Sondeo cada 4s mientras la pestaña está abierta — sin canal en vivo
 *  dedicado (ver el techo anotado en el plan). Suficiente para ver avanzar
 *  "esperando cola" → "reiniciando" sin que el owner tenga que refrescar a
 *  mano. */
const INTERVALO_MS = 4000;

export function ActualizacionesView({ token }: { token: string }) {
  const [estado, setEstado] = useState<EstadoActualizacionLumid | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [comprobando, setComprobando] = useState(false);

  useEffect(() => {
    let vivo = true;
    const tick = () =>
      api.get<EstadoActualizacionLumid>("/v1/admin/actualizacion", token)
        .then((e) => { if (vivo) setEstado(e); })
        .catch(() => { /* la próxima vez que responda, se actualiza — no hay nada que mostrar por un fallo de sondeo suelto */ });
    tick();
    const t = setInterval(tick, INTERVALO_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [token]);

  async function comprobarAhora() {
    setComprobando(true);
    try {
      setEstado(await api.post<EstadoActualizacionLumid>("/v1/admin/actualizacion/comprobar", {}, token));
    } finally {
      setComprobando(false);
    }
  }

  async function actualizarServidor() {
    setAplicando(true);
    await api.post("/v1/admin/actualizacion/aplicar", {}, token);
    // No hay nada más que hacer aquí: el propio servidor va a caer y volver
    // (o a quedarse en mantenimiento esperando la cola) — el sondeo de
    // arriba, no esta llamada, es lo que refleja el progreso.
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
              disabled={!estado.disponible || aplicando}
              className="jg-press rounded-lg bg-accent px-3 py-1.5 text-[11.5px] font-medium text-black disabled:opacity-40"
            >
              {aplicando ? "Actualizando…" : "Actualizar servidor"}
            </button>
            <button
              onClick={() => void comprobarAhora()}
              disabled={comprobando}
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
