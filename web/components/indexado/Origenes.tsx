import type { ReactNode } from "react";
import { RevelaSeccion } from "../RevelaSeccion";

/** Glifos simplificados por fuente — no son los logotipos oficiales, son un
 *  trazo a mano de un solo color, mismo criterio que el resto de iconos del
 *  sitio (DESIGN.md: sin librería, trazo en `fg`, el color solo entra
 *  cuando significa estado). Sirven para reconocer la fuente de un vistazo
 *  en la marquesina, no para representarla con precisión de marca. */
const FUENTES: { nombre: string; tipo: string; glifo: ReactNode }[] = [
  { nombre: "Mapillary", tipo: "calle", glifo: <path d="M4 18V7l4 6 4-6 4 6 4-6v11" /> },
  {
    nombre: "KartaView", tipo: "calle",
    glifo: <><path d="M12 21s7-7.5 7-12a7 7 0 1 0-14 0c0 4.5 7 12 7 12z" /><circle cx={12} cy={9} r={2.1} /></>,
  },
  {
    nombre: "Google Street View", tipo: "calle",
    glifo: <><circle cx={12} cy={12} r={8.5} /><path d="M12 3.5v3.2M12 17.3v3.2M3.5 12h3.2M17.3 12h3.2" /></>,
  },
  {
    nombre: "Mapbox Satellite", tipo: "satélite",
    glifo: <><path d="M12 2.5 20 7v10l-8 4.5-8-4.5V7z" /><circle cx={12} cy={12} r={1.3} fill="currentColor" stroke="none" /></>,
  },
  {
    nombre: "Wikimedia Commons", tipo: "libre",
    glifo: <><circle cx={12} cy={12} r={8.5} /><path d="M3.5 12h17M12 3.5c2.8 2.6 2.8 15.4 0 17M12 3.5c-2.8 2.6-2.8 15.4 0 17" /></>,
  },
  { nombre: "Flickr", tipo: "libre", glifo: <><circle cx={8.6} cy={12} r={3.6} /><circle cx={15.4} cy={12} r={3.6} /></> },
];

export function Origenes() {
  const doble = [...FUENTES, ...FUENTES];
  return (
    <section id="origenes" className="mx-auto max-w-[1180px] px-7 py-16">
      <RevelaSeccion>
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">orígenes</span>
        <h2 className="mt-2 text-[clamp(22px,2.8vw,30px)] font-semibold tracking-tight">
          Seis fuentes, una sola procedencia
        </h2>
      </RevelaSeccion>

      <div
        className="jg-reveal-up mt-8 overflow-hidden"
        style={{
          animationDelay: ".08s",
          WebkitMaskImage: "linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)",
          maskImage: "linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)",
        }}
      >
        <div className="jg-marquesina flex w-max gap-3.5">
          {doble.map((f, i) => (
            <div
              key={i}
              className="jg-micro flex items-center gap-2.5 whitespace-nowrap rounded-[10px] border border-border bg-panel py-2.5 pl-3 pr-3.5 text-[12.5px] hover:-translate-y-0.5 hover:border-subtle"
            >
              <svg viewBox="0 0 24 24" width={16} height={16} className="shrink-0 stroke-muted" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                {f.glifo}
              </svg>
              <span>{f.nombre}</span>
              <span className="font-mono text-[9.5px] uppercase tracking-wide text-subtle">{f.tipo}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
