"use client";
import { niveles } from "../lib/niveles";
import { usarRevelado } from "./usarRevelado";

const COLOR: Record<string, string> = {
  mini: "#378add", // draw
  pro: "#efb968", // warning-fg
  vision: "#f2f3f5", // accent
};

const NOMBRE_CAIDA: Record<string, string> = { mini: "Mini", pro: "Pro", vision: "Vision" };

/** «La escalera»: tres columnas comparadas, con cada conteo leído del
 *  registro (nunca escrito a mano) — se ve de un vistazo que Vision no es
 *  "mejor", es "más". Las cifras de rendimiento son un marcador visible:
 *  no hay un solo benchmark en el repo todavía. */
export function Escalera() {
  const niv = niveles();
  const { ref, visible } = usarRevelado<HTMLElement>();

  return (
    <section ref={ref} id="modelos" className="mx-auto max-w-[1180px] px-7 py-28">
      <span
        className="font-mono text-[11px] uppercase tracking-wide text-subtle"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both" } : { opacity: 0 }}
      >
        meet lumi
      </span>
      <h2
        className="mt-2 text-[clamp(24px,3.4vw,36px)] font-semibold tracking-tight"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .05s" } : { opacity: 0 }}
      >
        Un mecanismo, tres temperamentos
      </h2>
      <p
        className="mt-3 max-w-[70ch] leading-relaxed text-muted"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .1s" } : { opacity: 0 }}
      >
        La diferencia entre los tres no está en la arquitectura, sino en cuántos recuperadores
        y verificadores compiten dentro — y cuánto se ajusta el círculo antes de cerrar.
      </p>

      <div className="mt-12 grid gap-5 sm:grid-cols-3">
        {niv.map((n, i) => {
          const color = COLOR[n.id] ?? "#e8e8e6";
          return (
            <div
              key={n.id}
              className="jg-micro jg-micro-lift rounded-card border border-border bg-panel p-5 hover:border-subtle"
              style={visible ? { animation: `jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both ${0.15 + i * 0.08}s` } : { opacity: 0 }}
            >
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                <h3 className="text-[17px] font-semibold" style={{ color }}>{n.nombre}</h3>
              </div>

              <dl className="mt-5 flex flex-col gap-3 font-mono text-[13px]">
                <div className="flex items-baseline justify-between">
                  <dt className="text-subtle">recuperan</dt>
                  <dd className="text-fg">{n.recuperacion.length}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-subtle">verifican</dt>
                  <dd className="text-fg">{n.geometricos.length}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-subtle">agentes</dt>
                  <dd className="text-fg">
                    {n.agentes.length > 0
                      ? n.agentes.length
                      : n.cae_a
                        ? `hereda los de ${NOMBRE_CAIDA[n.cae_a] ?? n.cae_a}`
                        : 0}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-subtle">si faltan capas</dt>
                  <dd className="text-fg">{n.cae_a ? `→ ${NOMBRE_CAIDA[n.cae_a] ?? n.cae_a}` : "no cae"}</dd>
                </div>
              </dl>

              <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-4">
                {["latencia", "radio", "carga gpu"].map((etiqueta) => (
                  <div key={etiqueta}>
                    <div className="font-mono text-[11px] text-subtle">—</div>
                    <div className="mt-0.5 text-[9.5px] text-subtle">{etiqueta} · pendiente de medir</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
