import { useState } from "react";
import {
  comprobarActualizacion, dispararActualizacionAVersion, dispararActualizacionSilenciosa,
  historialActualizaciones, type EstadoActualizacion, type PublicacionInfo,
} from "../lib/actualizaciones";
import { Icon } from "../ui/Icon";

/** El bloque de "comprobar actualizaciones" — mismo mecanismo que
 *  `client/src/settings/ActualizacionesSeccion.tsx`, adaptado al Indexer:
 *  la versión propia no se pide con un comando aparte (el Indexer ya la
 *  tiene en `saludo`, pedida una vez al arrancar), así que llega por prop. */
export function ActualizacionesPanel({ version }: { version: string }) {
  const [estado, setEstado] = useState<EstadoActualizacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comprobando, setComprobando] = useState(false);
  // `comprobarActualizacion()` devuelve `null` tanto si nunca se ha llamado
  // como si ya se llamó y no hay nada nuevo — sin esto, comprobar y no
  // encontrar nada se veía exactamente igual que no haber comprobado nunca,
  // y el botón parecía no hacer nada.
  const [comprobado, setComprobado] = useState(false);
  const [aplicando, setAplicando] = useState(false);

  async function comprobarAhora() {
    setComprobando(true);
    setError(null);
    try {
      setEstado(await comprobarActualizacion());
      setComprobado(true);
    } catch (e) {
      setEstado(null);
      setError(String(e));
    } finally {
      setComprobando(false);
    }
  }

  // Si sale bien, la app se cierra sola dentro del comando de Rust — nunca
  // llega a este `catch`. Si sale mal (no encuentra installer.exe junto a
  // sí misma, sin permisos de escritura...), antes se perdía: el botón
  // descartaba la promesa con `void` sin capturar el rechazo, así que un
  // fallo no mostraba nada y parecía que "no ocurría nada" al pulsar.
  async function actualizarAhora(versionNueva: string) {
    setAplicando(true);
    setError(null);
    try {
      await dispararActualizacionSilenciosa(versionNueva);
    } catch (e) {
      setError(String(e));
      setAplicando(false);
    }
  }

  return (
    <div className="rounded-card border border-border bg-panel p-[13px_16px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[8.5px] uppercase tracking-[.15em] text-subtle">Lumi Indexer</span>
      </div>
      {estado?.tipo === "disponible" && (
        <p className="text-[11px] text-draw-fg">Versión {estado.version} disponible — {estado.notas}</p>
      )}
      {estado?.tipo === "retirada" && (
        <p className="text-[11px] text-warning-fg">Tu versión fue retirada. Actualiza en cuanto puedas.</p>
      )}
      {!estado && !error && !comprobando && (
        <p className="text-[11px] text-muted">
          {comprobado ? "Ya tienes la última versión." : "Sin comprobar en esta sesión."}
        </p>
      )}
      {error && <p className="text-[11px] text-subtle">No se pudo comprobar: {error}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        <button onClick={() => void comprobarAhora()} disabled={comprobando}
          className="jg-press rounded-lg border border-white/15 px-2.5 py-1 text-[10.5px] text-fg disabled:opacity-40">
          {comprobando ? "Comprobando…" : "Comprobar ahora"}
        </button>
        {estado?.tipo === "disponible" && (
          <button onClick={() => void actualizarAhora(estado.version)} disabled={aplicando}
            className="jg-press rounded-lg bg-accent px-2.5 py-1 text-[10.5px] font-medium text-black disabled:opacity-40">
            {aplicando ? "Aplicando…" : "Actualizar ahora"}
          </button>
        )}
      </div>

      <Historial version={version} />
    </div>
  );
}

/** Colapsado por defecto: la mayoría de las veces a nadie le importa qué
 *  cambió en versiones viejas, así que no vale la pena pedir el manifiesto
 *  otra vez (`comprobarActualizacion` ya lo hizo arriba, pero solo trae "lo
 *  más nuevo", no la lista completa) hasta que alguien lo pide de verdad. */
function Historial({ version }: { version: string }) {
  const [abierto, setAbierto] = useState(false);
  const [publicaciones, setPublicaciones] = useState<PublicacionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  // Solo una descarga a la vez tiene sentido — si sale bien la app se
  // cierra sola, así que no hay "varias a la vez" que gestionar.
  const [descargando, setDescargando] = useState<string | null>(null);

  async function alternar() {
    const abrir = !abierto;
    setAbierto(abrir);
    if (abrir && !publicaciones && !cargando) {
      setCargando(true);
      setError(null);
      try {
        const lista = await historialActualizaciones();
        setPublicaciones(lista);
      } catch (e) {
        setError(String(e));
      } finally {
        setCargando(false);
      }
    }
  }

  async function descargar(versionObjetivo: string) {
    setDescargando(versionObjetivo);
    setError(null);
    try {
      await dispararActualizacionAVersion(versionObjetivo);
    } catch (e) {
      setError(String(e));
      setDescargando(null);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button onClick={() => void alternar()}
        className="flex w-full items-center justify-between text-left text-[10.5px] text-subtle hover:text-fg">
        <span>Historial de versiones</span>
        <Icon name="chevron" size={11}
          className={`transition-transform duration-300 ease-expo ${abierto ? "rotate-180" : ""}`} />
      </button>

      <div className={`grid transition-[grid-template-rows] duration-[450ms] ease-expo ${abierto ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="mt-2.5 flex flex-col gap-2.5">
            {cargando && <p className="text-[10.5px] text-subtle">Cargando…</p>}
            {error && <p className="text-[10.5px] text-danger-fg">{error}</p>}
            {publicaciones?.length === 0 && <p className="text-[10.5px] text-subtle">Sin publicaciones todavía.</p>}
            {publicaciones?.map((p) => (
              <div key={p.version} className="border-l-2 border-border pl-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[10.5px] text-fg">
                    {p.version}{p.version === version && <span className="ml-1.5 text-subtle">(esta)</span>}
                  </span>
                  <span className="shrink-0 font-mono text-[9.5px] text-subtle">
                    {new Date(p.publicado).toLocaleDateString(undefined, { dateStyle: "medium" })}
                  </span>
                </div>
                {p.notas && <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{p.notas}</p>}
                {p.retirada && <p className="mt-0.5 text-[9.5px] text-warning-fg">retirada</p>}
                {p.version !== version && (
                  <button onClick={() => void descargar(p.version)} disabled={!!descargando}
                    className="jg-press mt-1.5 rounded-lg border border-white/15 px-2 py-[3px] text-[9.5px] text-fg disabled:opacity-40">
                    {descargando === p.version ? "Aplicando…" : "Descargar esta versión"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
