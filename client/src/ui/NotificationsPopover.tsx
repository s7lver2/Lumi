import { useEffect, useState } from "react";
import { api, type AdminRequest } from "../lib/api";
import { useServer } from "../lib/store";
import { Bell } from "./Bell";
import { Icon } from "./Icon";

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

/** La campana es del administrador y para lo que le compete a él resolver, no
 *  un atajo ciego a su panel. Antes pulsarla saltaba directa a
 *  "administración" sin decir a qué: ahora enseña la lista de verdad, con una
 *  aprobación rápida para el caso simple y el panel completo a mano para
 *  cuando hay que elegir qué modelos conceder. */
export function NotificationsPopover({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const token = useServer((s) => s.token) ?? undefined;
  const [rows, setRows] = useState<AdminRequest[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    try {
      const all = await api.get<AdminRequest[]>("/v1/admin/access-requests", token);
      setRows(all.filter((r) => r.status === "pending"));
    } catch {
      setRows([]);
    }
  }
  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  async function resolve(id: number, approve: boolean) {
    setBusy(id);
    try {
      await api.post(`/v1/admin/access-requests/${id}/resolve`,
        { approve, granted_models: approve ? ["mini"] : undefined }, token);
      await load();
    } finally {
      setBusy(null);
    }
  }

  const count = rows?.length ?? 0;

  return (
    <div className="relative">
      <Bell count={count} onClick={() => setOpen((o) => !o)} />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-[30px] z-50 w-[300px] rounded-[10px] border border-white/10
            bg-[rgba(24,26,30,.96)] p-2 shadow-lg shadow-black/50 backdrop-blur-xl"
            style={{ animation: "jg-popup-scale-in 180ms cubic-bezier(.2,.85,.35,1) both" }}>
            <p className="px-1.5 py-1 text-[8px] uppercase tracking-[.11em] text-subtle">Notificaciones</p>
            {rows === null ? (
              <p className="px-1.5 py-3 text-center text-[11px] text-subtle">cargando</p>
            ) : rows.length === 0 ? (
              <p className="px-1.5 py-3 text-center text-[11px] text-subtle">nada pendiente</p>
            ) : (
              rows.map((r) => (
                <div key={r.id} className="rounded-lg p-2 hover:bg-white/[.03]">
                  <div className="flex items-start gap-2">
                    <Icon name="user" size={12} className="mt-0.5 shrink-0 text-subtle" />
                    <div className="min-w-0">
                      <p className="truncate text-[11.5px] text-fg">{r.display_name}</p>
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted">{r.message}</p>
                      <p className="mt-0.5 text-[9.5px] text-subtle">quiere entrar · {ago(r.created_at)}</p>
                    </div>
                  </div>
                  <div className="mt-1.5 flex gap-1.5">
                    <button onClick={() => void resolve(r.id, true)} disabled={busy === r.id}
                      className="jg-press flex-1 rounded-md bg-accent py-1 text-[10.5px] font-medium text-black disabled:opacity-40">
                      Aprobar (mini)
                    </button>
                    <button onClick={() => void resolve(r.id, false)} disabled={busy === r.id}
                      className="jg-press flex-1 rounded-md border border-white/15 py-1 text-[10.5px] text-fg disabled:opacity-40">
                      Rechazar
                    </button>
                  </div>
                </div>
              ))
            )}
            <button onClick={() => { setOpen(false); onOpenAdmin(); }}
              className="jg-press mt-1 block w-full rounded-lg p-1.5 text-center text-[10.5px] text-subtle hover:text-fg">
              Ver todo en Administración
            </button>
          </div>
        </>
      )}
    </div>
  );
}
