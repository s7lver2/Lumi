"use client";
import { usarRevelado } from "./usarRevelado";

/** Marcas de placeholder, hand-drawn en el mismo lenguaje que el resto del
 *  sitio (viewBox 24x24, stroke currentColor) — abstractas a propósito,
 *  nunca un nombre de empresa real inventado, hasta que haya organizaciones
 *  reales que poner aquí. */
const MARCAS = [
  { id: "01", icono: <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.7" /> },
  { id: "02", icono: <path d="M12 4l7.5 13H4.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /> },
  { id: "03", icono: <rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" /> },
  {
    id: "04",
    icono: (
      <path
        d="M12 3.5l7 4v9l-7 4-7-4v-9z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    ),
  },
  { id: "05", icono: <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> },
  {
    id: "06",
    icono: (
      <>
        <circle cx="9" cy="9" r="4.2" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="15" cy="15" r="4.2" stroke="currentColor" strokeWidth="1.7" />
      </>
    ),
  },
  { id: "07", icono: <path d="M4 17l5-10 4 6 3-4 4 8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" /> },
  { id: "08", icono: <path d="M6 6h12v12H6zM6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /> },
];

function Marca({ id, icono }: { id: string; icono: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-3 rounded-card border border-border bg-panel px-6 py-4 text-subtle">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        {icono}
      </svg>
      <span className="font-mono text-[11px] uppercase tracking-wide">organización {id}</span>
    </div>
  );
}

/** Sección "quién usa Lumi", justo después de "lo que dice la imagen":
 *  marquesina horizontal infinita — la pista lleva las marcas dos veces
 *  seguidas y se traslada -50% de su propio ancho, así que el punto donde
 *  vuelve a 0% es pixel-idéntico al inicio y el bucle no se nota. Todo
 *  placeholder por ahora: nunca se inventa el nombre de una organización
 *  real que no use Lumi de verdad. */
export function Confianza() {
  const { ref, visible } = usarRevelado<HTMLElement>();

  return (
    <section ref={ref} className="mx-auto max-w-[1180px] px-7 py-28">
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
        Quién usa Lumi
      </h2>

      <div
        className="mt-10 overflow-hidden"
        style={{
          maskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
          WebkitMaskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
          ...(visible ? { animation: "jg-reveal-up .8s cubic-bezier(.16,1,.3,1) both .12s" } : { opacity: 0 }),
        }}
      >
        <div className="jg-marquesina flex w-max gap-4">
          {[...MARCAS, ...MARCAS].map((m, i) => (
            <Marca key={`${m.id}-${i}`} id={m.id} icono={m.icono} />
          ))}
        </div>
      </div>
      <p className="mt-4 font-mono text-[11px] text-subtle">
        marcador de posición — se sustituye por organizaciones reales
      </p>
    </section>
  );
}
