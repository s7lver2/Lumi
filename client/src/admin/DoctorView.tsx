import { useCallback, useEffect, useId, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type MuestraHistorial, type Problema, type SaludView } from "../lib/api";
import { startLogsStream } from "../lib/bridge";
import { Icon } from "../ui/Icon";
import { Seccion } from "./AdminPanel";
import type { Seccion as SeccionId } from "./Sidebar";

type Vista = "logs" | "historial";
type Nivel = 0 | 1 | 2 | 3;
const NIVEL_RANGO: Record<string, number> = { INFO: 1, WARN: 2, ERROR: 3 };

interface Linea {
  texto: string;
  nivel: string | null;
  modulo: string | null;
}

/** Formato real de `tracing_subscriber::fmt::init()`, confirmado contra el
 *  journal en producción: `TIMESTAMP  NIVEL target: mensaje`. Una línea que
 *  no matchea (un panic con backtrace, por ejemplo) se muestra igual, sin
 *  nivel ni módulo — nunca se oculta por el filtro de nivel. */
const RE_LINEA = /^\S+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+([^:]+):\s*(.*)$/;

function parsear(texto: string): Linea {
  const m = RE_LINEA.exec(texto);
  return m ? { texto, nivel: m[1], modulo: m[2] } : { texto, nivel: null, modulo: null };
}

export function DoctorView({ token, onIr }: { token: string; onIr: (s: SeccionId) => void }) {
  const [vista, setVista] = useState<Vista>(
    () => (localStorage.getItem("lumi.doctor.vista") as Vista) ?? "logs"
  );
  useEffect(() => { localStorage.setItem("lumi.doctor.vista", vista); }, [vista]);

  // "ver log" en una tarjeta de problema tiene que notarse SIEMPRE, incluso
  // si ya estás mirando Logs (el caso más común, ya que es la vista por
  // defecto) — cambiar de vista no basta ahí, así que además se manda una
  // señal que baja el scroll del todo y da un parpadeo al panel.
  const [senalLogs, setSenalLogs] = useState(0);
  const irALogs = () => { setVista("logs"); setSenalLogs((n) => n + 1); };

  return (
    <Seccion titulo="Doctor" grupo="Operación">
      <SaludPanel token={token} onIr={onIr} irALogs={irALogs} />

      <div className="mt-[26px] flex items-center justify-between border-b border-border pb-2.5">
        <span className="text-[12.5px] text-fg">Detalle</span>
        <div className="relative flex w-[196px] rounded-[9px] border border-border bg-surface p-[3px]">
          <span className="absolute left-[3px] top-[3px] h-[calc(100%-6px)] w-[92px] rounded-[7px] bg-elevated
            shadow-[0_1px_0_rgba(255,255,255,.04)] transition-transform duration-[420ms] ease-expo"
            style={{ transform: vista === "historial" ? "translateX(92px)" : "translateX(0)" }} />
          {(["logs", "historial"] as const).map((v) => (
            <button key={v} onClick={() => setVista(v)}
              className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 py-[6px] text-[10.5px]
                transition-colors duration-300 ease-expo ${vista === v ? "text-fg" : "text-subtle hover:text-muted"}`}>
              <Icon name={v === "logs" ? "cli" : "bars"} size={11} />
              {v === "logs" ? "Logs" : "Histórico"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-[19px]">
        {vista === "logs" ? <LogsPane token={token} senal={senalLogs} /> : <HistoricoPane token={token} />}
      </div>
    </Seccion>
  );
}

function SaludPanel({ token, onIr, irALogs }: {
  token: string; onIr: (s: SeccionId) => void; irALogs: () => void;
}) {
  const [salud, setSalud] = useState<SaludView | null>(null);
  const [arreglando, setArreglando] = useState<Record<string, boolean>>({});
  const [resueltos, setResueltos] = useState<Record<string, boolean>>({});

  const cargar = useCallback(() => {
    api.saludGet(token).then((v) => {
      // Un problema que ya no aparece en la respuesta se queda marcado como
      // "resuelto" en pantalla un momento más — desaparecer de golpe deja de
      // comunicar que se arregló.
      setSalud((prev) => {
        if (prev) {
          const idsAntes = new Set(prev.problemas.map((p) => p.id));
          const idsAhora = new Set(v.problemas.map((p) => p.id));
          const desaparecidos = [...idsAntes].filter((id) => !idsAhora.has(id));
          if (desaparecidos.length) {
            setResueltos((r) => ({ ...r, ...Object.fromEntries(desaparecidos.map((id) => [id, true])) }));
          }
        }
        return v;
      });
    }).catch(() => {});
  }, [token]);

  useEffect(() => {
    void cargar();
    const id = setInterval(cargar, 10_000);
    return () => clearInterval(id);
  }, [cargar]);

  async function arreglar(p: Problema) {
    setArreglando((s) => ({ ...s, [p.id]: true }));
    try {
      if (p.id.startsWith("trabajador:")) {
        await api.arreglarTrabajador(p.id.slice("trabajador:".length), token);
      } else if (p.id === "qdrant") {
        await api.arreglarQdrant(token);
      }
    } catch {
      // Un fallo al disparar el arreglo se ve en el propio problema, que
      // sigue apareciendo en el siguiente sondeo — no hace falta un error
      // aparte.
    } finally {
      setArreglando((s) => ({ ...s, [p.id]: false }));
      void cargar();
    }
  }

  const activos = salud?.problemas ?? [];
  const idsResueltosVisibles = Object.keys(resueltos).filter((id) => !activos.some((p) => p.id === id));

  return (
    <div>
      <div className="flex items-center gap-3.5 rounded-[14px] border border-border/70 bg-panel p-[14px_18px]"
        style={{ animation: "jg-fade-rise .4s cubic-bezier(.16,1,.3,1) both" }}>
        <span className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] border transition-colors
          ${activos.length ? "border-warning/30 text-warning-fg" : "border-border text-muted"} bg-elevated`}>
          <Icon name={activos.length ? "alert" : "check"} size={16} />
        </span>
        <div>
          <p className="text-[13.5px] text-fg">
            {activos.length === 0
              ? (idsResueltosVisibles.length ? "Arreglado" : "Todo en orden")
              : activos.length === 1 ? "1 problema activo" : `${activos.length} problemas activos`}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {activos.length === 0
              ? (idsResueltosVisibles.length ? "Los problemas detectados ya se resolvieron." : "Sin problemas detectados en el servidor.")
              : activos.map((p) => p.titulo).join(" · ")}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {activos.map((p) => (
          <div key={p.id}
            className="flex items-center gap-3.5 rounded-xl border border-warning/25 bg-warning/[.05] p-3 px-4"
            style={{ animation: "jg-fade-rise .35s cubic-bezier(.16,1,.3,1) both" }}>
            <Icon name="alert" size={16} className="shrink-0 text-warning-fg" />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-fg">{p.titulo}</div>
              <div className="mt-0.5 text-[10.5px] text-subtle">{p.detalle}</div>
            </div>
            {p.accion ? (
              <button disabled={!!arreglando[p.id]} onClick={() => void arreglar(p)}
                className="jg-press flex shrink-0 items-center gap-1.5 rounded-[7px] border border-white/[.18]
                  bg-elevated px-3 py-1.5 text-[10.5px] text-fg disabled:opacity-55">
                {arreglando[p.id] && <Icon name="spinner" size={11} />}
                {p.accion}
              </button>
            ) : (
              <button onClick={() => (p.enlace === "doctor:logs" ? irALogs() : onIr(p.enlace as SeccionId))}
                className="shrink-0 text-[10.5px] text-muted underline decoration-dotted underline-offset-2">
                {p.enlace === "doctor:logs" ? "ver log" : "ir a Hardware"}
              </button>
            )}
          </div>
        ))}
        {idsResueltosVisibles.map((id) => (
          <div key={id} className="flex items-center gap-3.5 rounded-xl border border-border/70 bg-panel p-3 px-4">
            <Icon name="check" size={16} className="shrink-0 text-fg" />
            <div className="text-[12px] text-fg">Arreglado</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LogsPane({ token, senal }: { token: string; senal: number }) {
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [nivelMin, setNivelMin] = useState<Nivel>(0);
  const [modulo, setModulo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resaltado, setResaltado] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    void startLogsStream(token);
    const unLinea = listen<string>("logs-line", (e) => {
      if (!vivo) return;
      setLineas((prev) => {
        const siguiente = [...prev, parsear(e.payload)];
        // Tope de líneas en memoria: una pestaña de logs abierta mucho rato
        // no debe crecer sin límite.
        return siguiente.length > 2000 ? siguiente.slice(siguiente.length - 2000) : siguiente;
      });
    });
    const unError = listen<string>("logs-error", (e) => { if (vivo) setError(e.payload); });
    return () => { vivo = false; void unLinea.then((f) => f()); void unError.then((f) => f()); };
  }, [token]);

  useEffect(() => {
    const el = paneRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lineas]);

  // Reacciona a "ver log" aunque no haya cambio de vista que enseñar (ya
  // estabas en Logs): baja del todo y da un parpadeo breve al borde.
  useEffect(() => {
    if (senal === 0) return;
    const el = paneRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setResaltado(true);
    const t = setTimeout(() => setResaltado(false), 900);
    return () => clearTimeout(t);
  }, [senal]);

  const visibles = lineas.filter((l) => {
    const pasaModulo = !modulo.trim() || (l.modulo?.toLowerCase().includes(modulo.trim().toLowerCase()) ?? false);
    if (!pasaModulo) return false;
    // Una línea sin nivel reconocido (un panic con backtrace, por ejemplo)
    // nunca se oculta por el filtro de nivel — solo por el de módulo, de
    // arriba.
    if (l.nivel == null) return true;
    return nivelMin === 0 || NIVEL_RANGO[l.nivel] >= nivelMin;
  });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2.5">
        <select value={nivelMin} onChange={(e) => setNivelMin(Number(e.target.value) as Nivel)}
          className="rounded-[7px] border border-border bg-panel px-2.5 py-1.5 text-[10.5px] text-fg outline-none">
          <option value={0}>todos los niveles</option>
          <option value={1}>INFO y superior</option>
          <option value={2}>WARN y superior</option>
          <option value={3}>solo ERROR</option>
        </select>
        <input value={modulo} onChange={(e) => setModulo(e.target.value)}
          placeholder="filtrar por módulo (ej. lumid::queue)"
          className="w-[240px] rounded-[7px] border border-border bg-panel px-2.5 py-1.5 text-[10.5px]
            text-fg outline-none placeholder:text-subtle" />
        <span className="ml-auto font-mono text-[9.5px] text-subtle">{visibles.length} líneas</span>
      </div>
      {error && <p className="mb-2 text-[11px] text-danger-fg">{error}</p>}
      <div ref={paneRef} className={`h-[520px] overflow-y-auto rounded-xl border bg-[#0c0d0f] py-2.5
        transition-colors duration-300 ease-expo ${resaltado ? "border-white/40" : "border-border"}`}>
        {visibles.map((l, i) => (
          <div key={i} className="px-3.5 py-[2px] font-mono text-[11px] leading-[1.55]">
            {l.nivel && (
              <span className={`mr-2 inline-block w-[38px] font-medium ${
                l.nivel === "ERROR" ? "text-danger-fg" : l.nivel === "WARN" ? "text-warning-fg" : "text-subtle"}`}>
                {l.nivel}
              </span>
            )}
            {l.modulo && <span className="mr-2 text-muted">{l.modulo}:</span>}
            <span className="text-fg">{l.nivel ? l.texto.replace(RE_LINEA, "$3") : l.texto}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatoHora(ts: number, rango: "1h" | "24h" | "7d"): string {
  const d = new Date(ts * 1000);
  return rango === "7d"
    ? d.toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const RANGO_S: Record<"1h" | "24h" | "7d", number> = { "1h": 3600, "24h": 86400, "7d": 7 * 86400 };

function formatoTranscurrido(segundos: number): string {
  if (segundos < 3600) return `${Math.round(segundos / 60)} min`;
  if (segundos < 86400) return `${Math.round(segundos / 3600)} h`;
  return `${Math.round(segundos / 86400)} d`;
}

function HistoricoPane({ token }: { token: string }) {
  const [rango, setRango] = useState<"1h" | "24h" | "7d">("24h");
  const [datos, setDatos] = useState<MuestraHistorial[] | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // Cuál de las tres tarjetas tiene el ratón encima de verdad — solo esa
  // dibuja la línea/punto sobre su propio gráfico. Comparar métricas se
  // resuelve con la fila de valores de abajo, no fingiendo que el cursor
  // está a la vez en las tres.
  const [hoverCard, setHoverCard] = useState<string | null>(null);

  useEffect(() => {
    // Al cambio de rango, la vieja serie desaparece en vez de quedarse
    // pegada en pantalla mientras llega la nueva — sin esto, si las dos
    // peticiones devuelven un tamaño de array parecido, cambiar de rango
    // podía parecer que no hacía nada hasta que de verdad se miraban los
    // valores.
    setDatos(null);
    setHoverIdx(null);
    setHoverCard(null);
    api.historialGet(rango, token).then(setDatos).catch(() => setDatos([]));
  }, [rango, token]);

  const foco = hoverIdx != null && datos ? datos[hoverIdx] : datos?.at(-1);
  // Si la muestra más antigua es más reciente que el rango pedido, todavía
  // no hay suficiente historial para que este rango se vea distinto del
  // inmediatamente más corto — no es un fallo del selector, es que Doctor
  // lleva poco tiempo recogiendo datos.
  const antiguedad = datos && datos.length > 0 ? Math.floor(Date.now() / 1000) - datos[0].created_at : null;
  const historialCorto = antiguedad != null && antiguedad < RANGO_S[rango] * 0.9;

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex gap-1.5">
          {(["1h", "24h", "7d"] as const).map((r) => (
            <button key={r} onClick={() => setRango(r)}
              className={`rounded-[7px] border px-3.5 py-1.5 text-[10.5px] transition-colors duration-300 ease-expo ${
                rango === r ? "border-white/30 bg-elevated text-fg" : "border-border bg-panel text-subtle"}`}>
              {r}
            </button>
          ))}
        </div>
        {foco && (
          <span className="flex items-center gap-3 font-mono text-[10px] text-subtle">
            <span>{formatoHora(foco.created_at, rango)}</span>
            <span>CPU {foco.cpu_pct.toFixed(0)}%</span>
            <span>RAM {foco.ram_used_mb.toFixed(0)}MB</span>
            <span>disco {foco.disk_free_mb.toFixed(0)}MB</span>
          </span>
        )}
      </div>
      {historialCorto && (
        <p className="mb-3 text-[10.5px] text-subtle">
          Doctor solo lleva {formatoTranscurrido(antiguedad!)} recogiendo muestras — este rango se verá igual que uno
          más corto hasta que pase más tiempo.
        </p>
      )}
      {datos === null ? <p className="text-[11px] text-subtle">cargando</p> : datos.length === 0 ? (
        <p className="text-[11px] text-subtle">aún no hay muestras en este rango.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3.5">
          <MetricCard id="cpu" label="CPU" unidad="%" datos={datos} campo={(d) => d.cpu_pct}
            hoverIdx={hoverIdx} activa={hoverCard === "cpu"}
            onHover={(i) => { setHoverIdx(i); setHoverCard(i == null ? null : "cpu"); }} />
          <MetricCard id="ram" label="RAM usada" unidad="MB" datos={datos} campo={(d) => d.ram_used_mb}
            hoverIdx={hoverIdx} activa={hoverCard === "ram"}
            onHover={(i) => { setHoverIdx(i); setHoverCard(i == null ? null : "ram"); }} />
          <MetricCard id="disco" label="Disco libre" unidad="MB" datos={datos} campo={(d) => d.disk_free_mb}
            hoverIdx={hoverIdx} activa={hoverCard === "disco"}
            onHover={(i) => { setHoverIdx(i); setHoverCard(i == null ? null : "disco"); }} />
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, unidad, datos, campo, hoverIdx, activa, onHover }: {
  id: string; label: string; unidad: string; datos: MuestraHistorial[]; campo: (d: MuestraHistorial) => number;
  hoverIdx: number | null; activa: boolean; onHover: (i: number | null) => void;
}) {
  const valores = datos.map(campo);
  // Mientras otra tarjeta tiene el foco, esta sigue mostrando su propio
  // último valor — no el del instante que se está mirando en otro sitio,
  // que es justo lo que "activa" evita mezclar.
  const enFoco = activa && hoverIdx != null ? valores[hoverIdx] : valores.at(-1);
  return (
    <div className="rounded-[14px] border border-border/70 bg-panel p-4">
      <span className="text-[10.5px] text-muted">{label}</span>
      <div className="mt-0.5 font-mono text-[20px] text-fg">
        {enFoco != null ? enFoco.toFixed(0) : "—"}<small className="ml-0.5 text-[10px] text-subtle">{unidad}</small>
      </div>
      {valores.length > 1 && (
        <Sparkline valores={valores} hoverIdx={activa ? hoverIdx : null} onHover={onHover} />
      )}
    </div>
  );
}

/** Curva suavizada con Bézier por puntos medios y relleno con degradado —
 *  mismo dibujo ya validado en el mockup interactivo de la sesión de
 *  brainstorming (`doctor-full.html`), sin librería de gráficas nueva.
 *  `hoverIdx` llega en `null` cuando el ratón está sobre OTRA tarjeta: cada
 *  gráfico solo dibuja su línea/punto cuando el cursor está de verdad
 *  encima, nunca los tres a la vez. */
function Sparkline({ valores, ancho = 280, alto = 56, hoverIdx, onHover }: {
  valores: number[]; ancho?: number; alto?: number;
  hoverIdx: number | null; onHover: (i: number | null) => void;
}) {
  const ref = useRef<SVGPathElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Un id de gradiente estable por instancia del componente, para que dos
  // `<svg>` en la misma página no compartan el mismo `id` de `<linearGradient>`.
  const id = `sp-${useId()}`;
  const max = Math.max(...valores), min = Math.min(...valores);
  const paso = ancho / (valores.length - 1);
  const y = (v: number) => alto - 6 - ((v - min) / (max - min || 1)) * (alto - 12);
  const pts = valores.map((v, i) => [i * paso, y(v)] as const);
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C ${mx.toFixed(1)} ${y0.toFixed(1)}, ${mx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  const area = `${d} L ${pts.at(-1)![0].toFixed(1)} ${alto} L 0 ${alto} Z`;

  useEffect(() => {
    const p = ref.current;
    if (!p) return;
    const len = p.getTotalLength();
    p.style.strokeDasharray = String(len);
    p.style.strokeDashoffset = String(len);
    p.getBoundingClientRect();
    p.style.transition = "stroke-dashoffset .85s cubic-bezier(.16,1,.3,1)";
    requestAnimationFrame(() => { p.style.strokeDashoffset = "0"; });
  }, [d]);

  function moverRaton(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xRel = ((e.clientX - rect.left) / rect.width) * ancho;
    const idx = Math.round(xRel / paso);
    onHover(Math.max(0, Math.min(valores.length - 1, idx)));
  }

  return (
    <svg ref={svgRef} viewBox={`0 0 ${ancho} ${alto}`} className="mt-2.5 block w-full cursor-crosshair"
      style={{ height: alto }} onMouseMove={moverRaton} onMouseLeave={() => onHover(null)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e8e8e6" stopOpacity=".16" />
          <stop offset="100%" stopColor="#e8e8e6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={0} y1={alto * f} x2={ancho} y2={alto * f} stroke="rgba(255,255,255,.05)" strokeDasharray="2 3" />
      ))}
      <path d={area} fill={`url(#${id})`} stroke="none" />
      <path ref={ref} d={d} fill="none" stroke="#e8e8e6" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      {hoverIdx != null && pts[hoverIdx] && (
        <>
          <line x1={pts[hoverIdx][0]} y1={0} x2={pts[hoverIdx][0]} y2={alto}
            stroke="rgba(255,255,255,.22)" strokeWidth={1} />
          <circle cx={pts[hoverIdx][0]} cy={pts[hoverIdx][1]} r={3} fill="#e8e8e6" />
        </>
      )}
    </svg>
  );
}
