import { useEffect, useRef, useState } from "react";
import { loadServers, type Server } from "../lib/session";
import { Icon } from "../ui/Icon";

export function ServerSelect({ value, onChange, onAdd }: {
  value: Server | null; onChange: (s: Server) => void; onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const servers = loadServers();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  // stopPropagation en cada disparador: sin él, el mismo clic que abre el menú
  // llega al listener del documento y lo cierra en el mismo fotograma.
  const stop = (e: React.MouseEvent, fn: () => void) => { e.stopPropagation(); fn(); };

  return (
    <div ref={box} className="relative">
      <button onClick={(e) => stop(e, () => setOpen((o) => !o))}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-left font-mono text-[12.5px] text-fg outline-none transition-[border-color] duration-300 ease-expo hover:border-white/30">
        <span>{value?.addr ?? "sin servidores"}</span>
        <Icon name="chevron" className={`transition-transform duration-300 ease-expo ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-lg border border-border bg-[#0d0f12] shadow-lg shadow-black/50"
          style={{ animation: "jg-fade-rise .28s both" }}>
          {servers.map((s) => (
            <button key={s.addr} onClick={(e) => stop(e, () => { onChange(s); setOpen(false); })}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-fg hover:bg-white/[.05]">
              {s.addr === value?.addr ? <Icon name="check" /> : <span className="w-[13px]" />}
              <span className="font-mono">{s.addr}</span>
              <span className="ml-auto text-[11px] text-subtle">{s.label}</span>
            </button>
          ))}
          {servers.length > 0 && <div className="h-px bg-border" />}
          <button onClick={(e) => stop(e, () => { onAdd(); setOpen(false); })}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-fg hover:bg-white/[.05]">
            <Icon name="plus" /> Configurar un servidor nuevo
          </button>
        </div>
      )}
    </div>
  );
}
