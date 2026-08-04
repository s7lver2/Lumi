import { useEffect, useState } from "react";
import { api, type Invite } from "../lib/api";
import { useServer } from "../lib/store";
import { Icon } from "../ui/Icon";

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

/** Las invitaciones a un proyecto no entran solas: hay que aceptarlas. Este es
 *  el único sitio donde un investigador normal ve una notificación en este
 *  subsistema, y por eso vive en la propia cabecera del selector en vez de
 *  reutilizar la campana de administración, que es de otra cosa. */
export function InvitesPopover({ onAccepted }: { onAccepted: () => void }) {
  const token = useServer((s) => s.token) ?? undefined;
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    try {
      setInvites(await api.get<Invite[]>("/v1/me/invites", token));
    } catch {
      setInvites([]);
    }
  }
  useEffect(() => {
    void load();
    // Basta con mirar cada minuto: no hay empuje en tiempo real todavía, y
    // sondear cada pocos segundos por una invitación no cambia la experiencia.
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  async function resolve(pid: number, accept: boolean) {
    setBusy(pid);
    try {
      await api.post(`/v1/invites/${pid}/${accept ? "accept" : "decline"}`, {}, token);
      setInvites((v) => (v ?? []).filter((i) => i.project_id !== pid));
      if (accept) onAccepted();
    } finally {
      setBusy(null);
    }
  }

  const count = invites?.length ?? 0;

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Invitaciones" aria-label="Invitaciones"
        className="jg-press relative grid h-[26px] w-[26px] place-items-center rounded-md text-subtle hover:text-fg">
        <Icon name="bell" size={14} />
        {count > 0 && (
          <span className="absolute right-0 top-0 flex h-[13px] min-w-[13px] items-center justify-center
            rounded-full bg-draw px-[3px] text-[8px] font-medium text-white"
            style={{ animation: "jg-core-pulse 1.8s ease-in-out infinite" }}>
            {count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-[32px] z-50 w-[300px] rounded-[10px] border border-white/10
            bg-[rgba(24,26,30,.96)] p-2 shadow-lg shadow-black/50 backdrop-blur-xl"
            style={{ animation: "jg-popup-scale-in 180ms cubic-bezier(.2,.85,.35,1) both" }}>
            <p className="px-1.5 py-1 text-[8px] uppercase tracking-[.11em] text-subtle">Invitaciones</p>
            {invites === null ? (
              <p className="px-1.5 py-3 text-center text-[11px] text-subtle">cargando</p>
            ) : invites.length === 0 ? (
              <p className="px-1.5 py-3 text-center text-[11px] text-subtle">no tienes ninguna</p>
            ) : (
              invites.map((inv) => (
                <div key={inv.project_id} className="rounded-lg p-2 hover:bg-white/[.03]">
                  <p className="text-[11.5px] text-fg">{inv.project_name}</p>
                  <p className="mt-0.5 text-[10px] text-muted">
                    invitado por {inv.invited_by} · {ago(inv.added_at)}
                  </p>
                  <div className="mt-1.5 flex gap-1.5">
                    <button onClick={() => void resolve(inv.project_id, true)} disabled={busy === inv.project_id}
                      className="jg-press flex-1 rounded-md bg-accent py-1 text-[10.5px] font-medium text-black disabled:opacity-40">
                      Aceptar
                    </button>
                    <button onClick={() => void resolve(inv.project_id, false)} disabled={busy === inv.project_id}
                      className="jg-press flex-1 rounded-md border border-white/15 py-1 text-[10.5px] text-fg disabled:opacity-40">
                      Rechazar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
