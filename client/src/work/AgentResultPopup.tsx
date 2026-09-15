import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type AgenteVista, type Analysis, type Cambio, type DichoDeAgente, type Image } from "../lib/api";
import { lumiUrl } from "../lib/bridge";
import { ofrecerInstalarModelo } from "../lib/toasts";
import { Backdrop, FloatingCard, Pop } from "../ui/FloatingCard";
import { Icon } from "../ui/Icon";
import { Center } from "../ui/layout";
import { AgenteIcono } from "./AgenteIcono";
import { BetaPill, etiquetaCortaDe } from "./AgentPickerPopup";

/** El resultado del modo Agentes, como popup — hasta 2.0.35 esto era la
 *  segunda pantalla de `AgentesView` (pantalla completa); el owner probó esa
 *  versión en producción y pidió que también el resultado fuera un popup,
 *  igual que ya pasó con la elección (`AgentPickerPopup`). Mismo lenguaje
 *  visual (`Backdrop`+`Center`+`Pop`+`FloatingCard`), pero más ancho: el
 *  layout de dos columnas (foto+info) no cabe en los ~470-540px de los
 *  popups de subir/elegir.
 *
 *  Vive como hermano de `AgentPickerPopup` dentro de `CaseView`, no anidado
 *  dentro de él: «Elegir otro agente» cierra este popup y `CaseView` reabre
 *  el de elegir, en vez de que uno monte al otro por dentro. */
export function AgentResultPopup({
  token, image, closing, analysesIniciales, onElegirOtro, onClose,
}: {
  token: string | undefined;
  image: Image;
  closing: boolean;
  /** Normalmente uno solo. Más de uno cuando vienen de una selección
   *  múltiple de agentes (`AgentPickerPopup`) -- cada uno sigue siendo su
   *  propio análisis en cola, con su propio estado, mostrados juntos como un
   *  solo intento. */
  analysesIniciales: Analysis[];
  onElegirOtro: () => void;
  onClose: () => void;
}) {
  const [agentes, setAgentes] = useState<AgenteVista[] | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>(analysesIniciales);
  const [rasgosVisibles, setRasgosVisibles] = useState(true);

  useEffect(() => {
    api.get<AgenteVista[]>("/v1/agentes", token).then(setAgentes).catch(() => {});
  }, [token]);

  // Los análisis pueden cambiar entre una apertura y otra (agente relanzado
  // desde el picker) sin que el popup se desmonte: `analysesIniciales` solo
  // se lee una vez por montaje.
  useEffect(() => { setAnalyses(analysesIniciales); }, [analysesIniciales]);

  // Un análisis en error por "falta instalar X" ofrece el toast en cuanto se
  // ve -- el `ref` evita repetirlo en cada re-render mientras el popup sigue
  // abierto con el mismo análisis ya fallado.
  const ofrecidosRef = useRef(new Set<number>());
  useEffect(() => {
    for (const a of analyses) {
      if (a.state === "error" && a.falta_modelo && !ofrecidosRef.current.has(a.id)) {
        ofrecidosRef.current.add(a.id);
        ofrecerInstalarModelo(a.falta_modelo, a.error ?? "falta un modelo");
      }
    }
  }, [analyses]);

  const enCurso = analyses.some((a) => a.state === "pendiente" || a.state === "en_curso");

  // Igual que `CaseView`: el servidor avisa por evento en vez de sondear.
  // Un evento puede llegar para CUALQUIERA de los análisis del grupo, no
  // solo el primero -- se refresca solo la fila afectada.
  useEffect(() => {
    if (!enCurso) return;
    const un = listen<Cambio>("queue-change", (e) => {
      const c = e.payload;
      if (c.tipo !== "estado" || !analyses.some((a) => a.id === c.analysis_id)) return;
      api.get<Analysis>(`/v1/analyses/${c.analysis_id}`, token)
        .then((fresca) => setAnalyses((prev) => prev.map((a) => (a.id === fresca.id ? fresca : a))))
        .catch(() => {});
    });
    return () => { void un.then((f) => f()); };
  }, [analyses, enCurso, token]);

  // Solo para la frase de espera (ver `PantallaResultado`): nunca una barra
  // que avance a un ritmo inventado, un dato real (segundos transcurridos)
  // sirviendo de pista de qué fase es probable, no cuánto falta.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!enCurso) return;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enCurso]);
  const elapsedS = enCurso
    ? Math.max(0, Math.round(ahora / 1000 - Math.min(...analyses.map((a) => a.created_at))))
    : null;

  const unico = analyses.length === 1 ? analyses[0] : null;
  const agenteActual = agentes?.find((a) => a.id === unico?.agente) ?? null;
  // El análisis sigue corriendo en el servidor (Dock/estados lo siguen
  // reflejando) sea cual sea el estado de este popup, así que cerrarlo o
  // cambiar de agente a media espera no pierde nada -- no hace falta
  // bloquear los controles mientras `enCurso` es true (antes lo dejaba
  // inerte hasta ~120s, lo que se sentía roto).

  return (
    <>
      <Backdrop closing={closing} onClick={onClose} />
      <Center className="z-[55]">
        <Pop closing={closing} className="w-[760px] max-w-[calc(100vw-48px)]">
          <FloatingCard className="p-[17px]">
            <div className="flex items-center gap-2.5 border-b border-border pb-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.06] text-fg">
                <Icon name="globe" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-[13px] font-medium text-fg">
                    {unico ? (agenteActual?.nombre ?? "Agentes") : `${analyses.length} agentes`}
                  </p>
                  <BetaPill />
                </div>
                <button onClick={onElegirOtro}
                  className="jg-press text-[11px] text-muted underline decoration-dotted underline-offset-2
                    hover:text-fg">
                  Elegir otro agente
                </button>
              </div>
              {enCurso && (
                <span className="shrink-0 font-mono text-[11px] text-subtle">corriendo…</span>
              )}
              <button onClick={onClose} aria-label="Cerrar"
                className="jg-press shrink-0 text-subtle hover:text-fg">
                <Icon name="x" size={13} />
              </button>
            </div>

            <div className="mt-1">
              {unico ? (
                <PantallaResultado image={image} analysis={unico}
                  agentePedido={unico.agente} motor={agenteActual?.motor ?? null}
                  elapsedS={elapsedS}
                  rasgosVisibles={rasgosVisibles}
                  onToggleRasgos={() => setRasgosVisibles((v) => !v)} />
              ) : (
                <PantallaGrupo analyses={analyses} agentesRegistro={agentes} />
              )}
            </div>
          </FloatingCard>
        </Pop>
      </Center>
    </>
  );
}

/** La vista de una selección múltiple de agentes: una fila por análisis
 *  pedido, cada una con su propio estado en vivo -- a diferencia de
 *  `PantallaResultadoFusionado` (sub-preguntas de UN agente, que llegan y
 *  terminan juntas en una sola llamada), aquí cada fila es su propia
 *  solicitud en cola y puede seguir corriendo mientras otra ya terminó o
 *  falló. */
function PantallaGrupo({ analyses, agentesRegistro }: {
  analyses: Analysis[];
  agentesRegistro: AgenteVista[] | null;
}) {
  return (
    <div className="mt-4 flex flex-col gap-2.5">
      {analyses.map((a, i) => {
        const reg = agentesRegistro?.find((r) => r.id === a.agente);
        const corriendo = a.state === "pendiente" || a.state === "en_curso";
        const fallo = a.state === "error" || (a.state === "hecho" && a.agentes.length === 0);
        return (
          <div key={a.id} className="rounded-lg border border-border bg-black/[.1] p-3"
            style={{ animation: `jg-fade-rise 280ms ease-expo both ${i * 45}ms` }}>
            <div className="flex items-center gap-2.5">
              <AgenteIcono agente={a.agente ?? ""} apagado={corriendo || fallo} size={18} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{reg?.nombre ?? a.agente ?? "agente"}</span>
              {corriendo && <Icon name="spinner" size={13} className="shrink-0 text-muted" />}
            </div>
            {corriendo && <p className="mt-1.5 pl-[26px] text-[10.5px] text-subtle">Mirando la imagen…</p>}
            {fallo && (
              <p className="mt-1.5 pl-[26px] text-[10.5px] text-muted">{a.error ?? "no contestó a tiempo"}</p>
            )}
            {!corriendo && !fallo && (
              <div className="mt-1.5 flex flex-col gap-1">
                {a.agentes.map((d) => {
                  const abstiene = d.etiqueta === "abstiene";
                  const mejorEtiqueta = abstiene ? (d.etiqueta_real || d.etiqueta) : d.etiqueta;
                  return (
                    <div key={d.agente} className="flex items-center justify-between gap-2 pl-[26px]">
                      <span className={`truncate text-[11.5px] ${abstiene ? "text-subtle italic" : "text-fg"}`}>
                        {abstiene
                          ? (mejorEtiqueta ? `¿${mejorEtiqueta}? (sin confianza suficiente)` : "sin suficiente confianza")
                          : (d.detalle || d.etiqueta)}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-subtle">{Math.round(d.confianza * 100)}%</span>
                    </div>
                  );
                })}
              </div>
            )}
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
  const detalleLargo = agenteId.endsWith("toponimos") && dicho.detalle.length > 0;
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
      <div className="flex flex-col items-center gap-3 py-16 text-center"
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
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-border bg-panel p-4"
        style={{ animation: "jg-fade-rise 260ms ease-expo both" }}>
        <Icon name="alert" size={15} className="mt-px shrink-0 text-warning-fg" />
        <p className="text-[12px] leading-relaxed text-muted">
          {analysis.error ?? "El agente no contestó a tiempo."}
        </p>
      </div>
    );
  }

  // Un agente fusionado (spec 2026-09-10 §1) no deja ningún `agente ===
  // agentePedido` exacto: cada sub-respuesta llega como
  // "<agentePedido>.<sub>". Se agrupan bajo un solo card en vez de caer al
  // primer `analysis.agentes[0]` de abajo, que es el camino de un agente
  // suelto.
  const subRespuestas = agentePedido
    ? analysis.agentes.filter((d) => d.agente.startsWith(`${agentePedido}.`))
    : [];
  if (subRespuestas.length > 0) {
    return (
      <PantallaResultadoFusionado image={image} motor={motor} subRespuestas={subRespuestas} />
    );
  }

  const dicho = analysis.agentes.find((d) => d.agente === agentePedido) ?? analysis.agentes[0];
  const abstiene = dicho.etiqueta === "abstiene";
  const rasgos = dicho.rasgos;
  const conRasgos = rasgos !== null && rasgosVisibles;
  // `etiqueta_real` es lo que el motor eligió de verdad incluso al
  // abstenerse -- sin ella no habría nada que mostrar como "lo más parecido"
  // más que el propio literal "abstiene".
  const mejorEtiqueta = abstiene ? (dicho.etiqueta_real || dicho.etiqueta) : dicho.etiqueta;
  const filas: [string, number][] = dicho.alternativas.length > 0
    ? dicho.alternativas
    : [[mejorEtiqueta, dicho.confianza]];
  const maxPeso = Math.max(...filas.map(([, p]) => p), 1e-9);

  return (
    <div className="mt-4 grid grid-cols-[1.4fr_1fr] gap-0 overflow-hidden rounded-xl border border-border bg-panel"
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
          <>
            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-black/[.1] p-3.5"
              style={{ animation: "jg-fade-rise 280ms ease-expo both 90ms" }}>
              <Icon name="alert" size={14} className="mt-px shrink-0 text-warning-fg" />
              <p className="text-[12px] leading-relaxed text-muted">
                No se pudo determinar <b className="text-warning-fg">{dicho.nombre.toLowerCase()}</b> con
                suficiente confianza.
              </p>
            </div>
            {mejorEtiqueta && (
              <div className="flex flex-col gap-2">
                <p className="text-[9px] uppercase tracking-[.08em] text-subtle">Lo más cercano</p>
                {filas.map(([etq, p], i) => (
                  <div key={etq} className="flex flex-col gap-1"
                    style={{ animation: `jg-fade-rise 280ms ease-expo both ${140 + i * 45}ms` }}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`text-[12.5px] ${i === 0 ? "font-medium text-fg" : "text-muted"}`}>{etq}</span>
                      <span className="font-mono text-[10.5px] text-subtle">{Math.round(p * 100)}%</span>
                    </div>
                    <div className="h-[3px] overflow-hidden rounded-full bg-elevated">
                      <div className={`h-full rounded-full transition-[width] duration-500 ease-expo ${i === 0 ? "bg-warning-fg" : "bg-subtle"}`}
                        style={{ width: `${Math.max(6, (p / maxPeso) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
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
            {!abstiene && dicho.respuesta_cruda && <VerCrudo texto={dicho.respuesta_cruda} />}
          </>
        )}
      </div>
    </div>
  );
}

/** Sección colapsada "Ver crudo" (spec 2026-09-10 §4c) -- aparece únicamente
 *  si el veredicto trae `respuesta_cruda` relleno, que solo pasa con
 *  `modo_calibracion` activo en el servidor. Mono, como cualquier dato de
 *  máquina (CLAUDE.md). */
function VerCrudo({ texto }: { texto: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="border-t border-border pt-2">
      <button onClick={() => setAbierto((v) => !v)}
        className="jg-press flex items-center gap-1.5 text-[10px] uppercase tracking-[.06em] text-subtle hover:text-fg">
        <Icon name="chevron" size={9} className={abierto ? "rotate-180" : ""} />
        Ver crudo
      </button>
      {abierto && (
        <pre className="mt-1.5 max-h-[160px] overflow-auto whitespace-pre-wrap rounded-md bg-black/[.25]
          p-2 font-mono text-[10px] leading-relaxed text-muted">
          {texto}
        </pre>
      )}
    </div>
  );
}

/** El resultado de un agente fusionado (spec 2026-09-10 §1): un único card
 *  con una fila por sub-pregunta, en vez de un card suelto por cada una —
 *  es la misma pantalla de dos columnas, pero la columna de la derecha lista
 *  en vez de mostrar una sola respuesta con hipótesis alternativas (cada
 *  sub-pregunta ya es su propia respuesta cerrada, sin alternativas que
 *  enseñar aparte). */
function PantallaResultadoFusionado({ image, motor, subRespuestas }: {
  image: Image;
  motor: string | null;
  subRespuestas: DichoDeAgente[];
}) {
  return (
    <div className="mt-4 grid grid-cols-[1.4fr_1fr] gap-0 overflow-hidden rounded-xl border border-border bg-panel"
      style={{ animation: "jg-fade-rise 280ms cubic-bezier(.16,1,.3,1) both" }}>
      <div className="relative aspect-[3/2] bg-elevated">
        <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
          className="h-full w-full object-cover" />
      </div>
      <div className="flex flex-col gap-3 p-6">
        <div className="flex items-center gap-2.5 rounded-lg bg-white/[.03] p-2"
          style={{ animation: "jg-fade-rise 280ms ease-expo both 40ms" }}>
          <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
            className="h-9 w-11 shrink-0 rounded object-cover" />
          <div className="min-w-0">
            <div className="truncate font-mono text-[10.5px] text-fg">{image.filename}</div>
            <div className="mt-0.5 font-mono text-[9px] text-subtle">motor · {motor ?? "?"}</div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          {subRespuestas.map((d, i) => {
            const subId = d.agente.split(".").pop() ?? d.agente;
            const abstiene = d.etiqueta === "abstiene";
            const mejorEtiqueta = abstiene ? (d.etiqueta_real || d.etiqueta) : d.etiqueta;
            return (
              <div key={d.agente} className="flex items-center gap-2.5 rounded-md border border-border
                  bg-black/[.15] p-2.5"
                style={{ animation: `jg-fade-rise 280ms ease-expo both ${90 + i * 45}ms` }}>
                <AgenteIcono agente={subId} etiqueta={abstiene ? undefined : d.etiqueta} apagado={abstiene} size={18} />
                <div className="min-w-0 flex-1">
                  <div className="text-[9px] uppercase tracking-[.06em] text-subtle">{etiquetaCortaDe(subId)}</div>
                  <div className={`mt-0.5 truncate text-[12.5px] ${abstiene ? "text-subtle italic" : "text-fg"}`}>
                    {abstiene
                      ? (mejorEtiqueta ? `¿${mejorEtiqueta}? (sin confianza suficiente)` : "sin suficiente confianza")
                      : (d.detalle || d.etiqueta)}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-subtle">{Math.round(d.confianza * 100)}%</span>
              </div>
            );
          })}
        </div>

        <div className="mt-auto flex items-center gap-1.5 border-t border-border pt-3"
          style={{ animation: "jg-fade-rise 280ms ease-expo both 220ms" }}>
          <Icon name="check" size={12} className="text-fg" />
          <span className="text-[10.5px] text-fg">verificado por {motor ?? "el motor del agente"}</span>
        </div>
        {/* Las sub-respuestas de una misma llamada comparten el mismo JSON
            crudo (una sola llamada de inferencia, spec 2026-09-10 §1) -- se
            enseña una vez para el grupo, no repetido por fila. */}
        {(() => {
          const crudo = subRespuestas.find((d) => d.respuesta_cruda)?.respuesta_cruda;
          return crudo ? <VerCrudo texto={crudo} /> : null;
        })()}
      </div>
    </div>
  );
}
