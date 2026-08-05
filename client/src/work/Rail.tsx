import { Icon } from "../ui/Icon";

export type RailItem = "cases" | "members" | "admin";

/** 44 px, iconos sin etiqueta, translúcido sobre el mapa. Es el carril de la
 *  v1: la navegación no ocupa sitio porque el mapa es el trabajo.
 *
 *  Ya no lleva el logotipo: eso vive ahora en la barra de título, que cruza
 *  toda la ventana por encima de este carril. */
export function Rail({
  active, canManage, isAdmin, onCases, onMembers, onAdmin, onLeave,
}: {
  active: RailItem;
  canManage: boolean;
  isAdmin: boolean;
  onCases: () => void;
  onMembers: () => void;
  onAdmin: () => void;
  onLeave: () => void;
}) {
  return (
    <nav className="absolute inset-y-0 left-0 z-30 flex w-11 flex-col items-center gap-[3px]
      border-r border-border bg-[rgba(13,15,17,.9)] py-2 backdrop-blur">
      <RailBtn icon="layers" title="Casos del proyecto" on={active === "cases"} onClick={onCases} />
      {canManage && (
        <RailBtn icon="users" title="Quién entra en el proyecto" on={active === "members"} onClick={onMembers} />
      )}
      {/* Un administrador es además un investigador. */}
      {isAdmin && (
        <RailBtn icon="shield" title="Administración" on={active === "admin"} onClick={onAdmin} />
      )}
      <div className="flex-1" />
      <RailBtn icon="logout" title="Cambiar de proyecto" on={false} onClick={onLeave} />
    </nav>
  );
}

function RailBtn({ icon, title, on, onClick }: {
  icon: "layers" | "users" | "shield" | "logout";
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
