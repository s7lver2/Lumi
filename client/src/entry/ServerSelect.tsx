import { useEffect, useRef, useState } from "react";
import { forgetServer, loadServers, type Server } from "../lib/session";
import { ContextMenu, menuAt, type MenuEntry, type MenuState } from "../ui/ContextMenu";
import { Icon } from "../ui/Icon";

export function ServerSelect({ value, onChange, onAdd }: {
  value: Server | null; onChange: (s: Server) => void; onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<Server[]>(loadServers());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // La lista puede haber cambiado por fuera (AddServerForm, otra pestaña) —
  // se relee cada vez que se abre en vez de una sola vez al montar.
  useEffect(() => {
    if (!open) return;
    setServers(loadServers());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  // stopPropagation en cada disparador: sin él, el mismo clic que abre el menú
  // llega al listener del documento y lo cierra en el mismo fotograma.
  const stop = (e: React.MouseEvent, fn: () => void) => { e.stopPropagation(); fn(); };

  function refrescar() {
    setServers(loadServers());
  }

  function abrirMenuServidor(e: React.MouseEvent, s: Server) {
    const items: MenuEntry[] = [
      { label: "Olvidar", onClick: () => { forgetServer(s.addr); refrescar(); } },
    ];
    menuAt(e, s.label || s.addr, items, setMenu);
  }

  function Fila({ s }: { s: Server }) {
    return (
      <button onContextMenu={(e) => abrirMenuServidor(e, s)}
        onClick={(e) => stop(e, () => { onChange(s); setOpen(false); })}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-fg hover:bg-white/[.05]">
        <span className="flex w-[13px] shrink-0 justify-center">
          {s.addr === value?.addr ? <Icon name="check" /> : null}
        </span>
        {s.avatarDataUrl ? (
          <img src={s.avatarDataUrl} alt="" className="h-[18px] w-[18px] shrink-0 rounded-full object-cover" />
        ) : (
          <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-elevated text-subtle">
            <Icon name="device" size={10} />
          </span>
        )}
        <span className="truncate">{s.label}</span>
        {s.label !== s.addr && (
          <span className="ml-auto shrink-0 font-mono text-[11px] text-subtle">{s.addr}</span>
        )}
      </button>
    );
  }

  return (
    <div ref={box} className="relative">
      <button onClick={(e) => stop(e, () => setOpen((o) => !o))}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-left text-[12.5px] text-fg outline-none transition-[border-color] duration-300 ease-expo hover:border-white/30">
        <span>{value?.label ?? "sin servidores"}</span>
        <Icon name="chevron" className={`transition-transform duration-300 ease-expo ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-[280px] overflow-y-auto rounded-lg border border-border bg-[#0d0f12] shadow-lg shadow-black/50"
          style={{ animation: "jg-fade-rise .28s both" }}>
          {servers.map((s) => <Fila key={s.addr} s={s} />)}

          {servers.length > 0 && <div className="h-px bg-border" />}
          <button onClick={(e) => stop(e, () => { onAdd(); setOpen(false); })}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-fg hover:bg-white/[.05]">
            <Icon name="plus" /> Configurar un servidor nuevo
          </button>
        </div>
      )}
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
