import type { PctFuente } from "../lib/api";
import { color, nombre } from "../lib/origenes";

/** La paleta de `origenes.ts` es el único sitio de la aplicación donde el
 *  color codifica una categoría (ver su comentario) — esta barra es la
 *  segunda vez que se apoya en ella, no una paleta nueva. `desconocida` no
 *  está ahí, así que cae en el ámbar de aviso, igual que en el resto de la
 *  procedencia. */
function colorDe(fuente: string): string {
  return fuente === "desconocida" ? "#ef9f27" : color(fuente);
}

/** Composición por fuente (Mapillary, KartaView, una carpeta local…). Sobre
 *  una ficha remota se calcula por TESELA, no por imagen -- una tesela con
 *  dos fuentes cuenta en las dos --, así que aquí la barra puede pasar de
 *  100 % y no se normaliza: es la misma información que `territorio_suma`,
 *  dicha con una barra en vez de un número. */
export function SourceBar({ fuentes }: { fuentes: PctFuente[] }) {
  if (fuentes.length === 0) return null;
  const ordenadas = [...fuentes].sort((a, b) => b.imagenes_pct - a.imagenes_pct);
  return (
    <>
      <div className="flex h-[5px] overflow-hidden rounded-[3px] bg-elevated">
        {ordenadas.map((f) => (
          <i key={f.fuente} style={{ width: `${f.imagenes_pct}%`, background: colorDe(f.fuente) }} />
        ))}
      </div>
      <div className="mt-[9px] flex flex-wrap gap-3">
        {ordenadas.map((f) => (
          <div key={f.fuente} className="flex items-center gap-1.5 text-[10.5px] text-muted">
            <s className="block h-[7px] w-[7px] rounded-sm no-underline" style={{ background: colorDe(f.fuente) }} />
            {f.fuente === "desconocida" ? "desconocida" : nombre(f.fuente)}{" "}
            <b className="font-mono font-normal text-fg">{f.imagenes_pct.toFixed(0)} %</b>
          </div>
        ))}
      </div>
    </>
  );
}
