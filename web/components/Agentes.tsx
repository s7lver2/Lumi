"use client";
import { agentes } from "../lib/agentes";
import { usarRevelado } from "./usarRevelado";

/** «Lo que dice la imagen». Sección nueva (no estaba en el concepto): los
 *  doce agentes reales que leen la imagen antes de que empiece la
 *  verificación geométrica, marcados según si filtran territorio o solo
 *  describen. Lo diferencial no es la lista, es la regla que la gobierna:
 *  un agente que no vio suficiente lo dice, no desaparece. */
export function Agentes() {
  const lista = agentes();
  const { ref, visible } = usarRevelado<HTMLElement>();

  return (
    <section ref={ref} id="agentes" className="mx-auto max-w-[1180px] px-7 py-28">
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
        Lo que dice la imagen
      </h2>
      <p
        className="mt-3 max-w-[70ch] leading-relaxed text-muted"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .1s" } : { opacity: 0 }}
      >
        Antes de que compita ningún verificador geométrico, doce agentes leen la imagen y
        acotan dónde puede estar tomada — o describen lo que ven sin acotar nada. Un agente
        que no vio lo suficiente para decidir lo dice; no desaparece ni finge una respuesta.
        Es la misma regla que aplica el cliente en el panel de hipótesis.
      </p>

      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lista.map((a, i) => (
          <div
            key={a.id}
            className="jg-micro jg-micro-lift rounded-card border border-border bg-panel p-4 hover:border-subtle"
            style={visible ? { animation: `jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both ${0.14 + (i % 6) * 0.05}s` } : { opacity: 0 }}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[14px] font-medium text-fg">{a.nombre}</h3>
              <span
                className={`shrink-0 rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] ${
                  a.tipo === "filtra" ? "bg-draw/15 text-draw-fg" : "bg-elevated text-subtle"
                }`}
              >
                {a.tipo}
              </span>
            </div>
            {a.restriccion && (
              <p className="mt-1.5 font-mono text-[10.5px] text-subtle">acota · {a.restriccion}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
