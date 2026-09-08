"use client";
import { useEffect, useRef, useState } from "react";
import { usarRevelado } from "../usarRevelado";

/** Mismo criterio que `BenchmarksMini`: la comparativa con GeoCLIP/PIGEON
 *  usa las cifras REALES que publican sus propios papers (misma fuente
 *  citada allí); la cifra de Pro es un ejemplo propio, pendiente de medir
 *  con un banco de fotos que NO estén ya en el índice (el único resultado
 *  real que existe hoy, `resultados.json`, es de `mini` contra fotos que
 *  SÍ estaban indexadas — memorización, no generalización, así que no vale
 *  para esta comparación y no se usa aquí). */

type Externo = { id: string; nombre: string; ciudad25km: number; fuente: string; url: string };

const EXTERNOS: Externo[] = [
  { id: "geoclip", nombre: "GeoCLIP", ciudad25km: 34.47, fuente: "Im2GPS3k, paper NeurIPS 2023", url: "https://arxiv.org/abs/2309.16020" },
  { id: "pigeon", nombre: "PIGEON", ciudad25km: 40, fuente: "test held-out de GeoGuessr, paper CVPR 2024", url: "https://arxiv.org/abs/2307.05845" },
];
const PRO_CIUDAD25KM = 78; // ejemplo propio, pendiente de medir con un banco held-out

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
  etiqueta, valor, max, formatear, activo, visible, retraso,
}: {
  etiqueta: string; valor: number; max: number; formatear: (v: number) => string;
  activo?: boolean; visible: boolean; retraso: number;
}) {
  const contado = useConteo(valor, visible);
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

export function BenchmarksPro() {
  const { ref, visible } = usarRevelado<HTMLElement>();
  const maxCiudad = Math.max(PRO_CIUDAD25KM, ...EXTERNOS.map((e) => e.ciudad25km));

  return (
    <section ref={ref} className="mx-auto max-w-[760px] px-7 py-28">
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
        Más motores compitiendo, más precisión
      </h2>
      <p
        className="mt-3 max-w-[70ch] leading-relaxed text-muted"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .1s" } : { opacity: 0 }}
      >
        GeoCLIP y PIGEON son investigación publicada, no productos de Lumi — sus cifras son las
        que reportan sus propios papers. Ninguno usa el mismo banco de pruebas: se comparan en el
        único terreno común que los tres publican, acierto a 25 km (nivel ciudad).
      </p>

      <div
        className="mt-10 flex flex-col gap-2.5"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .2s" } : { opacity: 0 }}
      >
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">acierto a 25 km</span>
        <BarraNombrada etiqueta="Lumi Pro" valor={PRO_CIUDAD25KM} max={maxCiudad}
          formatear={(v) => `${Math.round(v)}%`} activo visible={visible} retraso={0.3} />
        {EXTERNOS.map((e, i) => (
          <BarraNombrada key={e.id} etiqueta={e.nombre} valor={e.ciudad25km} max={maxCiudad}
            formatear={(v) => `${v % 1 === 0 ? Math.round(v) : v.toFixed(2)}%`}
            visible={visible} retraso={0.38 + i * 0.08} />
        ))}
        <p className="mt-1 text-[11px] text-subtle">
          Lumi Pro: cifra de ejemplo, todavía sin medir con un banco held-out.{" "}
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

      <p
        className="mt-8 text-center font-mono text-[10px] text-subtle"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .5s" } : { opacity: 0 }}
      >
        *Se sustituirá por un benchmark real (`tools/benchmark.py --niveles pro`) contra un banco
        de fotos held-out en cuanto exista.
      </p>
    </section>
  );
}
