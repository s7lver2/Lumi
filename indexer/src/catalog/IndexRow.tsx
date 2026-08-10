import type { ResumenIndice } from "../lib/api";
import { Icon } from "../ui/Icon";
import { ProvenanceBar } from "./ProvenanceBar";

/** La fila del catálogo: nombre, insignia de estado, insignia ámbar de
 *  procedencia desconocida cuando pasa del 0 %, las cuatro cifras en mono, y
 *  la barra de procedencia — todo visible sin abrir el detalle. */
export function IndexRow({ r, embebiendo, onAbrir }: { r: ResumenIndice; embebiendo: boolean; onAbrir: () => void }) {
  const desconocida = r.imagenes_pct.por_fuente.find((f) => f.fuente === "desconocida");
  const desconocidaPct = desconocida?.imagenes_pct ?? 0;

  return (
    <button onClick={onAbrir}
      className="jg-press w-full rounded-lg border border-border px-4 py-3 text-left transition-colors
        duration-200 hover:border-white/[.16]">
      <div className="flex items-center gap-2.5">
        <span className="text-[12.5px] text-fg">{r.nombre}</span>
        <span className={`rounded-full border px-1.5 py-px text-[9px] ${
          r.estado === "sellado" ? "border-border text-subtle" : "border-draw-fg text-draw-fg"}`}>
          {r.estado === "sellado" ? "sellado" : "indexando"}
        </span>
        {r.publicado && (
          <span className="rounded-full border border-border px-1.5 py-px text-[9px] text-subtle">
            publicado
          </span>
        )}
        {desconocidaPct > 0 && (
          <span className="flex items-center gap-1 rounded-full border border-warning/[.35] px-1.5 py-px text-[9px] text-warning-fg">
            <Icon name="alert" size={9} />
            procedencia desconocida
          </span>
        )}
        {embebiendo && (
          <span className="flex items-center gap-1.5 rounded-full border border-draw-fg/40 px-1.5 py-px text-[9px] text-draw-fg">
            <span className="h-[6px] w-[6px] rounded-full bg-draw-fg"
              style={{ animation: "jg-core-pulse 2.6s ease-in-out infinite" }} />
            embebiendo
          </span>
        )}
        <span className="flex-1" />
        <span className="font-mono text-[10px] text-subtle">
          {r.imagenes} imágenes · {r.teselas} teselas
        </span>
      </div>
      <div className="mt-2.5">
        <ProvenanceBar tipos={r.imagenes_pct.por_tipo} desconocidaPct={desconocidaPct} />
      </div>
    </button>
  );
}
