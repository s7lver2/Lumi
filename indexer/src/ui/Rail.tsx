import { Icon } from "./Icon";

export type Destino = "proyectos" | "territorio" | "descarga" | "revision" | "ajustes";

/** El carril de 44 px de `client/src/work/Rail.tsx`, mismo vocabulario: iconos
 *  sin etiqueta, translúcido, la pestaña de 2 px marcando el activo.
 *
 *  «Descarga» y «Ajustes» van juntos al fondo: ninguno de los dos es "hacer
 *  algo con el territorio" como sí lo son Proyectos/Territorio/Revisión — uno
 *  es vigilancia de una cola de fondo, el otro es configuración.
 *
 *  Las pestañas están SIEMPRE visibles, incluida «Descarga»: antes se ocultaba
 *  salvo que hubiera una descarga en marcha, y sin el icono a la vista no
 *  había forma de saber que ese destino existía. Ahora, si se entra sin
 *  trabajo activo, la pantalla lo explica en vez de mostrarse vacía — es la
 *  pantalla, no el carril, la que decide si hay algo que enseñar.
 *
 *  Descarga y embebido eran dos destinos separados; ahora es uno solo
 *  (`DescargaYEmbebidoView`, spec 2026-09-01): terminar de descargar lleva
 *  directo a ver el embebido en el mismo scroll, sin cambiar de pestaña. El
 *  punto naranja se enciende con cualquiera de los dos (`descargaActiva` o
 *  `embebiendoActivo`) — es lo que dice, desde cualquier otro sitio, que algo
 *  sigue corriendo detrás. */
export function Rail({ activo, descargaActiva, embebiendoActivo, onIr }: {
  activo: Destino; descargaActiva?: boolean; embebiendoActivo?: boolean; onIr: (d: Destino) => void;
}) {
  return (
    <nav className="absolute inset-y-0 left-0 z-30 flex w-11 flex-col items-center gap-[3px]
      border-r border-border bg-[rgba(13,15,17,.9)] py-2 backdrop-blur">
      <RailBtn icon="layers" title="Proyectos" on={activo === "proyectos"} onClick={() => onIr("proyectos")} />
      <RailBtn icon="territorio" title="Territorio" on={activo === "territorio"} onClick={() => onIr("territorio")} />
      <RailBtn icon="check" title="Revisión" on={activo === "revision"} onClick={() => onIr("revision")} />
      <div className="flex-1" />
      <RailBtn icon="ingesta" title="Descarga y embebido" on={activo === "descarga"}
        activo={descargaActiva || embebiendoActivo} onClick={() => onIr("descarga")} />
      <RailBtn icon="ajustes" title="Ajustes" on={activo === "ajustes"} onClick={() => onIr("ajustes")} />
    </nav>
  );
}

function RailBtn({ icon, title, on, activo, onClick }: {
  icon: "layers" | "territorio" | "ingesta" | "ajustes" | "check" | "embebido";
  title: string; on: boolean; activo?: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} title={title} aria-label={title} aria-current={on || undefined}
      className={`jg-press relative grid h-[30px] w-[30px] place-items-center rounded-lg ${
        on ? "bg-white/[.07] text-fg" : "text-subtle hover:bg-white/[.04] hover:text-fg"
      }`}>
      {on && <span className="absolute inset-y-[7px] -left-[10px] w-0.5 rounded-r bg-fg" />}
      {activo && !on && <span className="absolute right-[3px] top-[3px] h-1.5 w-1.5 rounded-full bg-warning" />}
      <Icon name={icon} size={15} />
    </button>
  );
}
