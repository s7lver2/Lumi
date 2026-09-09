import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type AgenteVista, type Analysis, type Cambio, type DichoDeAgente, type Image } from "../lib/api";
import { lumiUrl } from "../lib/bridge";
import { Icon } from "../ui/Icon";
import { AgenteIcono } from "./AgenteIcono";

/** El modo Agentes: pantalla completa, dos vistas internas (elegir agente y
 *  resultado) — nunca un cajón lateral, por decisión explícita del owner
 *  (ver `docs/superpowers/specs/2026-09-09-panel-agentes-design.md`). Un
 *  agente a la vez: multi-selección se descartó a mitad de diseño. */
export function AgentesView({
  token, caseId, caseName, image, isAdmin, onBack, onIrAModelos,
}: {
  token: string | undefined;
  caseId: number;
  caseName: string;
  image: Image;
  isAdmin: boolean;
  onBack: () => void;
  onIrAModelos: () => void;
}) {
  const [agentes, setAgentes] = useState<AgenteVista[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [lanzando, setLanzando] = useState(false);
  const [rasgosVisibles, setRasgosVisibles] = useState(true);

  useEffect(() => {
    api.get<AgenteVista[]>("/v1/agentes", token).then(setAgentes).catch((e) => setError(String(e)));
  }, [token]);

  // Igual que `CaseView`: el servidor avisa por evento en vez de sondear.
  useEffect(() => {
    if (!analysis || (analysis.state !== "pendiente" && analysis.state !== "en_curso")) return;
    const un = listen<Cambio>("queue-change", (e) => {
      const c = e.payload;
      if (c.tipo !== "estado" || c.analysis_id !== analysis.id) return;
      api.get<Analysis>(`/v1/analyses/${analysis.id}`, token).then(setAnalysis).catch(() => {});
    });
    return () => { void un.then((f) => f()); };
  }, [analysis, token]);

  async function lanzar() {
    if (!seleccionado) return;
    setLanzando(true); setError(null);
    try {
      const a = await api.post<Analysis>(
        `/v1/cases/${caseId}/analyses`,
        { image_ids: [image.id], model: "agentes", agente: seleccionado },
        token,
      );
      setAnalysis(a);
    } catch (e) {
      setError(String(e));
    } finally {
      setLanzando(false);
    }
  }

  function elegirOtro() {
    setAnalysis(null);
    setError(null);
  }

  return (
    <div className="absolute inset-0 overflow-y-auto"
      style={{ animation: "jg-page-fade-in 260ms cubic-bezier(.16,1,.3,1) both" }}>
      <div className="mx-auto max-w-[900px] px-8 py-7">
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <button onClick={analysis ? elegirOtro : onBack}
            className="jg-press flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg">
            <Icon name="back" size={13} />
            {analysis ? "Elegir otro agente" : caseName}
          </button>
          <span className="ml-1 text-[16px] font-medium text-fg">
            {analysis ? (agentes?.find((a) => a.id === seleccionado)?.nombre ?? "Agentes") : "Agentes"}
          </span>
          <span className="ml-auto font-mono text-[11px] text-subtle">
            {!analysis && agentes ? `${agentes.length} disponibles` : null}
            {analysis?.state === "en_curso" || analysis?.state === "pendiente" ? "corriendo…" : null}
          </span>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3">
            <Icon name="alert" size={13} className="mt-px shrink-0 text-danger-fg" />
            <p className="text-[11.5px] leading-relaxed text-muted">{error}</p>
          </div>
        )}

        {analysis ? (
          <PantallaResultado image={image} analysis={analysis}
            agentePedido={seleccionado}
            motor={agentes?.find((a) => a.id === seleccionado)?.motor ?? null}
            rasgosVisibles={rasgosVisibles}
            onToggleRasgos={() => setRasgosVisibles((v) => !v)} />
        ) : (
          <PantallaSeleccion agentes={agentes} seleccionado={seleccionado} onSeleccionar={setSeleccionado}
            isAdmin={isAdmin} onIrAModelos={onIrAModelos} />
        )}

        {!analysis && (
          <div className="mt-6 flex justify-end">
            <button onClick={() => void lanzar()} disabled={!seleccionado || lanzando}
              className="jg-press rounded-lg bg-accent px-5 py-2.5 text-[12.5px] font-medium text-black
                disabled:opacity-40">
              {lanzando ? "Un momento…" : "Lanzar agente"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PantallaSeleccion({ agentes, seleccionado, onSeleccionar, isAdmin, onIrAModelos }: {
  agentes: AgenteVista[] | null;
  seleccionado: string | null;
  onSeleccionar: (id: string) => void;
  isAdmin: boolean;
  onIrAModelos: () => void;
}) {
  if (!agentes) {
    return <p className="mt-6 text-[12px] text-muted">Cargando el registro de agentes…</p>;
  }
  if (agentes.length === 0) {
    return <p className="mt-6 text-[12px] text-muted">Este servidor no trae ningún agente en su registro.</p>;
  }
  return (
    <div className="mt-5 grid grid-cols-2 gap-2.5">
      {agentes.map((a) => {
        const on = a.id === seleccionado;
        return (
          <div key={a.id}
            onClick={() => a.instalado && onSeleccionar(a.id)}
            className={`flex gap-3 rounded-xl border p-3.5 transition-colors duration-300 ease-expo
              ${a.instalado ? "cursor-pointer" : "cursor-default opacity-75"}
              ${on ? "border-fg bg-white/[.06]" : "border-border bg-panel"}`}>
            <div className="shrink-0 pt-0.5">
              <AgenteIcono agente={a.id} apagado={!a.instalado} size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-[13px] font-medium ${a.instalado ? "text-fg" : "text-muted"}`}>{a.nombre}</div>
              <p className={`mt-0.5 text-[11.5px] leading-snug ${a.instalado ? "text-muted" : "text-subtle"}`}>
                {a.pregunta || "Mira la imagen sin preguntar nada."}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {a.etiquetas.slice(0, 3).map((t) => (
                  <span key={t} className="rounded-lg border border-border px-1.5 py-px text-[10px] text-subtle">
                    {t}
                  </span>
                ))}
                {a.etiquetas.length > 3 && (
                  <span className="rounded-lg border border-border px-1.5 py-px text-[10px] text-subtle">
                    +{a.etiquetas.length - 3}
                  </span>
                )}
              </div>
              {!a.instalado && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-mono text-[10px] text-subtle">
                    requiere {a.requiere ?? "un motor no instalado"}
                  </span>
                  {isAdmin && (
                    <button onClick={(e) => { e.stopPropagation(); onIrAModelos(); }}
                      className="jg-press flex items-center gap-1 rounded-md border border-white/15
                        px-2 py-1 text-[10px] text-fg hover:border-fg">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 4v11M7 10l5 5 5-5" />
                        <path d="M5 19h14" />
                      </svg>
                      Descargar
                    </button>
                  )}
                </div>
              )}
            </div>
            {on && <Icon name="check" size={13} className="shrink-0 self-start text-fg" />}
          </div>
        );
      })}
    </div>
  );
}

/** El hueco fijo por agente — mismo patrón visual que `AgentesVisual.tsx`
 *  (marketing, `web/`): un dato concreto cuando ya existe uno evidente, y si
 *  no, la etiqueta ganadora en grande. No hace falta una pieza distinta para
 *  los doce agentes desde el primer día (fuera de alcance del diseño). */
function WidgetAgente({ agenteId, dicho }: { agenteId: string; dicho: DichoDeAgente }) {
  const detalleLargo = agenteId === "toponimos" && dicho.detalle.length > 0;
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-black/[.15] p-3">
      <AgenteIcono agente={agenteId} etiqueta={dicho.etiqueta} apagado={false} size={24} />
      <div className="min-w-0 flex-1">
        <div className="text-[9px] uppercase tracking-[.06em] text-subtle">
          {detalleLargo ? "texto detectado" : "respuesta"}
        </div>
        <div className={`mt-0.5 text-fg ${detalleLargo ? "font-mono text-[11px] leading-relaxed" : "text-[14px]"}`}>
          {detalleLargo ? dicho.detalle : dicho.etiqueta}
        </div>
      </div>
    </div>
  );
}

function PantallaResultado({ image, analysis, agentePedido, motor, rasgosVisibles, onToggleRasgos }: {
  image: Image;
  analysis: Analysis;
  agentePedido: string | null;
  motor: string | null;
  rasgosVisibles: boolean;
  onToggleRasgos: () => void;
}) {
  if (analysis.state === "pendiente" || analysis.state === "en_curso") {
    return (
      <div className="mt-10 flex flex-col items-center gap-2 py-16 text-center">
        <Icon name="spinner" size={22} className="text-muted" />
        <p className="text-[12px] text-muted">El agente está mirando la imagen…</p>
      </div>
    );
  }
  if (analysis.state === "error") {
    return (
      <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-border bg-panel p-4">
        <Icon name="alert" size={15} className="mt-px shrink-0 text-warning-fg" />
        <p className="text-[12px] leading-relaxed text-muted">
          {analysis.error ?? "el agente no contestó"}
        </p>
      </div>
    );
  }

  const dicho = analysis.agentes.find((d) => d.agente === agentePedido) ?? analysis.agentes[0] ?? null;
  if (!dicho) {
    return (
      <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-border bg-panel p-4">
        <Icon name="alert" size={15} className="mt-px shrink-0 text-warning-fg" />
        <p className="text-[12px] leading-relaxed text-muted">el agente no contestó</p>
      </div>
    );
  }

  const abstiene = dicho.etiqueta === "abstiene";
  const rasgos = dicho.rasgos;
  const conRasgos = rasgos !== null && rasgosVisibles;
  const filas: [string, number][] = dicho.alternativas.length > 0
    ? dicho.alternativas
    : [[dicho.etiqueta, dicho.confianza]];
  const maxPeso = Math.max(...filas.map(([, p]) => p), 1e-9);

  return (
    <div className="mt-5 grid grid-cols-[1.4fr_1fr] gap-0 overflow-hidden rounded-xl border border-border bg-panel">
      <div className="relative aspect-[3/2] bg-elevated">
        <img
          src={rasgos?.tipo === "profundidad" && conRasgos
            ? `data:image/png;base64,${rasgos.png_base64}`
            : lumiUrl(`/v1/images/${image.id}/thumb`)}
          alt="" className="h-full w-full object-cover" />
        {rasgos?.tipo === "ocr" && conRasgos && rasgos.cajas.map((c, i) => (
          <div key={i} className="absolute rounded-[3px] border border-dashed border-white/60"
            style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}>
            <span className="absolute -top-[19px] left-0 whitespace-nowrap rounded bg-black/70 px-1 py-0.5
              text-[9px] uppercase tracking-[.04em] text-white/90">
              {c.etiqueta}
            </span>
          </div>
        ))}
        {rasgos && (
          <button onClick={onToggleRasgos}
            className="jg-press absolute right-3 top-3 flex items-center gap-1.5 rounded-lg bg-black/55
              px-2.5 py-1.5 text-[11px] text-fg">
            <span className={`relative h-[15px] w-[26px] rounded-full border border-border transition-colors
              ${rasgosVisibles ? "bg-fg" : "bg-elevated"}`}>
              <span className={`absolute top-[1px] h-[11px] w-[11px] rounded-full transition-all
                ${rasgosVisibles ? "left-[12px] bg-[#111]" : "left-[1px] bg-bg"}`} />
            </span>
            rasgos
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2.5 rounded-lg bg-white/[.03] p-2">
          <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
            className="h-9 w-11 shrink-0 rounded object-cover" />
          <div className="min-w-0">
            <div className="truncate font-mono text-[10.5px] text-fg">{image.filename}</div>
            <div className="mt-0.5 font-mono text-[9px] text-subtle">motor · {motor ?? "?"}</div>
          </div>
        </div>

        {abstiene ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-black/[.1] p-3.5">
            <Icon name="alert" size={14} className="mt-px shrink-0 text-warning-fg" />
            <p className="text-[12px] leading-relaxed text-muted">
              No se pudo determinar <b className="text-warning-fg">{dicho.nombre.toLowerCase()}</b> con
              suficiente confianza.
            </p>
          </div>
        ) : (
          <>
            <WidgetAgente agenteId={dicho.agente} dicho={dicho} />

            <div className="flex flex-col gap-2">
              {dicho.alternativas.length > 0 && (
                <p className="text-[9px] uppercase tracking-[.08em] text-subtle">Hipótesis</p>
              )}
              {filas.map(([etq, p], i) => (
                <div key={etq} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-[12.5px] ${i === 0 ? "font-medium text-fg" : "text-muted"}`}>{etq}</span>
                    <span className="font-mono text-[10.5px] text-subtle">{Math.round(p * 100)}%</span>
                  </div>
                  <div className="h-[3px] overflow-hidden rounded-full bg-elevated">
                    <div className={`h-full rounded-full ${i === 0 ? "bg-fg" : "bg-subtle"}`}
                      style={{ width: `${Math.max(6, (p / maxPeso) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-auto flex items-center gap-1.5 border-t border-border pt-3">
              <Icon name="check" size={12} className="text-fg" />
              <span className="text-[10.5px] text-fg">verificado por {motor ?? "el motor del agente"}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
