import type { PctFuente } from "../lib/api";

/** La misma rampa de neutros que `ProvenanceBar`, más sombras de ella para
 *  cuando hay más de tres fuentes: sigue sin haber un color por fuente, solo
 *  grises que se turnan. `desconocida` es la única que rompe la rampa. */
const RAMPA = ["bg-fg", "bg-muted", "bg-subtle", "bg-fg/50", "bg-muted/50", "bg-subtle/50"];

function colorDe(fuente: string, indice: number): string {
  return fuente === "desconocida" ? "bg-warning" : RAMPA[indice % RAMPA.length];
}

/** Composición por fuente (Mapillary, KartaView, una carpeta local…) en vez
 *  de por tipo. Sobre una ficha remota se calcula por TESELA, no por imagen
 *  -- una tesela con dos fuentes cuenta en las dos --, así que aquí la barra
 *  puede pasar de 100 % y no se normaliza: es la misma información que
 *  `territorio_suma`, dicha con una barra en vez de un número. */
export function SourceBar({ fuentes }: { fuentes: PctFuente[] }) {
  if (fuentes.length === 0) return null;
  const ordenadas = [...fuentes].sort((a, b) => b.imagenes_pct - a.imagenes_pct);
  return (
    <>
      <div className="flex h-[5px] overflow-hidden rounded-[3px] bg-elevated">
        {ordenadas.map((f, i) => (
          <i key={f.fuente} className={colorDe(f.fuente, i)} style={{ width: `${f.imagenes_pct}%` }} />
        ))}
      </div>
      <div className="mt-[9px] flex flex-wrap gap-3">
        {ordenadas.map((f, i) => (
          <div key={f.fuente}
            className={`flex items-center gap-1.5 text-[10.5px] ${f.fuente === "desconocida" ? "text-warning-fg" : "text-muted"}`}>
            <s className={`block h-[7px] w-[7px] rounded-sm no-underline ${colorDe(f.fuente, i)}`} />
            {f.fuente} <b className="font-mono font-normal text-fg">{f.imagenes_pct.toFixed(0)} %</b>
          </div>
        ))}
      </div>
    </>
  );
}
