import { useEffect, useState } from "react";
import { api, type EstadoActualizacionLumid, type PublicacionHistorial } from "../lib/api";
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

  // Historial de versiones (#71): se pide bajo demanda al abrir el bloque,
  // no en el sondeo de cada 4s — es una lista que casi nunca cambia y
  // solo hace falta cuando el admin quiere instalar algo que no sea "la
  // última".
  const [verHistorial, setVerHistorial] = useState(false);
  const [historial, setHistorial] = useState<PublicacionHistorial[] | null>(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [errorHistorial, setErrorHistorial] = useState<string | null>(null);
  // Qué versión concreta se está instalando ahora mismo, para que el botón
  // de esa fila (y no todas) diga "Instalando…" — `aplicando` (backend)
  // sigue siendo la fuente de verdad de si hay algo en curso en general.
  const [versionObjetivo, setVersionObjetivo] = useState<string | null>(null);

  useEffect(() => {
    if (!verHistorial || historial || cargandoHistorial) return;
    setCargandoHistorial(true);
    api.get<PublicacionHistorial[]>("/v1/admin/actualizacion/historial", token)
      .then(setHistorial)
      .catch((e) => setErrorHistorial(String(e)))
      .finally(() => setCargandoHistorial(false));
  }, [verHistorial, historial, cargandoHistorial, token]);

  async function comprobarAhora() {
    setComprobando(true);
    try {
      onEstado(await api.post<EstadoActualizacionLumid>("/v1/admin/actualizacion/comprobar", {}, token));
    } finally {
      setComprobando(false);
    }
  }

  async function aplicarVersion(version?: string) {
    setVersionObjetivo(version ?? null);
    setAplicandoLocal(true);
    await api.post("/v1/admin/actualizacion/aplicar", version ? { version } : {}, token);
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
              onClick={() => void aplicarVersion()}
              disabled={!estado.disponible || aplicando || comprobando}
              className="jg-press rounded-lg bg-accent px-3 py-1.5 text-[11.5px] font-medium text-black disabled:opacity-40"
            >
              {aplicando && versionObjetivo === null ? "Actualizando…" : "Actualizar servidor"}
            </button>
            <button
              onClick={() => void comprobarAhora()}
              disabled={comprobando || aplicando}
              className="jg-press rounded-lg border border-white/15 px-3 py-1.5 text-[11.5px] text-fg disabled:opacity-40"
            >
              {comprobando ? "Comprobando…" : "Comprobar ahora"}
            </button>
            <button
              onClick={() => setVerHistorial((v) => !v)}
              className="jg-press ml-auto rounded-lg px-2.5 py-1.5 text-[11px] text-subtle hover:text-fg"
            >
              {verHistorial ? "Ocultar historial de versiones" : "Ver historial de versiones"}
            </button>
          </div>

          {aplicando && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-draw-fg">
              <Icon name="refresh" size={12} />
              {versionObjetivo
                ? `Instalando ${versionObjetivo}`
                : "Aplicando"} — si hay trabajo en curso, el servidor espera a que termine antes de reiniciar.
            </p>
          )}

          <div className="grid transition-[grid-template-rows] duration-[420ms] ease-expo"
            style={{ gridTemplateRows: verHistorial ? "1fr" : "0fr" }}>
            <div className="overflow-hidden">
              <div className="mt-4 border-t border-border pt-3">
                {cargandoHistorial && <p className="text-[11px] text-muted">Cargando historial…</p>}
                {errorHistorial && <p className="text-[11px] text-subtle">No se pudo cargar: {errorHistorial}</p>}
                {historial && historial.length === 0 && (
                  <p className="text-[11px] text-muted">Sin publicaciones en el canal.</p>
                )}
                {historial && historial.length > 0 && (
                  <ul className="flex flex-col divide-y divide-border">
                    {historial.map((p) => {
                      const instalada = p.version === estado.version_instalada;
                      const instalandoEsta = aplicando && versionObjetivo === p.version;
                      return (
                        <li key={p.version} className="flex items-center gap-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[12px] text-fg">{p.version}</span>
                              {instalada && <span className="text-[9.5px] uppercase tracking-[.06em] text-subtle">instalada</span>}
                              {p.retirada && (
                                <span className="flex items-center gap-1 text-[9.5px] uppercase tracking-[.06em] text-warning-fg">
                                  <Icon name="alert" size={10} /> retirada
                                </span>
                              )}
                            </div>
                            {p.notas && <p className="mt-0.5 truncate text-[10.5px] text-muted">{p.notas}</p>}
                          </div>
                          <button
                            onClick={() => void aplicarVersion(p.version)}
                            disabled={instalada || p.retirada || aplicando || comprobando}
                            className="jg-press shrink-0 rounded-lg border border-white/15 px-2.5 py-1 text-[10.5px] text-fg disabled:opacity-40"
                          >
                            {instalandoEsta ? "Instalando…" : "Instalar esta versión"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
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
