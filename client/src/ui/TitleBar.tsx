import { useEffect, useRef, useState } from "react";
import { useServer } from "../lib/store";
import { Avatar } from "./Avatar";
import { Icon, LockIcon } from "./Icon";
import { NotificationsPopover } from "./NotificationsPopover";
import { WindowControls } from "./WindowFrame";

export interface Crumb { label: string; onClick?: () => void }

/** Alto de la barra de título, en px lógicos. */
export const TITLEBAR_H = 38;

/** Una sola franja para todo el cromo de arriba.
 *
 *  Antes eran dos: la de migas de pan y, encima, 70 px fijos de telemetría que
 *  solo el administrador entendía y que estaban en TODAS las pantallas. Aquí
 *  se juntan, y la telemetría pasa a ser una píldora que abre su detalle al
 *  pulsarla — el hardware del servidor es algo que se consulta, no algo que
 *  haya que tener delante mientras trabajas.
 *
 *  Es además la barra de la ventana: sin decoración del sistema, esta franja
 *  es la zona de arrastre y la que lleva minimizar, maximizar y cerrar. */
export function TitleBar({ crumbs, onOpenAdmin, onProfile, onSignOut, onProjectAccepted }: {
  crumbs: Crumb[];
  onOpenAdmin: () => void;
  onProfile?: () => void;
  onSignOut: () => void;
  /** Aceptar una invitación aquí no toca el selector de proyectos: son
   *  componentes hermanos y el selector solo carga una vez al montarse. */
  onProjectAccepted?: () => void;
}) {
  const isAdmin = useServer((s) => s.isAdmin);
  const username = useServer((s) => s.username);
  const signedIn = useServer((s) => s.token) !== null;

  return (
    <header data-tauri-drag-region
      className="relative z-[60] flex h-[38px] shrink-0 items-center gap-2.5 border-b border-border
        bg-[rgba(13,15,17,.92)] pl-2.5 backdrop-blur-md">
      <span className="grid h-[18px] w-[18px] shrink-0 place-items-center text-fg">
        <Icon name="logo" size={15} />
      </span>

      <nav data-tauri-drag-region className="flex min-w-0 items-center gap-[7px] text-[11.5px]">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-[7px]">
            {i > 0 && <span className="shrink-0 text-[#3a3e44]">/</span>}
            {c.onClick ? (
              <button onClick={c.onClick}
                className="truncate text-subtle transition-colors duration-300 ease-expo hover:text-fg">
                {c.label}
              </button>
            ) : (
              <span data-tauri-drag-region className="truncate text-fg">{c.label}</span>
            )}
          </span>
        ))}
      </nav>

      <span data-tauri-drag-region className="h-full flex-1" />

      {signedIn && (
        <>
          {isAdmin && <ServerPill />}
          <NotificationsPopover onOpenAdmin={onOpenAdmin} onProjectAccepted={onProjectAccepted} />
          <UserMenu name={username} isAdmin={isAdmin}
            onOpenAdmin={onOpenAdmin} onProfile={onProfile} onSignOut={onSignOut} />
          <span className="h-[18px] w-px bg-border" />
        </>
      )}

      <WindowControls />
    </header>
  );
}

/** Cierra al pulsar fuera y con Escape. Lo comparten las tres cosas que cuelgan
 *  de esta barra, y tenerlo tres veces escrito era tenerlo tres veces distinto. */
export function usePopover(): [boolean, (v: boolean) => void, React.RefObject<HTMLDivElement | null>] {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const fuera = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return [open, setOpen, box];
}

const pop = "absolute right-0 top-[30px] z-[70] rounded-[11px] border border-white/[.12] " +
  "bg-[rgba(20,22,26,.97)] shadow-lg shadow-black/50 backdrop-blur-xl";
const popAnim = { animation: "jg-popup-scale-in 180ms cubic-bezier(.2,.85,.35,1) both" };

/** El estado del servidor, en 24 px de alto. Al pulsar, el detalle que antes
 *  ocupaba una franja permanente. */
function ServerPill() {
  const { hello, sample, addr } = useServer();
  const [open, setOpen, box] = usePopover();
  if (!hello) return null;

  const gpu = hello.gpus[0];
  const s = gpu ? sample?.gpus.find((x) => x.index === gpu.index) : undefined;
  const resumen = gpu
    ? `gpu ${s ? `${s.util_pct}%` : "—"}`
    : `cpu ${sample ? `${sample.cpu_pct.toFixed(0)}%` : "—"}`;

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex h-[24px] items-center gap-1.5 rounded-[7px] border border-transparent px-2
          text-[10.5px] text-muted transition-colors duration-300 ease-expo
          hover:border-white/[.09] hover:bg-white/[.05] hover:text-fg">
        <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${hello.locked ? "bg-warning" : "bg-draw"}`}
          style={{ animation: "jg-core-pulse 2.6s ease-in-out infinite" }} />
        <span className="font-mono">{addr || "servidor"}</span>
        <span className="font-mono text-subtle">{resumen}</span>
      </button>

      {open && (
        <div className={`${pop} w-[250px] p-2.5`} style={popAnim}>
          <div className="flex items-center gap-[7px] text-[11.5px] text-fg">
            {hello.locked && <LockIcon size={12} className="text-warning" />}
            <span>{hello.locked ? "Servidor sellado" : "Servidor verificado"}</span>
          </div>
          <p className="mb-2 font-mono text-[10px] text-subtle">
            {addr} · {hello.mode === "native" ? "nativo" : "docker"}
          </p>

          {hello.gpus.map((g) => {
            const m = sample?.gpus.find((x) => x.index === g.index);
            return (
              <div key={g.index} className="mt-1.5">
                <Row k={`gpu${g.index} · ${g.name.replace(/NVIDIA |GeForce /g, "")}`}
                  v={m ? `${m.util_pct}%` : "—"} />
                <Meter pct={m?.util_pct ?? 0} />
                <Row k="vram"
                  v={m ? `${(m.vram_used_mb / 1024).toFixed(1)} / ${Math.round(m.vram_total_mb / 1024)} GB` : "—"} />
                <Meter pct={m ? (m.vram_used_mb / Math.max(1, m.vram_total_mb)) * 100 : 0} />
              </div>
            );
          })}

          {hello.gpus.length === 0 && (
            <>
              <Row k="cpu" v={sample ? `${sample.cpu_pct.toFixed(0)}%` : "—"} />
              <Meter pct={sample?.cpu_pct ?? 0} />
              <Row k="ram" v={sample ? `${(sample.ram_used_mb / 1024).toFixed(1)} GB` : "—"} />
            </>
          )}

          <div className="mt-2 border-t border-border pt-2">
            <Row k="cola" v={sample ? String(sample.queue_depth) : "—"} />
            {sample?.queue_paused && <p className="mt-1 text-[10px] text-warning-fg">en pausa</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px] text-[10.5px]">
      <span className="truncate text-subtle">{k}</span>
      <span className="shrink-0 font-mono text-fg">{v}</span>
    </div>
  );
}

function Meter({ pct }: { pct: number }) {
  return (
    <div className="h-[3px] overflow-hidden rounded-sm bg-white/[.07]">
      <div className="h-full rounded-sm bg-draw transition-[width] duration-1000 ease-expo"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

function UserMenu({ name, isAdmin, onOpenAdmin, onProfile, onSignOut }: {
  name: string; isAdmin: boolean;
  onOpenAdmin: () => void; onProfile?: () => void; onSignOut: () => void;
}) {
  const [open, setOpen, box] = usePopover();
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-[7px] rounded-lg px-1.5 py-[3px] text-[11px] text-muted
          transition-colors duration-300 ease-expo hover:bg-white/[.05] hover:text-fg">
        <Avatar name={name} size={21} />
        <span className="max-w-[110px] truncate">{name}</span>
      </button>

      {open && (
        <div className={`${pop} w-[190px] p-1.5`} style={popAnim}>
          <div className="flex items-center gap-2 px-1.5 pb-2 pt-1">
            <Avatar name={name} size={26} />
            <div className="min-w-0">
              <p className="truncate text-[11.5px] text-fg">{name}</p>
              <p className="text-[10px] text-subtle">{isAdmin ? "administrador" : "investigador"}</p>
            </div>
          </div>
          {onProfile && <Item onClick={() => { setOpen(false); onProfile(); }}>Perfil y sesiones</Item>}
          {isAdmin && <Item onClick={() => { setOpen(false); onOpenAdmin(); }}>Administración</Item>}
          <Item danger onClick={() => { setOpen(false); onSignOut(); }}>Cerrar sesión</Item>
        </div>
      )}
    </div>
  );
}

function Item({ danger, onClick, children }:
  { danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`block w-full rounded-lg px-2 py-1.5 text-left text-[11.5px] transition-colors duration-200
        ${danger ? "text-danger-fg hover:bg-danger/20" : "text-muted hover:bg-white/[.06] hover:text-fg"}`}>
      {children}
    </button>
  );
}
