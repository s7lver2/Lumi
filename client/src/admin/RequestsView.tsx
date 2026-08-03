import { useEffect, useState } from "react";
import { api, type AdminRequest } from "../lib/api";
import { Icon } from "../ui/Icon";

const MODELS = ["mini", "pro", "vision"];

export function RequestsView({ token }: { token: string }) {
  const [rows, setRows] = useState<AdminRequest[]>([]);
  const [granted, setGranted] = useState<Record<number, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<AdminRequest[]>("/v1/admin/access-requests", token).then(setRows).catch((e) => setError(String(e)));
  useEffect(() => { load(); }, []);

  async function resolve(id: number, approve: boolean) {
    try {
      await api.post(`/v1/admin/access-requests/${id}/resolve`,
        { approve, granted_models: approve ? granted[id] ?? ["mini"] : undefined }, token);
      load();
    } catch (e) {
      // 409: otro administrador ya la resolvió. Se recarga para ver qué pasó.
      setError(String(e));
      load();
    }
  }

  const toggle = (id: number, m: string) =>
    setGranted((g) => {
      const cur = g[id] ?? ["mini"];
      return { ...g, [id]: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] };
    });

  const pending = rows.filter((r) => r.status === "pending");

  return (
    <>
      <p className="mb-4 text-xs text-muted">
        {pending.length} pendientes · provisional, el panel llega en el subsistema 3.
      </p>
      {error && <p className="mb-3 text-xs text-danger-fg">{error}</p>}
      {rows.map((r) => (
        <div key={r.id} className={`mb-2.5 rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-4 ${r.status !== "pending" ? "opacity-45" : ""}`}>
          <div className="flex items-center gap-2.5 text-xs">
            <span className="text-fg">{r.display_name}</span>
            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-subtle">{r.source_ip}</span>
            {r.external && (
              <span className="rounded border border-warning-fg/40 px-1.5 py-0.5 text-[10.5px] text-warning-fg">
                fuera de la red local
              </span>
            )}
            <span className="ml-auto font-mono text-[10.5px] text-subtle">{r.status}</span>
          </div>
          <p className="mt-2.5 max-w-[70ch] text-xs leading-relaxed text-muted">{r.message}</p>
          {r.status === "pending" && (
            <div className="mt-3 flex items-center gap-2">
              <button onClick={() => resolve(r.id, true)}
                className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black active:translate-y-px">Aprobar</button>
              <button onClick={() => resolve(r.id, false)}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px">Rechazar</button>
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-subtle">
                conceder:
                {MODELS.map((m) => {
                  const on = (granted[r.id] ?? ["mini"]).includes(m);
                  return (
                    <button key={m} onClick={() => toggle(r.id, m)}
                      className={`rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-300 ease-expo ${
                        on ? "border-accent text-fg" : "border-border text-subtle"}`}>
                      {m}
                    </button>
                  );
                })}
              </span>
            </div>
          )}
        </div>
      ))}
      {rows.length === 0 && (
        <div className="flex items-center gap-2.5 text-xs text-muted"><Icon name="user" /> No hay solicitudes.</div>
      )}
    </>
  );
}
