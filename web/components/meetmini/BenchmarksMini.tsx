"use client";
import { useEffect, useRef, useState } from "react";
import { usarRevelado } from "../usarRevelado";

/** Dos cosas muy distintas conviven aquí, y no se mezclan en la misma barra:
 *
 *  1. Precisión frente al estado del arte publicado (GeoCLIP, PIGEON) — cifras
 *     REALES, citadas con su fuente. Ninguna es del mismo banco de pruebas
 *     que el otro (Im2GPS3k contra el test held-out de GeoGuessr de PIGEON),
 *     así que se comparan en el único terreno común que publican los tres:
 *     acierto a 25 km (nivel ciudad) — y se dice explícitamente que no es
 *     una carrera en igualdad de condiciones, solo el mejor punto de
 *     referencia posible con lo que hay publicado.
 *  2. Recursos que pide Mini (VRAM, tiempo de respuesta, degradación bajo
 *     concurrencia) — esto SÍ es solo de Mini, no una comparativa: ni GeoCLIP
 *     ni PIGEON publican esas cifras, así que inventárselas encima de un
 *     producto real de otro equipo sería peor que no mostrarlas. Van
 *     marcadas como cifras de ejemplo propias, pendientes de un benchmark
 *     real (`tools/` traerá el script de Python que las mida de verdad). */

type Externo = {
  id: string;
  nombre: string;
  ciudad25km: number; // % de acierto a 25 km, tal cual publicado
  fuente: string;
  url: string;
};

// GeoCLIP (NeurIPS 2023): tabla de Im2GPS3k, corroborada en múltiples copias
// del paper. PIGEON (CVPR 2024): la propia página del proyecto da esta cifra
// para su test held-out de partidas de GeoGuessr — no publican el resto de
// la tabla de umbrales con el mismo detalle que GeoCLIP.
const EXTERNOS: Externo[] = [
  { id: "geoclip", nombre: "GeoCLIP", ciudad25km: 34.47, fuente: "Im2GPS3k, paper NeurIPS 2023", url: "https://arxiv.org/abs/2309.16020" },
  { id: "pigeon", nombre: "PIGEON", ciudad25km: 40, fuente: "test held-out de GeoGuessr, paper CVPR 2024", url: "https://arxiv.org/abs/2307.05845" },
];

const MINI_CIUDAD25KM = 62; // ejemplo propio, pendiente de medir con el mismo rigor

const CONCURRENCIA = [1, 5, 10, 20, 40];
const MINI_ESTRES = [1.4, 1.6, 2.1, 3.4, 6.0]; // segundos, ejemplo
const MINI_VRAM = 3.2; // GB, ejemplo
const MINI_DESGLOSE = { recuperacion: 0.3, verificacion: 0.4, agentes: 0.7 }; // segundos, ejemplo

/** Cuenta desde 0 hasta `hasta` una sola vez, cuando `activo` pasa a true —
 *  mismo disparador que las barras (`usarRevelado`), sin un segundo
 *  observer. Sin esto los números aparecían ya puestos, que era justo la
 *  queja de que el panel se sentía estático. */
function useConteo(hasta: number, activo: boolean, decimales = 0) {
  const [valor, setValor] = useState(0);
  const hechoRef = useRef(false);
  useEffect(() => {
    if (!activo || hechoRef.current) return;
    hechoRef.current = true;
    const duracion = 900;
    const inicio = performance.now();
    let id: number;
    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - inicio) / duracion);
      const suavizado = 1 - Math.pow(1 - t, 3);
      setValor(hasta * suavizado);
      if (t < 1) id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [activo, hasta]);
  return valor.toFixed(decimales);
}

function BarraNombrada({
  etiqueta, valor, max, formatear, activo, visible, retraso, decimales = 0,
}: {
  etiqueta: string; valor: number; max: number; formatear: (v: number) => string;
  activo?: boolean; visible: boolean; retraso: number; decimales?: number;
}) {
  const contado = useConteo(valor, visible, decimales);
  return (
    <div
      className="grid grid-cols-[92px_1fr_64px] items-center gap-3"
      style={visible ? { animation: `jg-reveal-up .5s cubic-bezier(.16,1,.3,1) both ${retraso}s` } : { opacity: 0 }}
    >
      <span className={`text-[12px] ${activo ? "text-fg" : "text-muted"}`}>{etiqueta}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
        <div
          className={`h-full rounded-full jg-barra-llena ${activo ? "bg-fg" : "bg-subtle/50"}`}
          style={{ "--fin": `${Math.min(100, (valor / max) * 100)}%`, animationDelay: `${retraso + 0.1}s` } as React.CSSProperties}
        />
      </div>
      <span className="text-right font-mono text-[12px] text-fg">{formatear(Number(contado))}</span>
    </div>
  );
}

/** Barra apilada: a qué se le va el tiempo en una consulta típica de Mini —
 *  no hay con qué comparar esto en GeoCLIP/PIGEON (no publican ese
 *  desglose), así que es solo de Mini, no una carrera entre productos. */
function DesgloseTiempo({ visible, retraso }: { visible: boolean; retraso: number }) {
  const total = MINI_DESGLOSE.recuperacion + MINI_DESGLOSE.verificacion + MINI_DESGLOSE.agentes;
  const segmentos = [
    { etiqueta: "recuperación", valor: MINI_DESGLOSE.recuperacion, clase: "bg-fg" },
    { etiqueta: "verificación", valor: MINI_DESGLOSE.verificacion, clase: "bg-fg/55" },
    { etiqueta: "agentes", valor: MINI_DESGLOSE.agentes, clase: "bg-fg/25" },
  ];
  return (
    <div style={visible ? { animation: `jg-reveal-up .5s cubic-bezier(.16,1,.3,1) both ${retraso}s` } : { opacity: 0 }}>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">a qué se le va el tiempo</span>
        <span className="font-mono text-[11px] text-subtle">{total.toFixed(1)}s en total, de ejemplo</span>
      </div>
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-elevated">
        {segmentos.map((s, i) => (
          <div
            key={s.etiqueta}
            className={`h-full shrink-0 jg-barra-llena ${s.clase}`}
            style={{ "--fin": `${(s.valor / total) * 100}%`, animationDelay: `${retraso + 0.15 + i * 0.1}s` } as React.CSSProperties}
          />
        ))}
      </div>
      <div className="mt-1.5 flex gap-4">
        {segmentos.map((s) => (
          <span key={s.etiqueta} className="text-[10.5px] text-subtle">{s.etiqueta} · {s.valor.toFixed(1)}s</span>
        ))}
      </div>
    </div>
  );
}

/** Tiempo de respuesta de Mini según cuántas consultas llegan a la vez —
 *  dibujado con el mismo truco SMIL que ya usa `LineaHoraDia` en
 *  `AgentesVisual.tsx` (stroke-dasharray a la longitud real del trazo,
 *  dashoffset animado de esa longitud a 0): la línea se traza, no aparece
 *  ya puesta. */
function GraficoEstres({ visible }: { visible: boolean }) {
  const PAD_I = 30, PAD_D = 14, PAD_S = 12, PAD_B = 22;
  const ANCHO = 560, ALTO = 160;
  const w = ANCHO - PAD_I - PAD_D, h = ALTO - PAD_S - PAD_B;
  const max = Math.max(...MINI_ESTRES) * 1.15;
  const x = (i: number) => PAD_I + (i / (CONCURRENCIA.length - 1)) * w;
  const y = (seg: number) => PAD_S + h - (seg / max) * h;

  const puntos = MINI_ESTRES.map((s, i) => `${x(i)},${y(s)}`).join(" ");
  let longitud = 0;
  for (let i = 1; i < MINI_ESTRES.length; i++) {
    const dx = x(i) - x(i - 1), dy = y(MINI_ESTRES[i]) - y(MINI_ESTRES[i - 1]);
    longitud += Math.sqrt(dx * dx + dy * dy);
  }

  return (
    <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} className="w-full" role="img" aria-label="Tiempo de respuesta de Mini según concurrencia">
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={PAD_I} x2={ANCHO - PAD_D} y1={PAD_S + h * f} y2={PAD_S + h * f} stroke="rgba(232,232,230,.08)" />
      ))}
      {[0, 0.5, 1].map((f) => (
        <text key={f} x={PAD_I - 6} y={PAD_S + h * (1 - f) + 3} textAnchor="end" fontSize="8.5"
          fill="rgba(232,232,230,.4)" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
          {(max * f).toFixed(1)}s
        </text>
      ))}
      {CONCURRENCIA.map((c, i) => (
        <text key={c} x={x(i)} y={ALTO - 6} textAnchor="middle" fontSize="8.5"
          fill="rgba(232,232,230,.4)" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
          {c} a la vez
        </text>
      ))}
      <polyline points={puntos} fill="none" stroke="#e8e8e6" strokeWidth={2}
        strokeDasharray={longitud} strokeDashoffset={visible ? 0 : longitud}>
        {visible && (
          <animate
            attributeName="stroke-dashoffset"
            from={longitud} to={0}
            begin="0s" dur=".9s" fill="freeze"
            calcMode="spline" keySplines=".16 1 .3 1"
          />
        )}
      </polyline>
      {MINI_ESTRES.map((s, i) => (
        <circle key={i} cx={x(i)} cy={y(s)} r={2.6} fill="#e8e8e6"
          opacity={visible ? 1 : 0} style={{ transition: `opacity .3s ${0.9 + i * 0.05}s` }} />
      ))}
    </svg>
  );
}

export function BenchmarksMini() {
  const { ref, visible } = usarRevelado<HTMLElement>();
  const maxCiudad = Math.max(MINI_CIUDAD25KM, ...EXTERNOS.map((e) => e.ciudad25km));

  return (
    <section ref={ref} id="benchmarks" className="mx-auto max-w-[760px] px-7 py-28">
      <span
        className="font-mono text-[11px] uppercase tracking-wide text-subtle"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both" } : { opacity: 0 }}
      >
        frente al estado del arte
      </span>
      <h2
        className="mt-2 text-[clamp(24px,3.4vw,36px)] font-semibold tracking-tight"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .05s" } : { opacity: 0 }}
      >
        Comparado con lo que ya se publica
      </h2>
      <p
        className="mt-3 max-w-[70ch] leading-relaxed text-muted"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .1s" } : { opacity: 0 }}
      >
        GeoCLIP y PIGEON son investigación publicada, no productos de Lumi — sus cifras de abajo
        son las que reportan sus propios papers, no una medición nuestra. Ninguno usa el mismo
        banco de pruebas: se comparan en el único terreno común que los tres publican, acierto a
        25 km (nivel ciudad), no en igualdad de condiciones perfecta.
      </p>

      <div
        className="mt-10 flex flex-col gap-2.5"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .2s" } : { opacity: 0 }}
      >
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">acierto a 25 km</span>
        <BarraNombrada etiqueta="Lumi Mini" valor={MINI_CIUDAD25KM} max={maxCiudad}
          formatear={(v) => `${Math.round(v)}%`} activo visible={visible} retraso={0.3} />
        {EXTERNOS.map((e, i) => (
          <BarraNombrada key={e.id} etiqueta={e.nombre} valor={e.ciudad25km} max={maxCiudad}
            formatear={(v) => `${v % 1 === 0 ? Math.round(v) : v.toFixed(2)}%`}
            visible={visible} retraso={0.38 + i * 0.08} />
        ))}
        <p className="mt-1 text-[11px] text-subtle">
          Lumi Mini: cifra de ejemplo, todavía sin medir con el mismo rigor.{" "}
          {EXTERNOS.map((e, i) => (
            <span key={e.id}>
              {e.nombre}:{" "}
              <a href={e.url} target="_blank" rel="noreferrer" className="underline decoration-subtle underline-offset-2 hover:text-fg">
                {e.fuente}
              </a>
              {i < EXTERNOS.length - 1 ? ". " : "."}
            </span>
          ))}
        </p>
      </div>

      <div
        className="mt-14 rounded-card border border-border bg-panel p-4"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .3s" } : { opacity: 0 }}
      >
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">lo que pide Mini</span>
          <span className="font-mono text-[10px] text-subtle">GeoCLIP y PIGEON no publican esto — no hay con qué comparar</span>
        </div>

        <div className="mt-4">
          <BarraNombrada etiqueta="VRAM" valor={MINI_VRAM} max={MINI_VRAM * 1.4}
            formatear={(v) => `${v.toFixed(1)} GB`} activo visible={visible} retraso={0.42} decimales={1} />
          <p className="mt-1.5 text-[11.5px] text-subtle">Cabe en una GPU de consumo con 4 GB libres.</p>
        </div>

        <div className="mt-6 border-t border-border pt-4">
          <DesgloseTiempo visible={visible} retraso={0.5} />
        </div>

        <div className="mt-6 border-t border-border pt-4">
          <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">bajo concurrencia</span>
          <div className="mt-2">
            <GraficoEstres visible={visible} />
          </div>
        </div>
      </div>

      <p
        className="mt-6 text-center font-mono text-[10px] text-subtle"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .6s" } : { opacity: 0 }}
      >
        *VRAM, desglose de tiempo y concurrencia son cifras de ejemplo propias de Mini, todavía
        sin medir — se sustituirán por un benchmark real hecho con Python.
      </p>
    </section>
  );
}
