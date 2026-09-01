import { useLayoutEffect, useRef, useState } from "react";
import { useServer } from "../lib/store";
import { Avatar } from "../ui/Avatar";
import { Icon, type IconName } from "../ui/Icon";

export type ProfileSeccion = "perfil" | "claves" | "sesiones";

const ITEMS: { id: ProfileSeccion; label: string; icon: IconName }[] = [
  { id: "perfil", label: "Perfil", icon: "user" },
  { id: "claves", label: "API Keys", icon: "key" },
  { id: "sesiones", label: "Sesiones", icon: "device" },
];

/** Mismo patrón visual que `admin/Sidebar.tsx` (marcador deslizante, mismo
 *  ancho de riel) pero sin grupos ni contadores: aquí solo hay tres
 *  secciones y todas son de la propia cuenta. */
export function ProfileSidebar({ actual, onIr, onBack }: {
  actual: ProfileSeccion; onIr: (s: ProfileSeccion) => void; onBack: () => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const [marca, setMarca] = useState<{ top: number; height: number } | null>(null);
  const usuario = useServer((s) => s.username) ?? "";
  const userId = useServer((s) => s.userId);

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
        <Avatar name={usuario} size={26} userId={userId ?? undefined} />
        <span className="text-[11.5px] leading-tight text-fg">
          {usuario}
          <small className="block text-[9px] tracking-[.03em] text-subtle">tu cuenta</small>
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
