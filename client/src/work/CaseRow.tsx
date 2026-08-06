import type { Case } from "../lib/api";
import { lumiUrl } from "../lib/bridge";

/** Un cuadrito de mapa con el punto del caso. La coordenada da el número; esto
 *  lo hace mirable, que es lo que de verdad dice si un caso cayó donde
 *  esperabas. No es el mapa de verdad: pedir una tesela por fila para 40 filas
 *  sería mucho gasto para un adorno de 74 px. La posición del punto sale de la
 *  propia coordenada, así que dos casos cercanos se ven cercanos. */
function MiniMap({ lat, lng }: { lat: number | null; lng: number | null }) {
  const vacio = lat === null || lng === null;
  // Longitud a lo ancho y latitud a lo alto, como cualquier proyección
  // rectangular. Sin refinar: aquí solo importa el orden relativo.
  const x = vacio ? 50 : ((lng! + 180) / 360) * 100;
  const y = vacio ? 50 : ((90 - lat!) / 180) * 100;
  return (
    <span className={`relative h-[40px] w-[74px] shrink-0 overflow-hidden rounded-[7px] border border-border
      transition-colors duration-[420ms] ease-expo group-hover:border-white/[.18] ${vacio ? "opacity-[.35]" : ""}`}
      style={{ background: "radial-gradient(120% 100% at 40% 30%, #1b2027 0%, #0e1013 75%)" }}>
      <span className="absolute -inset-[30%] opacity-100" style={{
        backgroundImage:
          "repeating-linear-gradient(0deg,rgba(255,255,255,.05) 0 1px,transparent 1px 13px)," +
          "repeating-linear-gradient(90deg,rgba(255,255,255,.05) 0 1px,transparent 1px 13px)",
        transform: "rotate(-2deg)",
      }} />
      {!vacio && (
        <span className="absolute h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg"
          style={{ left: `${x}%`, top: `${y}%`, animation: "jg-core-pulse 3s cubic-bezier(.16,1,.3,1) infinite" }} />
      )}
    </span>
  );
}

/** Un caso ES sus fotos y su punto en el mapa; una tarjeta de texto, igual que
 *  la de proyectos, no enseña ninguna de las dos. Al pasar por encima la pila
 *  se abre en abanico: la carpeta enseña lo que lleva dentro sin tener que
 *  entrar. */
export function CaseRow({ case_, covers, drag, onOpen, onMenu }: {
  case_: Case;
  /** Hasta tres ids de imagen para la portada. Vacío = caso sin fotos. */
  covers: number[];
  drag: Record<string, unknown>;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const pct = case_.analyses === 0 ? 0 : (case_.resolved / case_.analyses) * 100;
  const capas = covers.slice(0, 3);

  return (
    <button {...drag} onClick={onOpen} onContextMenu={onMenu}
      className="group relative flex w-full cursor-grab items-center gap-3 rounded-[10px] border
        border-white/[.07] bg-[rgba(16,18,21,.72)] p-[8px_10px] text-left backdrop-blur-md
        transition-[background-color,border-color,transform] duration-300 ease-expo
        hover:z-[2] hover:translate-x-0.5 hover:border-white/[.18] hover:bg-[rgba(22,25,29,.85)]
        active:cursor-grabbing data-[dragging]:scale-[.97] data-[dragging]:opacity-40">

      <span className="relative h-[38px] w-[52px] shrink-0">
        {capas.length === 0 ? (
          <span className="absolute inset-0 rounded-[6px] border border-border bg-[#15181c] opacity-40" />
        ) : (
          // La de arriba del todo es la última, así que las anteriores se
          // asoman por detrás; al pasar por encima se abren en abanico. Las
          // transformaciones van en clases y no en `style` porque el estado
          // hover es del contenedor (`group`), y eso un estilo en línea no lo
          // sabe expresar.
          capas.map((id, i) => (
            <img key={id} src={lumiUrl(`/v1/images/${id}/thumb`)} alt="" style={{ zIndex: i }}
              className={`absolute inset-0 h-full w-full rounded-[6px] border border-border bg-elevated
                object-cover shadow-none transition-[transform,opacity,box-shadow] duration-[420ms] ease-expo
                group-hover:opacity-100 group-hover:shadow-[0_6px_14px_-6px_rgba(0,0,0,.8)] ${
                  i === 0
                    ? "opacity-60 [transform:translate(5px,-3px)_rotate(4deg)] group-hover:[transform:translate(17px,-11px)_rotate(13deg)]"
                    : i === 1
                      ? "opacity-80 [transform:translate(2px,-1px)_rotate(-2deg)] group-hover:[transform:translate(8px,-6px)_rotate(6deg)]"
                      : "group-hover:[transform:translate(-2px,2px)_rotate(-4deg)]"
                }`} />
          ))
        )}
        {case_.images > 0 && (
          <span className="absolute -bottom-[5px] -right-[5px] z-10 min-w-[17px] rounded-[9px] border
            border-border bg-elevated px-1 text-center font-mono text-[9px] font-semibold leading-[15px]
            text-muted transition-transform duration-[420ms] ease-expo group-hover:translate-y-[3px]">
            {case_.images}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{case_.name}</span>

      <span className="w-[76px] shrink-0">
        <span className="block h-[3px] overflow-hidden rounded-sm bg-white/[.08]">
          <span className="block h-full rounded-sm bg-draw transition-[width] duration-1000 ease-expo"
            style={{ width: `${pct}%` }} />
        </span>
        <span className="mt-[3px] block text-right font-mono text-[10px] text-subtle">
          {case_.resolved}/{case_.analyses}
        </span>
      </span>

      <span className={`w-[112px] shrink-0 text-right font-mono text-[10.5px] ${
        case_.lat === null ? "text-[#4a4d52]" : "text-subtle"}`}>
        {case_.lat === null ? "sin situar" : `${case_.lat.toFixed(3)}, ${case_.lng!.toFixed(3)}`}
      </span>

      <MiniMap lat={case_.lat} lng={case_.lng} />
    </button>
  );
}
