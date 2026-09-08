"use client";
import { usarRevelado } from "../usarRevelado";

/** Mismo formato que `RequisitosMini`, pero SIN el dato real que allí sí
 *  hay: `tools/benchmark.py` todavía no se ha corrido contra `pro` (el
 *  único resultado real que existe hoy es el de `mini`, en
 *  `resultados.json`). Así que aquí TODO va marcado como estimación —
 *  nada de fingir una medición que no se ha hecho. En cuanto exista un
 *  `resultados.json` con el nivel `pro`, esta tabla se sustituye por esos
 *  números reales, igual que ya pasó con el VRAM de Mini. */

type Fila = { etiqueta: string; minimo: string; recomendado: string };

const FILAS: Fila[] = [
  { etiqueta: "GPU · VRAM", minimo: "12 GB", recomendado: "24 GB" },
  { etiqueta: "RAM del sistema", minimo: "32 GB", recomendado: "64 GB" },
  { etiqueta: "Disco para los pesos", minimo: "~15 GB", recomendado: "~15 GB" },
  { etiqueta: "CPU", minimo: "8 núcleos", recomendado: "16 núcleos" },
];

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

      <p
        className="mt-6 text-center font-mono text-[10px] text-subtle"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .3s" } : { opacity: 0 }}
      >
        *Estimaciones — a diferencia de Mini, `tools/benchmark.py` todavía no se ha corrido
        contra Pro. Se sustituirán por medidas reales en cuanto exista ese resultado.
      </p>
    </section>
  );
}
