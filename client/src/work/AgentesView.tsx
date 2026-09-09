import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type AgenteVista, type Analysis, type Cambio, type DichoDeAgente, type Image } from "../lib/api";
import { lumiUrl } from "../lib/bridge";
import { useDismissable } from "../lib/useDismissable";
import { Icon } from "../ui/Icon";
import { AgenteIcono } from "./AgenteIcono";
import { AgentPickerPopup, BetaPill } from "./AgentPickerPopup";

/** El modo Agentes: pantalla completa, solo el resultado — nunca un cajón
 *  lateral, por decisión explícita del owner (ver
 *  `docs/superpowers/specs/2026-09-09-panel-agentes-design.md`). La elección
 *  del agente ya no vive aquí dentro: pasó a `AgentPickerPopup`, un popup
 *  como `UploadPopup`, así que esta pantalla nace siempre con un análisis ya
 *  en marcha (`analysisInicial`) y solo reabre el popup si el investigador
 *  pide otro agente. Un agente a la vez: multi-selección se descartó a mitad
 *  de diseño. */
export function AgentesView({
  token, caseId, caseName, image, isAdmin, analysisInicial, onBack, onIrAModelos,
}: {
  token: string | undefined;
  caseId: number;
  caseName: string;
  image: Image;
  isAdmin: boolean;
  analysisInicial: Analysis;
  onBack: () => void;
  onIrAModelos: () => void;
}) {
  const [agentes, setAgentes] = useState<AgenteVista[] | null>(null);
  const [analysis, setAnalysis] = useState<Analysis>(analysisInicial);
  const [rasgosVisibles, setRasgosVisibles] = useState(true);
  const [pickerAbierto, setPickerAbierto] = useState(false);
  const picker = useDismissable(pickerAbierto, 180);

  useEffect(() => {
    api.get<AgenteVista[]>("/v1/agentes", token).then(setAgentes).catch(() => {});
  }, [token]);

  // Igual que `CaseView`: el servidor avisa por evento en vez de sondear.
  useEffect(() => {
    if (analysis.state !== "pendiente" && analysis.state !== "en_curso") return;
    const un = listen<Cambio>("queue-change", (e) => {
      const c = e.payload;
      if (c.tipo !== "estado" || c.analysis_id !== analysis.id) return;
      api.get<Analysis>(`/v1/analyses/${analysis.id}`, token).then(setAnalysis).catch(() => {});
    });
    return () => { void un.then((f) => f()); };
  }, [analysis.id, analysis.state, token]);

  // Solo para la frase de espera (ver `PantallaResultado`): nunca una barra
  // que avance a un ritmo inventado, un dato real (segundos transcurridos)
  // sirviendo de pista de qué fase es probable, no cuánto falta.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (analysis.state !== "pendiente" && analysis.state !== "en_curso") return;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [analysis.state]);
  const elapsedS = analysis.state === "pendiente" || analysis.state === "en_curso"
    ? Math.max(0, Math.round(ahora / 1000 - analysis.created_at))
    : null;

  const agenteActual = agentes?.find((a) => a.id === analysis.agente) ?? null;

  return (
    <div className="absolute inset-0 overflow-y-auto"
      style={{ animation: "jg-page-fade-in 260ms cubic-bezier(.16,1,.3,1) both" }}>
      <div className="mx-auto max-w-[900px] px-8 py-7">
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <button onClick={onBack} className="jg-press flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg">
            <Icon name="back" size={13} />
            {caseName}
          </button>
          <span className="ml-1 flex items-center gap-1.5 text-[16px] font-medium text-fg">
            {agenteActual?.nombre ?? "Agentes"}
            <BetaPill />
          </span>
          <button onClick={() => setPickerAbierto(true)}
            className="jg-press text-[11.5px] text-muted underline decoration-dotted underline-offset-2 hover:text-fg">
            Elegir otro agente
          </button>
          <span className="ml-auto font-mono text-[11px] text-subtle">
            {analysis.state === "en_curso" || analysis.state === "pendiente" ? "corriendo…" : null}
          </span>
        </div>

        <PantallaResultado image={image} analysis={analysis}
          agentePedido={analysis.agente} motor={agenteActual?.motor ?? null}
          elapsedS={elapsedS}
          rasgosVisibles={rasgosVisibles}
          onToggleRasgos={() => setRasgosVisibles((v) => !v)} />
      </div>

      {picker.rendered && (
        <AgentPickerPopup token={token} caseId={caseId} image={image} isAdmin={isAdmin}
          closing={picker.closing}
          onLaunched={(a) => { setAnalysis(a); setPickerAbierto(false); }}
          onClose={() => setPickerAbierto(false)}
          onIrAModelos={onIrAModelos} />
      )}
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

/** Frase de espera según el tiempo real transcurrido — no un porcentaje
 *  inventado. Los umbrales son una lectura del caso conocido (carga en frío
 *  del VLM se come casi el presupuesto de 120s por sí sola, ver
 *  `agentar::LIMITE_STANDALONE`), no una promesa de cuándo termina. */
function fraseDeEspera(elapsedS: number | null): string {
  if (elapsedS === null || elapsedS < 15) return "El agente está mirando la imagen…";
  if (elapsedS < 60) return "Cargando el motor…";
  return "Casi listo…";
}

function PantallaResultado({ image, analysis, agentePedido, motor, elapsedS, rasgosVisibles, onToggleRasgos }: {
  image: Image;
  analysis: Analysis;
  agentePedido: string | null;
  motor: string | null;
  elapsedS: number | null;
  rasgosVisibles: boolean;
  onToggleRasgos: () => void;
}) {
  if (analysis.state === "pendiente" || analysis.state === "en_curso") {
    return (
      <div className="mt-10 flex flex-col items-center gap-3 py-16 text-center"
        style={{ animation: "jg-fade-rise 300ms cubic-bezier(.16,1,.3,1) both" }}>
        <span className="relative grid h-9 w-9 place-items-center">
          <span className="absolute inset-0 rounded-full bg-white/[.08]"
            style={{ animation: "jg-alert-pulse 1.6s ease-in-out infinite" }} />
          <Icon name="spinner" size={19} className="relative text-muted" />
        </span>
        <p key={fraseDeEspera(elapsedS)} className="text-[12px] text-muted"
          style={{ animation: "jg-fade-rise 240ms ease-expo both" }}>
          {fraseDeEspera(elapsedS)}
        </p>
      </div>
    );
  }
  if (analysis.state === "error" || analysis.agentes.length === 0) {
    // `analysis.error` ya trae el motivo real cuando lo hay (incluido el
    // timeout silencioso del modo standalone, que `correr_agente_unico`
    // ahora rellena explícitamente) -- solo se cae a un texto genérico
    // cuando de verdad no hay nada más honesto que decir.
    return (
      <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-border bg-panel p-4"
        style={{ animation: "jg-fade-rise 260ms ease-expo both" }}>
        <Icon name="alert" size={15} className="mt-px shrink-0 text-warning-fg" />
        <p className="text-[12px] leading-relaxed text-muted">
          {analysis.error ?? "El agente no contestó a tiempo."}
        </p>
      </div>
    );
  }

  const dicho = analysis.agentes.find((d) => d.agente === agentePedido) ?? analysis.agentes[0];
  const abstiene = dicho.etiqueta === "abstiene";
  const rasgos = dicho.rasgos;
  const conRasgos = rasgos !== null && rasgosVisibles;
  const filas: [string, number][] = dicho.alternativas.length > 0
    ? dicho.alternativas
    : [[dicho.etiqueta, dicho.confianza]];
  const maxPeso = Math.max(...filas.map(([, p]) => p), 1e-9);

  return (
    <div className="mt-5 grid grid-cols-[1.4fr_1fr] gap-0 overflow-hidden rounded-xl border border-border bg-panel"
      style={{ animation: "jg-fade-rise 280ms cubic-bezier(.16,1,.3,1) both" }}>
      <div className="relative aspect-[3/2] bg-elevated">
        <img
          src={rasgos?.tipo === "profundidad" && conRasgos
            ? `data:image/png;base64,${rasgos.png_base64}`
            : lumiUrl(`/v1/images/${image.id}/thumb`)}
          alt="" className="h-full w-full object-cover transition-opacity duration-300 ease-expo" />
        {rasgos?.tipo === "ocr" && rasgos.cajas.map((c, i) => (
          <div key={i} className="absolute rounded-[3px] border border-dashed border-white/60 transition-opacity duration-300 ease-expo"
            style={{
              left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%`,
              opacity: conRasgos ? 1 : 0, pointerEvents: conRasgos ? "auto" : "none",
            }}>
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
              duration-300 ease-expo ${rasgosVisibles ? "bg-fg" : "bg-elevated"}`}>
              <span className={`absolute top-[1px] h-[11px] w-[11px] rounded-full transition-all
                duration-300 ease-expo ${rasgosVisibles ? "left-[12px] bg-[#111]" : "left-[1px] bg-bg"}`} />
            </span>
            rasgos
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2.5 rounded-lg bg-white/[.03] p-2"
          style={{ animation: "jg-fade-rise 280ms ease-expo both 40ms" }}>
          <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
            className="h-9 w-11 shrink-0 rounded object-cover" />
          <div className="min-w-0">
            <div className="truncate font-mono text-[10.5px] text-fg">{image.filename}</div>
            <div className="mt-0.5 font-mono text-[9px] text-subtle">motor · {motor ?? "?"}</div>
          </div>
        </div>

        {abstiene ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-black/[.1] p-3.5"
            style={{ animation: "jg-fade-rise 280ms ease-expo both 90ms" }}>
            <Icon name="alert" size={14} className="mt-px shrink-0 text-warning-fg" />
            <p className="text-[12px] leading-relaxed text-muted">
              No se pudo determinar <b className="text-warning-fg">{dicho.nombre.toLowerCase()}</b> con
              suficiente confianza.
            </p>
          </div>
        ) : (
          <>
            <div style={{ animation: "jg-fade-rise 280ms ease-expo both 90ms" }}>
              <WidgetAgente agenteId={dicho.agente} dicho={dicho} />
            </div>

            <div className="flex flex-col gap-2">
              {dicho.alternativas.length > 0 && (
                <p className="text-[9px] uppercase tracking-[.08em] text-subtle">Hipótesis</p>
              )}
              {filas.map(([etq, p], i) => (
                <div key={etq} className="flex flex-col gap-1"
                  style={{ animation: `jg-fade-rise 280ms ease-expo both ${140 + i * 45}ms` }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-[12.5px] ${i === 0 ? "font-medium text-fg" : "text-muted"}`}>{etq}</span>
                    <span className="font-mono text-[10.5px] text-subtle">{Math.round(p * 100)}%</span>
                  </div>
                  <div className="h-[3px] overflow-hidden rounded-full bg-elevated">
                    <div className={`h-full rounded-full transition-[width] duration-500 ease-expo ${i === 0 ? "bg-fg" : "bg-subtle"}`}
                      style={{ width: `${Math.max(6, (p / maxPeso) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-auto flex items-center gap-1.5 border-t border-border pt-3"
              style={{ animation: "jg-fade-rise 280ms ease-expo both 220ms" }}>
              <Icon name="check" size={12} className="text-fg" />
              <span className="text-[10.5px] text-fg">verificado por {motor ?? "el motor del agente"}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
