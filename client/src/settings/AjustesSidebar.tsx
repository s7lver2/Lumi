import { useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../ui/Icon";

export type AjustesSeccion = "actualizaciones" | "apariencia";

const ITEMS: { id: AjustesSeccion; label: string; icon: IconName }[] = [
  { id: "actualizaciones", label: "Actualizaciones", icon: "boxes" },
  { id: "apariencia", label: "Apariencia", icon: "image" },
];

/** Mismo patrón visual que `profile/ProfileSidebar.tsx` (marcador
 *  deslizante, mismo ancho de riel) pero sin cabecera de cuenta: estos son
 *  ajustes de la app en sí, visibles con o sin sesión. */
export function AjustesSidebar({ actual, onIr, onBack }: {
  actual: AjustesSeccion; onIr: (s: AjustesSeccion) => void; onBack: () => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const [marca, setMarca] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const b = nav.current?.querySelector<HTMLElement>(`[data-s="${actual}"]`);
    if (b) setMarca({ top: b.offsetTop + 6, height: b.offsetHeight - 12 });
  }, [actual]);

  return (
    <aside className="flex flex-col border-r border-border bg-surface px-[9px] pb-[11px] pt-[13px]">
      <button onClick={onBack} className="mb-3 rounded-[7px] px-2 py-1 text-left text-[10.5px] text-subtle hover:text-fg">
        ← Volver
      </button>
      <div className="flex items-center gap-2.5 px-2 pb-3">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px]
          border border-border bg-elevated text-muted">
          <Icon name="ajustes" size={13} />
        </span>
        <span className="text-[11.5px] leading-tight text-fg">
          Ajustes
          <small className="block text-[9px] tracking-[.03em] text-subtle">de esta app</small>
        </span>
      </div>

      <nav ref={nav} className="relative flex flex-col gap-px">
        {marca && (
          <span aria-hidden className="absolute -left-[9px] w-0.5 rounded-r-sm bg-fg
            transition-[top,height] duration-[520ms] ease-expo"
            style={{ top: marca.top, height: marca.height }} />
        )}
        {ITEMS.map((it) => {
          const on = it.id === actual;
          return (
            <button key={it.id} data-s={it.id} onClick={() => onIr(it.id)}
              className={`flex w-full items-center gap-2 rounded-[7px] px-2 py-[6.5px] text-left
                text-[11.5px] transition-[background-color,color,padding-left] duration-[360ms]
                ease-expo hover:bg-white/[.04] hover:pl-[11px] hover:text-fg
                ${on ? "bg-white/[.06] text-fg" : "text-muted"}`}>
              <Icon name={it.icon} size={13} className={on ? "opacity-100" : "opacity-70"} />
              {it.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
