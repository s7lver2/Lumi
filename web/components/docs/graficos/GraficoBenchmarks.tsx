"use client";
import { usarRevelado } from "../../usarRevelado";
import { useConteo } from "../useConteo";

/** Mismos datos que la tabla de "Benchmarks estimados" de la página de Lumi
 *  Stellar — este gráfico no añade cifras nuevas, solo las hace comparables
 *  de un vistazo. Todo es objetivo de diseño, no medición real (ver el
 *  <Detalle> junto a la tabla): de ahí que las cuatro series compartan la
 *  misma escala 0-100% en vez de una por nivel. */
const RADIOS = [
  { id: "calle", etiqueta: "1 km", valores: [8, 18, 28, 45] },
  { id: "ciudad", etiqueta: "25 km", valores: [22, 40, 52, 70] },
  { id: "region", etiqueta: "200 km", valores: [38, 58, 68, 85] },
  { id: "pais", etiqueta: "750 km", valores: [55, 74, 82, 93] },
  { id: "continente", etiqueta: "2500 km", valores: [74, 89, 94, 98] },
];

const NIVELES = [
  { id: "mini", nombre: "Mini", barra: "bg-subtle/40" },
  { id: "pro", nombre: "Pro", barra: "bg-subtle/75" },
  { id: "vision", nombre: "Vision", barra: "bg-muted" },
  { id: "stellar", nombre: "Stellar", barra: "bg-fg" },
];

function Barra({ valor, color, visible, retraso }: { valor: number; color: string; visible: boolean; retraso: number }) {
  const contado = useConteo(visible ? valor : 0, 700);
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <span className="font-mono text-[9px] tabular-nums text-subtle">{Math.round(contado)}%</span>
      <div className="flex h-14 w-full items-end overflow-hidden rounded-t-[3px] bg-elevated">
        {visible && (
          <div
            className={`jg-barra-sube w-full ${color}`}
            style={{ "--fin": `${valor}%`, animationDelay: `${retraso}s` } as React.CSSProperties}
          />
        )}
      </div>
    </div>
  );
}

export function GraficoBenchmarks() {
  const { ref, visible } = usarRevelado<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className="mt-5 rounded-card border border-border bg-panel px-4 pb-4 pt-3.5"
      style={visible ? { animation: "jg-reveal-up .6s cubic-bezier(.16,1,.3,1) both" } : { opacity: 0 }}
    >
      <div className="grid grid-cols-[64px_1fr] items-center gap-3">
        <span />
        <div className="flex gap-2">
          {RADIOS.map((r) => (
            <span key={r.id} className="flex-1 text-center font-mono text-[9px] uppercase tracking-wide text-subtle">
              {r.etiqueta}
            </span>
          ))}
        </div>
      </div>
      {NIVELES.map((nivel, i) => (
        <div key={nivel.id} className="mt-3 grid grid-cols-[64px_1fr] items-end gap-3">
          <span className={`text-[11.5px] ${nivel.id === "stellar" ? "text-fg" : "text-muted"}`}>{nivel.nombre}</span>
          <div className="flex gap-2">
            {RADIOS.map((r, j) => (
              <Barra
                key={r.id}
                valor={r.valores[i]}
                color={nivel.barra}
                visible={visible}
                retraso={i * 0.06 + j * 0.03}
              />
            ))}
          </div>
        </div>
      ))}
      <p className="mt-3.5 text-[10.5px] text-subtle">
        Porcentaje de fotos localizadas dentro de cada radio — objetivo de diseño, no una medición.
      </p>
    </div>
  );
}
