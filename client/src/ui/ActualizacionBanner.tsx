import { abrirDescarga, type EstadoActualizacion } from "../lib/actualizaciones";
import { Icon } from "./Icon";

/** Vive en `ui/`, no en `admin/`, igual que `MantenimientoBanner`: `App.tsx`
 *  la monta una sola vez para toda la app. A diferencia de mantenimiento,
 *  esto no es un estado del servidor: es local y descartable — cerrarla no
 *  vuelve a comprobar hasta el próximo arranque o hasta "Comprobar ahora"
 *  en Perfil. */
export function ActualizacionBanner({ estado, onCerrar }: {
  estado: EstadoActualizacion;
  onCerrar: () => void;
}) {
  const retirada = estado.tipo === "retirada";
  return (
    <div
      className={`relative flex shrink-0 items-center gap-2.5 border-b px-4 py-2 text-[11px] ${
        retirada ? "border-warning/25 bg-warning/[.06] text-warning-fg" : "border-draw/25 bg-draw/[.06] text-draw-fg"
      }`}
      style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}
    >
      <Icon name={retirada ? "alert" : "refresh"} size={13} />
      {retirada ? (
        <span className="flex-1 truncate">
          <b className="font-medium text-fg">Tu versión fue retirada.</b> Actualiza en cuanto puedas.
        </span>
      ) : (
        <span className="flex flex-1 items-baseline gap-2 truncate">
          Versión <b className="font-mono font-medium tabular-nums text-fg">{estado.version}</b> disponible
          <span className="truncate text-subtle">— {estado.notas}</span>
        </span>
      )}
      {!retirada && estado.url && (
        <button
          onClick={() => void abrirDescarga(estado.url)}
          className="shrink-0 rounded-[6px] border border-border px-2.5 py-1 font-medium text-fg
            transition-colors duration-150 hover:bg-border"
        >
          Ver y descargar
        </button>
      )}
      <button
        onClick={onCerrar}
        aria-label="Cerrar aviso de actualización"
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[6px] text-subtle
          transition-colors duration-150 hover:bg-border hover:text-fg"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
