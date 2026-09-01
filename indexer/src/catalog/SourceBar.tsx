import type { PctFuente } from "../lib/api";
import { color, nombre } from "../lib/origenes";

/** Opacidad decreciente por posición — para una serie sin categoría semántica
 *  (fuente de una imagen concreta, publicación concreta…) que aun así
 *  necesita distinguirse visualmente en una barra apilada. El color como
 *  categoría es solo de `origenes.ts` (ver su comentario); aquí no se inventa
 *  una paleta nueva, solo se gradúa el mismo tono. */
export function opacidadSegmento(indice: number): string {
  return `rgba(255,255,255,${Math.max(0.82 - indice * 0.14, 0.18)})`;
}

/** Barra apilada única cuyos segmentos son pesos arbitrarios (no fuentes) —
 *  usada por el perfil para las publicaciones recientes: una sola barra
 *  proporcional en vez de una fila con su propia `SourceBar` por
 *  publicación. Sin leyenda propia: quien la usa ya sabe qué es cada
 *  segmento y dibuja su propia leyenda con `opacidadSegmento` a juego. */
export function SegmentBar({ pesos }: { pesos: number[] }) {
  const total = pesos.reduce((s, v) => s + v, 0);
  if (pesos.length === 0 || total <= 0) return null;
  return (
    <div className="flex h-[5px] overflow-hidden rounded-[3px] bg-elevated">
      {pesos.map((v, i) => (
        <i key={i} style={{ width: `${(v / total) * 100}%`, background: opacidadSegmento(i) }} />
      ))}
    </div>
  );
}

/** La paleta de `origenes.ts` es el único sitio de la aplicación donde el
 *  color codifica una categoría (ver su comentario) — esta barra es la
 *  segunda vez que se apoya en ella, no una paleta nueva. `desconocida` no
 *  está ahí, así que cae en el ámbar de aviso, igual que en el resto de la
 *  procedencia. */
function colorDe(fuente: string): string {
  return fuente === "desconocida" ? "#ef9f27" : color(fuente);
}

/** Composición por fuente (Mapillary, KartaView, una carpeta local…). Sobre
 *  un índice local es por IMAGEN y suma 100: es una tarta, y por eso las
 *  barras van apiladas en una sola tira. Sobre una ficha remota es por
 *  TESELA -- una tesela con dos fuentes cuenta en las dos --, así que ahí NO
 *  suma 100 y cada fuente necesita su propia barra: una tira apilada con dos
 *  fuentes al 100 % dejaría a la segunda fuera del contenedor, invisible. */
export function SourceBar({ fuentes, unidad = "imágenes" }: { fuentes: PctFuente[]; unidad?: "imágenes" | "teselas" }) {
  if (fuentes.length === 0) return null;
  const ordenadas = [...fuentes].sort((a, b) => b.imagenes_pct - a.imagenes_pct);

  if (unidad === "teselas") {
    return (
      <div className="flex flex-col gap-1.5">
        {ordenadas.map((f) => (
          <div key={f.fuente} className="flex items-center gap-2">
            <span className="w-[74px] shrink-0 truncate text-[10px] text-muted">
              {f.fuente === "desconocida" ? "desconocida" : nombre(f.fuente)}
            </span>
            <span className="h-[5px] flex-1 overflow-hidden rounded-[3px] bg-elevated">
              <i className="block h-full" style={{ width: `${Math.min(f.imagenes_pct, 100)}%`, background: colorDe(f.fuente) }} />
            </span>
            <span className="w-9 shrink-0 text-right font-mono text-[9.5px] text-fg">{f.imagenes_pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    );
  }

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
            <b className="font-mono font-normal text-fg">{f.imagenes_pct.toFixed(0)} % de {unidad}</b>
          </div>
        ))}
      </div>
    </>
  );
}
