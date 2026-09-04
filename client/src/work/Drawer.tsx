import { Icon } from "../ui/Icon";

/** Qué cajón está abierto. Resultados e invitar piden el mismo hueco, así que
 *  solo puede haber uno: abrir cualquiera de los dos recoge el otro sin que
 *  haya que pensarlo, y el dock nunca tiene que decidir a qué borde perseguir. */
export type DrawerId = "results" | "invite" | null;

export const DRAWER_W = 360;
export const RAIL_W = 80;

/** El armazón: el carril de la derecha, con su animación de entrada y salida.
 *  Lo que lleva dentro lo pone quien lo monta. */
export function Drawer({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <aside
      style={{ width: DRAWER_W, transform: open ? "none" : "translateX(100%)" }}
      className="absolute bottom-0 right-0 top-0 z-[22] flex flex-col gap-2 overflow-y-auto
        border-l border-border bg-[rgba(16,18,21,.92)] p-3 backdrop-blur-xl
        transition-transform duration-[420ms] ease-expo">
      {children}
    </aside>
  );
}

/** El mismo armazón que `Drawer`, pero para el carril de intentos: se
 *  desliza desde la derecha igual, pero su borde derecho se pega al cajón
 *  de detalle cuando ese está abierto (`shiftedBy`), o al canto de la
 *  pantalla cuando no lo está — nunca se solapan. */
export function RailShell({ open, shiftedBy, children }:
  { open: boolean; shiftedBy: number; children: React.ReactNode }) {
  return (
    <aside
      style={{ width: RAIL_W, right: shiftedBy, transform: open ? "none" : "translateX(100%)" }}
      className="absolute bottom-0 top-0 z-[21] flex flex-col gap-1 overflow-y-auto
        border-l border-border bg-[rgba(16,18,21,.92)] p-2 backdrop-blur-xl
        transition-[transform,right] duration-[420ms] ease-expo">
      {children}
    </aside>
  );
}

/** La pestaña que abre y cierra el de resultados. Se queda pegada al canto del
 *  cajón que haya abierto, sea cual sea: enterrada debajo del otro no serviría
 *  de nada. */
export function DrawerTab({ shifted, open, onClick }:
  { shifted: boolean; open: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={open ? "Ocultar resultados" : "Ver resultados"}
      title={open ? "Ocultar resultados" : "Ver resultados"}
      style={{ right: shifted ? DRAWER_W : 0 }}
      className="absolute top-1/2 z-[23] grid h-[56px] w-[15px] -translate-y-1/2 place-items-center
        rounded-l-lg border border-r-0 border-border bg-[rgba(16,18,21,.92)] text-subtle
        transition-[right,color,background-color] duration-[420ms] ease-expo
        hover:bg-white/[.05] hover:text-fg">
      <Icon name="back" size={9} className={open ? "" : "rotate-180"} />
    </button>
  );
}
