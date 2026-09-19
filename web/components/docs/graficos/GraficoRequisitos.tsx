"use client";
import { usarRevelado } from "../../usarRevelado";
import { useConteo } from "../useConteo";

/** VRAM total estimada por nivel, a escala LINEAL a propósito — no
 *  logarítmica. El punto de este gráfico es justamente que Stellar no cabe
 *  en la misma escala que Mini/Pro/Vision: comprimirlo con un log lo haría
 *  parecer "un poco más grande" cuando en realidad es dos órdenes de
 *  magnitud. Vision no tiene cifra medida (ver tabla arriba) — se estima
 *  aquí solo para que la barra exista, marcada aparte. */
const NIVELES = [
  { id: "mini", nombre: "Mini", gb: 16, estimado: false, color: "bg-subtle/50" },
  { id: "pro", nombre: "Pro", gb: 20, estimado: false, color: "bg-subtle/75" },
  { id: "vision", nombre: "Vision", gb: 28, estimado: true, color: "bg-muted" },
  { id: "stellar", nombre: "Stellar", gb: 540, estimado: true, color: "bg-fg" },
];

const MAX_GB = Math.max(...NIVELES.map((n) => n.gb));

function Fila({ nombre, gb, estimado, color, visible, retraso }: {
  nombre: string; gb: number; estimado: boolean; color: string; visible: boolean; retraso: number;
}) {
  const contado = useConteo(visible ? gb : 0, 900);
  return (
    <div
      className="grid grid-cols-[64px_1fr_84px] items-center gap-3"
      style={visible ? { animation: `jg-reveal-up .5s cubic-bezier(.16,1,.3,1) both ${retraso}s` } : { opacity: 0 }}
    >
      <span className={`text-[11.5px] ${nombre === "Stellar" ? "text-fg" : "text-muted"}`}>{nombre}</span>
      <div className="h-2 overflow-hidden rounded-full bg-elevated">
        {visible && (
          <div
            className={`jg-barra-llena h-full rounded-full ${color}`}
            style={{ "--fin": `${Math.max(1.5, (gb / MAX_GB) * 100)}%`, animationDelay: `${retraso + 0.1}s` } as React.CSSProperties}
          />
        )}
      </div>
      <span className="text-right font-mono text-[11.5px] tabular-nums text-fg">
        ~{Math.round(contado)} GB{estimado ? "*" : ""}
      </span>
    </div>
  );
}

export function GraficoRequisitos() {
  const { ref, visible } = usarRevelado<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className="mt-5 flex flex-col gap-2.5 rounded-card border border-border bg-panel px-4 py-4"
    >
      <span
        className="font-mono text-[10px] uppercase tracking-wide text-subtle"
        style={visible ? { animation: "jg-reveal-up .5s cubic-bezier(.16,1,.3,1) both" } : { opacity: 0 }}
      >
        VRAM total estimada · escala lineal, sin comprimir
      </span>
      {NIVELES.map((n, i) => (
        <Fila key={n.id} nombre={n.nombre} gb={n.gb} estimado={n.estimado} color={n.color} visible={visible} retraso={0.08 + i * 0.08} />
      ))}
      <p
        className="mt-1 text-[10.5px] text-subtle"
        style={visible ? { animation: "jg-reveal-up .5s cubic-bezier(.16,1,.3,1) both .45s" } : { opacity: 0 }}
      >
        *Estimado, no medido todavía. La desproporción de la barra es intencional: comprimirla con
        una escala logarítmica escondería justo lo que esta página quiere mostrar.
      </p>
    </div>
  );
}
