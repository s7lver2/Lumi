/** Las cuatro marcas que el mapa puede pintar, tal como las dibuja el mockup
 *  del subsistema 8: un cuadro por estado en vez de las combinaciones de
 *  punto/opacidad que tenía antes -- son los mismos cuatro `Estado` de
 *  `coverage.rs`, uno por fila, sin desglosar por origen de muestreo. */
export function MapLegend() {
  return (
    <div className="absolute bottom-[14px] left-[14px] z-20 rounded-card border border-white/[.13]
      bg-[rgba(16,19,25,.72)] px-3 py-2.5 shadow-lg shadow-black/40 backdrop-blur-xl">
      <p className="text-[8px] uppercase tracking-[.11em] text-subtle">Teselas z14</p>
      <div className="mt-2 flex flex-col gap-1.5">
        <Fila color="rgba(255,255,255,.16)" borde="rgba(255,255,255,.28)" texto="en tus índices" />
        <Fila color="rgba(55,138,221,.22)" borde="rgba(133,183,235,.5)" texto="en tu catálogo local" />
        <Fila color="rgba(239,159,39,.2)" borde="rgba(239,159,39,.55)" texto="reclamada por otro" claseTexto="text-warning-fg" />
        <Fila color="transparent" borde="rgba(154,154,149,.5)" punteado texto="sin indexar" />
      </div>
    </div>
  );
}

function Fila({ color, borde, texto, punteado, claseTexto }: {
  color: string;
  borde: string;
  texto: string;
  punteado?: boolean;
  claseTexto?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="block h-[11px] w-[11px] shrink-0 rounded-[2px]"
        style={{ background: color, border: `1px ${punteado ? "dashed" : "solid"} ${borde}` }} />
      <span className={`text-[10.5px] ${claseTexto ?? "text-muted"}`}>{texto}</span>
    </div>
  );
}
