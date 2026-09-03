import { agentes } from "../lib/agentes";

/** «Lo que dice la imagen». Sección nueva (no estaba en el concepto): los
 *  doce agentes reales que leen la imagen antes de que empiece la
 *  verificación geométrica, marcados según si filtran territorio o solo
 *  describen. Lo diferencial no es la lista, es la regla que la gobierna:
 *  un agente que no vio suficiente lo dice, no desaparece. */
export function Agentes() {
  const lista = agentes();

  return (
    <section id="agentes" className="mx-auto max-w-[1180px] px-7 py-28">
      <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">meet lumi</span>
      <h2 className="mt-2 text-[clamp(24px,3.4vw,36px)] font-semibold tracking-tight">
        Lo que dice la imagen
      </h2>
      <p className="mt-3 max-w-[70ch] leading-relaxed text-muted">
        Antes de que compita ningún verificador geométrico, doce agentes leen la imagen y
        acotan dónde puede estar tomada — o describen lo que ven sin acotar nada. Un agente
        que no vio lo suficiente para decidir lo dice; no desaparece ni finge una respuesta.
        Es la misma regla que aplica el cliente en el panel de hipótesis.
      </p>

      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lista.map((a) => (
          <div key={a.id} className="rounded-card border border-border bg-panel p-4">
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
