import { Icon } from "../ui/Icon";

/** 40 px, iconos sin etiqueta, translúcido sobre el mapa. Es el carril de la
 *  v1: la navegación no ocupa sitio porque el mapa es el trabajo. */
export function Rail({
  onProjects, onMembers, canManage,
}: { onProjects: () => void; onMembers: () => void; canManage: boolean }) {
  const btn = "text-subtle transition-colors duration-300 ease-expo hover:text-fg";
  return (
    <nav className="absolute inset-y-0 left-0 z-30 flex w-10 flex-col items-center gap-4 border-r border-border bg-[rgba(13,15,17,.86)] py-3 backdrop-blur">
      <span className="text-fg"><Icon name="logo" size={15} /></span>
      <button onClick={onProjects} title="Proyectos" className={btn}>
        <Icon name="layers" size={15} />
      </button>
      {canManage && (
        <button onClick={onMembers} title="Miembros del proyecto" className={btn}>
          <Icon name="users" size={15} />
        </button>
      )}
      <div className="flex-1" />
    </nav>
  );
}
