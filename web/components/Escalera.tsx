"use client";
import type { CSSProperties } from "react";
import { niveles } from "../lib/niveles";
import { usarRevelado } from "./usarRevelado";
import { usarConteo } from "./usarConteo";

// Nada de azul/naranja como acento decorativo: esos tokens (draw,
// warning-fg) significan estado real en el resto de la app — "dibujo en
// mapa, en curso" y "atención, sellado, cifrado" — no "este es el nivel
// pro". La escalera se distingue en monocromo, subiendo de peso visual de
// mini a vision, que además encaja con "más, no mejor".
const COLOR: Record<string, string> = {
  mini: "#9a9a95", // muted
  pro: "#e8e8e6", // fg
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
        {niv.map((n, i) => (
          <TarjetaNivel key={n.id} n={n} i={i} visible={visible} />
        ))}
      </div>
    </section>
  );
}

function TarjetaNivel({
  n, i, visible,
}: {
  n: ReturnType<typeof niveles>[number]; i: number; visible: boolean;
}) {
  const color = COLOR[n.id] ?? "#e8e8e6";
  // El conteo llega animado, no ya escrito — se dispara junto con la
  // propia tarjeta (mismo `visible`), cada fila con un pelín más de
  // retraso que la anterior para que se sienta como una cascada, no
  // como tres números saltando a la vez.
  const recuperan = usarConteo(n.recuperacion.length, visible);
  const verifican = usarConteo(n.geometricos.length, visible);
  const agentesNum = usarConteo(n.agentes.length, visible);

  const filaEstilo = (retraso: number): CSSProperties =>
    visible ? { animation: `jg-reveal-up .5s cubic-bezier(.16,1,.3,1) both ${retraso}s` } : { opacity: 0 };

  return (
    <div
      className="jg-micro jg-micro-lift rounded-card border border-border bg-panel p-5 hover:border-subtle"
      style={{
        ...(visible ? { animation: `jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both ${0.15 + i * 0.08}s` } : { opacity: 0 }),
        transition: "border-color .18s cubic-bezier(.22,1,.36,1), box-shadow .25s cubic-bezier(.22,1,.36,1), transform .18s cubic-bezier(.22,1,.36,1)",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 0 0 1px ${color}22, 0 12px 32px -16px ${color}33`; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full transition-transform duration-300"
          style={{ background: color, transitionTimingFunction: "cubic-bezier(.22,1,.36,1)" }}
        />
        <h3 className="text-[17px] font-semibold" style={{ color }}>{n.nombre}</h3>
      </div>

      <dl className="mt-5 flex flex-col gap-3 font-mono text-[13px]">
        <div className="flex items-baseline justify-between" style={filaEstilo(0.3 + i * 0.08)}>
          <dt className="text-subtle">recuperan</dt>
          <dd className="text-fg tabular-nums">{recuperan}</dd>
        </div>
        <div className="flex items-baseline justify-between" style={filaEstilo(0.36 + i * 0.08)}>
          <dt className="text-subtle">verifican</dt>
          <dd className="text-fg tabular-nums">{verifican}</dd>
        </div>
        <div className="flex items-baseline justify-between" style={filaEstilo(0.42 + i * 0.08)}>
          <dt className="text-subtle">agentes</dt>
          <dd className="text-fg tabular-nums">
            {n.agentes.length > 0
              ? agentesNum
              : n.cae_a
                ? `hereda los de ${NOMBRE_CAIDA[n.cae_a] ?? n.cae_a}`
                : 0}
          </dd>
        </div>
        <div className="flex items-baseline justify-between" style={filaEstilo(0.48 + i * 0.08)}>
          <dt className="text-subtle">si faltan capas</dt>
          <dd className="text-fg">{n.cae_a ? `→ ${NOMBRE_CAIDA[n.cae_a] ?? n.cae_a}` : "no cae"}</dd>
        </div>
      </dl>

      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-4">
        {["latencia", "radio", "carga gpu"].map((etiqueta, j) => (
          <div key={etiqueta} style={filaEstilo(0.56 + i * 0.08 + j * 0.04)}>
            <div className="font-mono text-[11px] text-subtle">—</div>
            <div className="mt-0.5 text-[9.5px] text-subtle">{etiqueta} · pendiente de medir</div>
          </div>
        ))}
      </div>
    </div>
  );
}
