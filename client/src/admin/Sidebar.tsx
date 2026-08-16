import { useLayoutEffect, useRef, useState } from "react";
import { useServer } from "../lib/store";
import { Icon, type IconName } from "../ui/Icon";

export type Seccion =
  | "resumen" | "modelos" | "personalizacion" | "indices" | "seguridad" | "claves"
  | "solicitudes" | "usuarios"
  | "cola" | "notificaciones" | "hardware";

/** Las que todavía no existen se ven, atenuadas, con su «pronto». Aparecer de
 *  la nada dentro de tres meses es peor que estar desde el principio diciendo
 *  que no estás — es la matriz de capacidades aplicada a la navegación. */
const GRUPOS: { grupo: string; items: { id: Seccion; label: string; icon: IconName; pronto?: boolean }[] }[] = [
  {
    grupo: "Servidor",
    items: [
      { id: "resumen", label: "Resumen", icon: "bars" },
      { id: "modelos", label: "Modelos", icon: "layers" },
      { id: "personalizacion", label: "Customización", icon: "globe" },
      { id: "indices", label: "Índices", icon: "grid" },
      { id: "seguridad", label: "Seguridad", icon: "shield" },
      { id: "claves", label: "API Keys", icon: "key" },
    ],
  },
  {
    grupo: "Personas",
    items: [
      { id: "solicitudes", label: "Solicitudes", icon: "inbox" },
      { id: "usuarios", label: "Usuarios", icon: "users" },
    ],
  },
  {
    grupo: "Operación",
    items: [
      { id: "cola", label: "Cola", icon: "bars" },
      { id: "notificaciones", label: "Notificaciones", icon: "bell" },
      { id: "hardware", label: "Hardware", icon: "device", pronto: true },
    ],
  },
];

export function Sidebar({ actual, onIr, contadores }: {
  actual: Seccion;
  onIr: (s: Seccion) => void;
  /** Solo las secciones que tienen algo que contar. En ámbar las que esperan
   *  por el administrador. */
  contadores: Partial<Record<Seccion, { n: number; espera?: boolean }>>;
}) {
  const nav = useRef<HTMLElement>(null);
  const [marca, setMarca] = useState<{ top: number; height: number } | null>(null);
  const usuario = useServer((s) => s.username) ?? "";

  // El marcador es UNO y se desliza. Un elemento compartido hace que cambiar
  // de sección se lea como movimiento, no como dos cosas apagándose y
  // encendiéndose. Se mide tras pintar, que es cuando el botón ya tiene sitio.
  useLayoutEffect(() => {
    const b = nav.current?.querySelector<HTMLElement>(`[data-s="${actual}"]`);
    if (b) setMarca({ top: b.offsetTop + 6, height: b.offsetHeight - 12 });
  }, [actual]);

  return (
    <aside className="flex flex-col border-r border-border bg-surface px-[9px] pb-[11px] pt-[13px]">
      <div className="flex items-center gap-2.5 px-2 pb-3">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px]
          border border-border bg-elevated text-muted">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l9 4.5-9 4.5-9-4.5L12 2z" />
          </svg>
        </span>
        <span className="text-[11.5px] leading-tight text-fg">
          {usuario}
          <small className="block text-[9px] tracking-[.03em] text-subtle">propietario</small>
        </span>
      </div>

      <nav ref={nav} className="relative flex flex-col gap-px">
        {marca && (
          <span aria-hidden className="absolute -left-[9px] w-0.5 rounded-r-sm bg-fg
            transition-[top,height] duration-[520ms] ease-expo"
            style={{ top: marca.top, height: marca.height }} />
        )}
        {GRUPOS.map((g) => (
          <div key={g.grupo} className="contents">
            <div className="px-2 pb-[5px] pt-[13px] text-[8.5px] uppercase tracking-[.13em] text-subtle">
              {g.grupo}
            </div>
            {g.items.map((it) => {
              const on = it.id === actual;
              const c = contadores[it.id];
              return (
                <button key={it.id} data-s={it.id} onClick={() => onIr(it.id)}
                  className={`flex w-full items-center gap-2 rounded-[7px] px-2 py-[6.5px] text-left
                    text-[11.5px] transition-[background-color,color,padding-left] duration-[360ms]
                    ease-expo hover:bg-white/[.04] hover:pl-[11px] hover:text-fg
                    ${on ? "bg-white/[.06] text-fg" : "text-muted"} ${it.pronto ? "opacity-40" : ""}`}>
                  <Icon name={it.icon} size={13} className={on ? "opacity-100" : "opacity-70"} />
                  {it.label}
                  {it.pronto ? (
                    <span className="ml-auto text-[8.5px] uppercase tracking-[.1em] text-subtle">
                      pronto
                    </span>
                  ) : c ? (
                    <span className={`ml-auto font-mono text-[9px] tabular-nums
                      ${c.espera ? "text-warning-fg" : "text-subtle"}`}>{c.n}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto border-t border-border px-2 pt-2.5">
        <Pie k="huella" v={(useServer.getState().hello?.fingerprint ?? "").slice(0, 12)} />
        <Pie k="puerto" v="7717" />
      </div>
    </aside>
  );
}

function Pie({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between py-px text-[9.5px] text-subtle">
      <span>{k}</span><b className="font-mono font-normal text-muted">{v}</b>
    </div>
  );
}