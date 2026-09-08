"use client";
import { usarRevelado } from "../usarRevelado";

/** Mínimo (1 usuario) frente a recomendado (10 a la vez) — no son el mismo
 *  tipo de cifra en cada fila:
 *
 *  - VRAM: MEDIDA de verdad (`tools/benchmark.py` contra un `lumid` real,
 *    nivel Mini, pico de `nvidia-smi` durante el análisis: 7.3 GB).
 *  - Peso en disco: el de Qwen3-VL-4B es el que documenta su propio
 *    registro (`registros/motores/qwen3-vl.json`, ~8.9 GB, repositorio
 *    entero de HuggingFace) — el resto de motores de Mini (cosplace,
 *    tiny-roma, OCR, profundidad) no llega a sumar 1 GB más.
 *  - La fila de "10 a la vez" NO es una medición — es lo que se sigue de
 *    cómo está hecha la cola (`ARCHITECTURE.md`: un trabajador por
 *    dispositivo, un GPU sirve un análisis cada vez) más la latencia real
 *    ya medida: sin los workers persistentes, 10 peticiones se sirven en
 *    fila, no en paralelo. Se dice así de claro, no se disfraza de cifra
 *    medida. */

type Fila = {
  etiqueta: string;
  minimo: string;
  recomendado: string;
  fuente: "medido" | "real" | "estimado";
};

const FILAS: Fila[] = [
  { etiqueta: "GPU · VRAM", minimo: "8 GB", recomendado: "16 GB", fuente: "medido" },
  { etiqueta: "RAM del sistema", minimo: "16 GB", recomendado: "32 GB", fuente: "estimado" },
  { etiqueta: "Disco para los pesos", minimo: "~10 GB", recomendado: "~10 GB", fuente: "real" },
  { etiqueta: "CPU", minimo: "4 núcleos", recomendado: "8 núcleos", fuente: "estimado" },
];

function Insignia({ fuente }: { fuente: Fila["fuente"] }) {
  const texto = fuente === "medido" ? "medido en benchmark" : fuente === "real" ? "del registro real" : "estimado";
  return <span className="font-mono text-[9px] uppercase tracking-wide text-subtle">{texto}</span>;
}

export function RequisitosMini() {
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
        De un portátil a un equipo compartido
      </h2>
      <p
        className="mt-3 max-w-[70ch] leading-relaxed text-muted"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .1s" } : { opacity: 0 }}
      >
        La VRAM de la columna "mínimo" es un pico real, medido contra un servidor Mini de verdad
        — no una estimación. La columna de 10 usuarios a la vez es distinta: sale de cómo está
        hecha la cola, no de una medición con 10 personas reales.
      </p>

      <div
        className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .2s" } : { opacity: 0 }}
      >
        <div className="rounded-card border border-border bg-panel p-4">
          <span className="font-mono text-[12px] uppercase tracking-wide text-muted">mínimo · 1 usuario</span>
          <dl className="mt-3 flex flex-col gap-2.5 border-t border-border pt-3">
            {FILAS.map((f) => (
              <div key={f.etiqueta}>
                <div className="flex items-baseline justify-between">
                  <dt className="text-[12.5px] text-muted">{f.etiqueta}</dt>
                  <dd className="font-mono text-[13px] text-fg">{f.minimo}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-card border border-fg/40 bg-elevated p-4">
          <span className="font-mono text-[12px] uppercase tracking-wide text-fg">recomendado · 10 a la vez</span>
          <dl className="mt-3 flex flex-col gap-2.5 border-t border-border pt-3">
            {FILAS.map((f) => (
              <div key={f.etiqueta}>
                <div className="flex items-baseline justify-between">
                  <dt className="text-[12.5px] text-muted">{f.etiqueta}</dt>
                  <dd className="font-mono text-[13px] text-fg">{f.recomendado}</dd>
                </div>
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

      <div
        className="mt-8 rounded-card border border-border bg-panel p-4"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .32s" } : { opacity: 0 }}
      >
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">por qué 16 GB y no 8 GB para 10 usuarios</span>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          `lumid` sirve un análisis a la vez por GPU — con una sola tarjeta, 10 peticiones no
          corren en paralelo, se atienden en fila. Con más VRAM disponible, verificación y agentes
          pueden quedarse cargados en memoria entre análisis en vez de recargar sus modelos en
          cada uno (algo que hoy es opcional y configurable), lo que acorta la fila; para servir
          10 análisis A LA VEZ de verdad hace falta una GPU por análisis simultáneo, no solo más
          VRAM en una sola.
        </p>
      </div>

      <p
        className="mt-6 text-center font-mono text-[10px] text-subtle"
        style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both .4s" } : { opacity: 0 }}
      >
        *RAM y CPU son estimaciones razonables, no medidas. VRAM mínima y peso en disco sí lo son
        — ver `tools/benchmark.py` y `registros/motores/qwen3-vl.json`.
      </p>
    </section>
  );
}
