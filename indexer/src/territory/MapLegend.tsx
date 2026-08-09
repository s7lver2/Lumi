import { color } from "../lib/origenes";

/** Las cuatro marcas que el mapa puede pintar. Se elige un origen de muestreo
 *  activo para las dos muestras de sombreado, en vez de un color fijo: enseñar
 *  la escala en un color que no está en pantalla no explica nada. */
export function MapLegend({ activos }: { activos: Set<string> }) {
  const deMuestreo = [...activos].find((id) => id !== "mapillary" && id !== "mapbox-satelite");
  const c = deMuestreo ? color(deMuestreo) : "#6a6c70";

  return (
    <div className="absolute bottom-[22px] right-4 z-20 rounded-card border border-white/[.13]
      bg-[rgba(16,19,25,.72)] px-3.5 py-[11px] shadow-lg shadow-black/40 backdrop-blur-xl">
      <p className="text-[8.5px] uppercase tracking-[.13em] text-subtle">Leyenda</p>
      <div className="mt-2.5 flex gap-[18px]">
        <div className="flex flex-col gap-1.5">
          <Marca forma="punto" color={color("mapillary")} texto="punto con foto" />
          <Marca forma="cuadro" color={c} opacidad={0.3} texto="tesela con mucho" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Marca forma="cuadro" color={c} opacidad={0.13} texto="tesela con poco" />
          <Marca forma="punteado" texto="sin indexar por nadie" />
          <Marca forma="cuadro" color="#ef9f27" opacidad={0.45} texto="reclamada por otro" />
        </div>
      </div>
    </div>
  );
}

function Marca({ forma, color, opacidad, texto }: {
  forma: "punto" | "cuadro" | "punteado";
  color?: string;
  opacidad?: number;
  texto: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="shrink-0"
        style={{
          width: 9,
          height: 9,
          borderRadius: forma === "punto" ? 999 : 2,
          background: forma === "punteado" ? "transparent" : color,
          opacity: opacidad ?? 1,
          border: forma === "punteado" ? "1px dashed rgba(154,154,149,.42)" : undefined,
        }}
      />
      <span className="text-[10.5px] text-muted">{texto}</span>
    </div>
  );
}
