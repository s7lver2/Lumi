import { Icon } from "../ui/Icon";

export interface Crumb { label: string; onClick?: () => void }

/** La ruta completa, siempre, y clicable en cada tramo. Antes volver atrás era
 *  un icono sin etiqueta en el carril desde el proyecto y un nombre suelto
 *  desde el caso: dos gestos distintos para la misma idea, y ninguno decía a
 *  dónde llevaba. El chevron de la izquierda repite el salto de un nivel para
 *  quien no lee migas de pan. */
export function TopBar({ crumbs, right }: { crumbs: Crumb[]; right?: React.ReactNode }) {
  const back = [...crumbs].reverse().find((c) => c.onClick);
  // `left-11 right-0` y no `inset-x-0 left-11`: las dos son la propiedad
  // `left`, y cuál gana depende del orden en que Tailwind las emita, no del
  // orden en que se escriban aquí.
  return (
    <div className="absolute left-11 right-0 top-0 z-[25] flex h-[38px] items-center gap-2.5
      border-b border-border bg-[rgba(13,15,17,.78)] px-3 backdrop-blur-md">
      {back && (
        <button onClick={back.onClick} title={`Volver a ${back.label}`} aria-label={`Volver a ${back.label}`}
          className="jg-press grid h-[22px] w-[22px] place-items-center rounded-md text-subtle hover:bg-white/[.05] hover:text-fg">
          <Icon name="back" size={13} />
        </button>
      )}
      <div className="flex min-w-0 items-center gap-[7px] text-[11.5px]">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-[7px]">
            {i > 0 && <span className="shrink-0 text-[#3a3e44]">/</span>}
            {c.onClick ? (
              <button onClick={c.onClick}
                className="truncate text-subtle transition-colors duration-300 ease-expo hover:text-fg">
                {c.label}
              </button>
            ) : (
              <span className="truncate text-fg">{c.label}</span>
            )}
          </span>
        ))}
      </div>
      <div className="flex-1" />
      {right}
    </div>
  );
}
