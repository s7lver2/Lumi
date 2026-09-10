import { useEffect, useState } from "react";
import { api, type FeatureFlags } from "../lib/api";
import { Icon } from "../ui/Icon";
import { Seccion } from "./AdminPanel";

/** Mismo `role="switch"` que ya usan `ExportDrawer`/otros -- no hay un
 *  `Interruptor` compartido en el repo todavía (cada pantalla define el
 *  suyo), así que este sigue el mismo patrón visual en vez de inventar uno
 *  nuevo. */
function Interruptor({ activo, onChange, label, hint, disabled }: {
  activo: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[12px] text-fg">
        {label}
        <small className="mt-0.5 block text-[10.5px] text-subtle">{hint}</small>
      </span>
      <button role="switch" aria-checked={activo} disabled={disabled} onClick={() => onChange(!activo)}
        className={`relative h-5 w-10 shrink-0 rounded-full border transition-colors duration-300 ease-expo
          disabled:opacity-40 ${activo ? "border-accent bg-accent" : "border-white/15 bg-white/10"}`}>
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-fg ring-1 ring-black/20
          transition-transform duration-300 ease-expo ${activo ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

const INPUT = "w-full rounded-lg border border-border bg-elevated px-2.5 py-1.5 font-mono text-[11px] text-fg outline-none transition-colors duration-300 ease-expo focus:border-white/40";

/** Sección "Calibración" del panel admin (spec 2026-09-10 §4): los tres
 *  interruptores nuevos del spec entero (`upscaler_activo`,
 *  `media_por_proyecto_activo` no tienen otra pantalla natural en la que
 *  vivir hoy -- `rendimiento.rs` existe en el backend pero el panel admin
 *  todavía no tiene una vista para él, así que se consolidan aquí) y, solo
 *  con `modo_calibracion` activo, las cuatro herramientas de debug: 4a
 *  (umbrales), 4b (prompts), 4c (nota sobre respuesta cruda) y 4d (nota
 *  sobre forzar motor/dispositivo). */
export function CalibracionView({ token }: { token: string }) {
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = () => api.get<FeatureFlags>("/v1/admin/features", token).then(setFlags).catch((e) => setError(String(e)));
  useEffect(() => { void cargar(); }, [token]);

  async function set(campo: keyof FeatureFlags, v: boolean) {
    setError(null);
    try {
      setFlags(await api.patch<FeatureFlags>("/v1/admin/features", { [campo]: v }, token));
    } catch (e) {
      setError(String(e));
    }
  }

  if (!flags) {
    return <Seccion titulo="Calibración" grupo="Operación"><p className="text-[11px] text-subtle">cargando</p></Seccion>;
  }

  return (
    <Seccion titulo="Calibración" grupo="Operación">
      <p className="text-[11px] text-muted">
        Interruptores del spec 2026-09-10. Los tres nacen apagados por servidor.
      </p>
      {error && <p className="mt-2 text-[10.5px] text-danger-fg">{error}</p>}

      <div className="mt-3 flex flex-col divide-y divide-white/10 rounded-xl border border-border bg-panel px-3">
        <Interruptor activo={flags.upscaler_activo} onChange={(v) => void set("upscaler_activo", v)}
          label="Upscaler de IA" hint={flags.upscaler_activo_desc} />
        <Interruptor activo={flags.media_por_proyecto_activo} onChange={(v) => void set("media_por_proyecto_activo", v)}
          label="Media por proyecto" hint={flags.media_por_proyecto_activo_desc} />
        <Interruptor activo={flags.modo_calibracion} onChange={(v) => void set("modo_calibracion", v)}
          label="Modo de calibración" hint={flags.modo_calibracion_desc} />
      </div>

      {flags.modo_calibracion ? (
        <div className="mt-5 flex flex-col gap-5">
          <UmbralesEditor token={token} />
          <PromptsEditor token={token} />
          <div className="rounded-xl border border-border bg-panel p-3.5">
            <p className="text-[11.5px] text-fg">Respuesta cruda del modelo</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
              Con este modo activo, cada veredicto nuevo de un agente VLM fusionado guarda el JSON exacto que
              devolvió el motor antes de interpretarlo. Se enseña en el propio popup de resultado del agente,
              en una sección colapsada "Ver crudo" bajo el card.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-panel p-3.5">
            <p className="text-[11.5px] text-fg">Forzar motor / dispositivo</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
              Con este modo activo, <code className="font-mono text-subtle">POST /v1/cases/:id/analyses</code>{" "}
              acepta <code className="font-mono text-subtle">forzar_motor</code>/
              <code className="font-mono text-subtle">forzar_dispositivo</code>, que saltan el enrutado
              automático de la cola. Con el modo apagado se ignoran en silencio: ni siquiera se guardan.
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[11px] text-subtle">
          Activa el modo de calibración para editar umbrales de verificación y prompts de agentes.
        </p>
      )}
    </Seccion>
  );
}

interface UmbralVista { verificador: string; umbral_inliers: number; overridden: boolean }

function UmbralesEditor({ token }: { token: string }) {
  const [id, setId] = useState("roma");
  const [vista, setVista] = useState<UmbralVista | null>(null);
  const [valor, setValor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function buscar() {
    setError(null);
    try {
      const v = await api.get<UmbralVista>(`/v1/admin/verificadores/${encodeURIComponent(id)}/umbrales`, token);
      setVista(v);
      setValor(String(v.umbral_inliers));
    } catch (e) {
      setError(String(e));
      setVista(null);
    }
  }

  async function guardar(borrar: boolean) {
    setBusy(true); setError(null);
    try {
      const v = await api.patch<UmbralVista>(
        `/v1/admin/verificadores/${encodeURIComponent(id)}/umbrales`,
        { umbral_inliers: borrar ? null : Number(valor) }, token,
      );
      setVista(v);
      setValor(String(v.umbral_inliers));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-panel p-3.5">
      <p className="text-[11.5px] text-fg">Umbrales de verificación geométrica</p>
      <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
        Override por servidor sobre <code className="font-mono text-subtle">UMBRAL_INLIERS</code>. Surte
        efecto en el siguiente análisis, sin reiniciar <code className="font-mono text-subtle">lumid</code>.
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="id del verificador (p.ej. roma)"
          className={INPUT} />
        <button onClick={() => void buscar()} className="jg-press shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg">
          Ver
        </button>
      </div>
      {vista && (
        <div className="mt-2.5 flex items-center gap-2">
          <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="numeric"
            className={INPUT} />
          <button onClick={() => void guardar(false)} disabled={busy}
            className="jg-press shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black disabled:opacity-40">
            Guardar
          </button>
          {vista.overridden && (
            <button onClick={() => void guardar(true)} disabled={busy}
              className="jg-press shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-subtle">
              Quitar override
            </button>
          )}
        </div>
      )}
      {vista && (
        <p className="mt-1.5 font-mono text-[10px] text-subtle">
          {vista.overridden ? "override guardado en este servidor" : "valor del registro (sin override)"}
        </p>
      )}
      {error && <p className="mt-1.5 text-[10.5px] text-danger-fg">{error}</p>}
    </div>
  );
}

function PromptsEditor({ token }: { token: string }) {
  const [id, setId] = useState("hora-sombras");
  const [json, setJson] = useState("");
  const [overridden, setOverridden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function buscar() {
    setError(null);
    try {
      const v = await api.get<{ agente: unknown; overridden: boolean }>(
        `/v1/admin/agentes/${encodeURIComponent(id)}`, token,
      );
      setJson(JSON.stringify(v.agente, null, 2));
      setOverridden(v.overridden);
    } catch (e) {
      setError(String(e));
    }
  }

  async function guardar(borrar: boolean) {
    setBusy(true); setError(null);
    try {
      let agente: unknown = null;
      if (!borrar) {
        try {
          agente = JSON.parse(json);
        } catch {
          setError("ese JSON no es válido");
          setBusy(false);
          return;
        }
      }
      const v = await api.patch<{ agente: unknown; overridden: boolean }>(
        `/v1/admin/agentes/${encodeURIComponent(id)}`, { agente }, token,
      );
      setJson(JSON.stringify(v.agente, null, 2));
      setOverridden(v.overridden);
    } catch (e) {
      // El 400 de validación (struct Rust) llega aquí tal cual -- nunca se
      // guarda un prompt roto, el mensaje real del servidor es la pista.
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-panel p-3.5">
      <p className="text-[11.5px] text-fg">Prompts de agentes</p>
      <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
        El JSON completo del agente (incluye sus <code className="font-mono text-subtle">sub_preguntas</code>{" "}
        si es uno fusionado). Se valida contra el struct de Rust antes de guardarse -- uno que no deserialice
        se rechaza con 400 y nunca llega a persistirse.
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="id del agente"
          className={INPUT} />
        <button onClick={() => void buscar()} className="jg-press shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg">
          Ver
        </button>
      </div>
      {json && (
        <>
          <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={10} spellCheck={false}
            className="mt-2.5 w-full resize-y rounded-lg border border-border bg-elevated px-2.5 py-2
              font-mono text-[10.5px] leading-relaxed text-fg outline-none focus:border-white/40" />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => void guardar(false)} disabled={busy}
              className="jg-press rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black disabled:opacity-40">
              Guardar
            </button>
            {overridden && (
              <button onClick={() => void guardar(true)} disabled={busy}
                className="jg-press rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-subtle">
                Volver al registro
              </button>
            )}
            <span className="ml-auto font-mono text-[10px] text-subtle">
              {overridden ? "override guardado" : "valor del registro"}
            </span>
          </div>
        </>
      )}
      {error && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[10.5px] text-danger-fg">
          <Icon name="alert" size={11} className="mt-px shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}
