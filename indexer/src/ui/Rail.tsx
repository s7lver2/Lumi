import { Icon } from "./Icon";

export type Destino = "indices" | "territorio" | "ingesta" | "ajustes";

/** El carril de 44 px de `client/src/work/Rail.tsx`, mismo vocabulario: iconos
 *  sin etiqueta, translúcido, la pestaña de 2 px marcando el activo. Los
 *  ajustes van solos al fondo porque son el único destino que no es "hacer
 *  algo con el territorio". */
export function Rail({ activo, onIr }: { activo: Destino; onIr: (d: Destino) => void }) {
  return (
    <nav className="absolute inset-y-0 left-0 z-30 flex w-11 flex-col items-center gap-[3px]
      border-r border-border bg-[rgba(13,15,17,.9)] py-2 backdrop-blur">
      <RailBtn icon="layers" title="Índices" on={activo === "indices"} onClick={() => onIr("indices")} />
      <RailBtn icon="territorio" title="Territorio" on={activo === "territorio"} onClick={() => onIr("territorio")} />
      <RailBtn icon="ingesta" title="Ingesta" on={activo === "ingesta"} onClick={() => onIr("ingesta")} />
      <div className="flex-1" />
      <RailBtn icon="boxes" title="Ajustes" on={activo === "ajustes"} onClick={() => onIr("ajustes")} />
    </nav>
  );
}

function RailBtn({ icon, title, on, onClick }: {
  icon: "layers" | "territorio" | "ingesta" | "boxes";
  title: string; on: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} title={title} aria-label={title} aria-current={on || undefined}
      className={`jg-press relative grid h-[30px] w-[30px] place-items-center rounded-lg ${
        on ? "bg-white/[.07] text-fg" : "text-subtle hover:bg-white/[.04] hover:text-fg"
      }`}>
      {on && <span className="absolute inset-y-[7px] -left-[10px] w-0.5 rounded-r bg-fg" />}
      <Icon name={icon} size={15} />
    </button>
  );
}
