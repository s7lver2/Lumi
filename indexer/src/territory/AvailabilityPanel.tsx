import { type FichaOrigen, type SondeoTesela } from "../lib/api";
import { color, nombre } from "../lib/origenes";
import { Icon } from "../ui/Icon";

/** Los interruptores de la capa de disponibilidad.
 *
 *  Apagados por defecto, y el aviso de abajo no es decoración: el sondeo NUNCA
 *  se dispara al mover el mapa. Pasear por una ciudad con Google encendido
 *  quemaría cuota sin que nadie lo hubiera decidido. */
export function AvailabilityPanel({
  fichas,
  activos,
  sondeos,
  sondeando,
  onCambiar,
  onSondear,
}: {
  fichas: FichaOrigen[];
  activos: Set<string>;
  sondeos: SondeoTesela[];
  sondeando: boolean;
  onCambiar: (id: string, on: boolean) => void;
  onSondear: () => void;
}) {
  const delCache = sondeos.length > 0 && sondeos.every((s) => s.del_cache);

  return (
    <aside className="absolute left-3 top-3 z-20 w-[286px] rounded-card border border-white/[.13]
      bg-[rgba(16,19,25,.72)] p-[15px_15px_13px] shadow-lg shadow-black/40 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[8.5px] uppercase tracking-[.13em] text-subtle">
          Disponibilidad
        </span>
        {sondeos.length > 0 && (
          <span className="rounded border border-border px-1.5 py-px text-[8.5px] text-subtle">
            {delCache ? "de la caché" : "recién sondeado"}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2.5">
        {fichas.map((f) => {
          const on = activos.has(f.id);
          // Mapbox cenital no se pinta: «hay satélite en todas partes» no
          // informa de nada. Se lista para poder incluirlo en la descarga.
          const pintable = f.tipo !== "cenital";
          return (
            <div key={f.id} className={`flex items-center gap-2.5 ${on ? "" : "opacity-50"}`}>
              <button
                onClick={() => onCambiar(f.id, !on)}
                aria-label={`${on ? "Apagar" : "Encender"} ${nombre(f.id)}`}
                className={`relative h-[15px] w-[26px] shrink-0 rounded-full transition-colors
                  ${on ? "bg-white/20" : "bg-[#2a2d32]"}`}
              >
                <i className={`absolute top-[2px] block h-[11px] w-[11px] rounded-full transition-all
                  ${on ? "left-[13px] bg-fg" : "left-[2px] bg-subtle"}`} />
              </button>
              <span
                className="shrink-0"
                style={{
                  background: color(f.id),
                  width: 9, height: 9,
                  borderRadius: f.puntos_exactos ? 999 : 2,
                  opacity: f.puntos_exactos ? 1 : 0.55,
                }}
              />
              <span className="flex-1 text-[11.5px] text-fg">{nombre(f.id)}</span>
              <span className={`font-mono text-[10px] ${f.gratis ? "text-subtle" : "text-warning-fg"}`}>
                {!pintable ? "global" : f.puntos_exactos ? "exacto" : "muestreo"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="my-3 h-px bg-border" />

      <p className="text-[10.5px] leading-relaxed text-subtle">
        El muestreo solo distingue tres niveles —<b className="font-normal text-fg">hay</b>,{" "}
        <b className="font-normal text-fg">poco</b>, <b className="font-normal text-fg">no hay</b>—
        porque no sabe contar mejor.
      </p>

      <button
        onClick={onSondear}
        disabled={sondeando || activos.size === 0}
        className="jg-press mt-3 w-full rounded-lg border border-border py-[7px] text-[11.5px] text-fg disabled:opacity-40"
      >
        {sondeando ? "Sondeando…" : sondeos.length > 0 ? "Volver a sondear" : "Sondear el área"}
      </button>

      <div className="mt-3 flex items-start gap-2">
        <Icon name="alert" size={12} className="mt-px shrink-0 text-warning-fg" />
        <span className="text-[10.5px] leading-snug text-warning-fg">
          El sondeo <b className="font-normal">no</b> se repite al mover el mapa: solo dentro del
          área dibujada y solo cuando lo pides.
        </span>
      </div>
    </aside>
  );
}
