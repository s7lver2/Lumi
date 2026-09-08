"use client";
import { usarRevelado } from "../usarRevelado";

/** Mismo formato que `RequisitosMini`. La VRAM ya tiene dato real: un
 *  corte de `tools/benchmark.py --niveles pro` (`resultados.json`) llegó a
 *  completar 7 de 16 consultas antes de que una caída de infraestructura
 *  durante la propia prueba (reinicios de `lumid` en marcha) tumbara el
 *  resto — el pico de VRAM de esas 7 sí es una medición real, aunque la
 *  tanda se cortara antes de terminar. El resto sigue siendo estimación:
 *  RAM/CPU no se miden con este banco, y el disco es una extrapolación del
 *  peso documentado de cada motor, no una suma verificada. */

type Fila = { etiqueta: string; minimo: string; recomendado: string; fuente: "medido" | "estimado" };

const FILAS: Fila[] = [
  { etiqueta: "GPU · VRAM", minimo: "8 GB", recomendado: "20 GB", fuente: "medido" },
  { etiqueta: "RAM del sistema", minimo: "32 GB", recomendado: "64 GB", fuente: "estimado" },
  { etiqueta: "Disco para los pesos", minimo: "~15 GB", recomendado: "~15 GB", fuente: "estimado" },
  { etiqueta: "CPU", minimo: "8 núcleos", recomendado: "16 núcleos", fuente: "estimado" },
];

function Insignia({ fuente }: { fuente: Fila["fuente"] }) {
  const texto = fuente === "medido" ? "medido en benchmark" : "estimado";
  return <span className="font-mono text-[9px] uppercase tracking-wide text-subtle">{texto}</span>;
}

export function RequisitosPro() {
  const { ref, visible } = usarRevelado<HTMLElement>();

  return (
    <section ref={ref} className="mx-auto max-w-[760px] px-7 py-28">
      <span
        className="font-mono text-[11px] uppercase tracking-wide text-subtle"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both" } : { opacity: 0 }}
      >
        qué hardware hace falta
      </span>
      <h2
        className="mt-2 text-[clamp(24px,3.4vw,36px)] font-semibold tracking-tight"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .05s" } : { opacity: 0 }}
      >
        Cuatro veces el trabajo, no cuatro veces el hueco
      </h2>
      <p
        className="mt-3 max-w-[70ch] leading-relaxed text-muted"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .1s" } : { opacity: 0 }}
      >
        Pro corre 4 recuperadores, 4 verificadores y 10 agentes por consulta — más motores
        cargados en VRAM a la vez que Mini, aunque no se multiplique linealmente por 4.
      </p>

      <div
        className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .2s" } : { opacity: 0 }}
      >
        <div className="rounded-card border border-border bg-panel p-4">
          <span className="font-mono text-[12px] uppercase tracking-wide text-muted">mínimo · 1 usuario</span>
          <dl className="mt-3 flex flex-col gap-2.5 border-t border-border pt-3">
            {FILAS.map((f) => (
              <div key={f.etiqueta} className="flex items-baseline justify-between">
                <dt className="text-[12.5px] text-muted">{f.etiqueta}</dt>
                <dd className="font-mono text-[13px] text-fg">{f.minimo}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-card border border-fg/40 bg-elevated p-4">
          <span className="font-mono text-[12px] uppercase tracking-wide text-fg">recomendado · 10 a la vez</span>
          <dl className="mt-3 flex flex-col gap-2.5 border-t border-border pt-3">
            {FILAS.map((f) => (
              <div key={f.etiqueta} className="flex items-baseline justify-between">
                <dt className="text-[12.5px] text-muted">{f.etiqueta}</dt>
                <dd className="font-mono text-[13px] text-fg">{f.recomendado}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {FILAS.map((f) => (
          <div key={f.etiqueta} className="flex items-center gap-1.5">
            <span className="text-[10.5px] text-subtle">{f.etiqueta}:</span>
            <Insignia fuente={f.fuente} />
          </div>
        ))}
      </div>

      <p
        className="mt-6 text-center font-mono text-[10px] text-subtle"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .3s" } : { opacity: 0 }}
      >
        *VRAM mínima: pico real de `tools/benchmark.py --niveles pro` sobre 7 consultas resueltas
        antes de que un corte de infraestructura interrumpiera la tanda — ver `resultados.json`.
        RAM, CPU y disco siguen siendo estimaciones razonables, no medidas.
      </p>
    </section>
  );
}
