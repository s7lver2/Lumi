import { useEffect, useState } from "react";
import { api, type AdminUser, type UserDetail } from "../lib/api";

const LEVERS: [string, string][] = [
  ["models", "Modelos"],
  ["max_concurrent", "Concurrentes"],
  ["max_daily", "Al día"],
  ["max_storage_gb", "Almacenamiento (GB)"],
  ["queue_priority", "Prioridad"],
  ["can_create_projects", "Crear proyectos"],
];

export function UsersView({ token }: { token: string }) {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<AdminUser[]>("/v1/admin/users", token).then(setRows).catch((e) => setError(String(e)));
  useEffect(() => { load(); }, []);

  const open = (id: number) => api.get<UserDetail>(`/v1/admin/users/${id}`, token).then(setDetail).catch((e) => setError(String(e)));

  async function patch(id: number, body: unknown) {
    try {
      setDetail(await api.patch<UserDetail>(`/v1/admin/users/${id}`, body, token));
      load();
    } catch (e) {
      setError(String(e));
    }
  }

  if (detail) {
    const u = detail.user;
    return (
      <>
        <button onClick={() => setDetail(null)} className="mb-4 text-[11px] text-muted hover:text-fg">← Usuarios</button>
        <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-5">
          <div className="mb-3 flex items-center gap-2.5 text-xs">
            <span className="text-fg">{u.username}</span>
            {u.is_admin && <span className="rounded border border-border px-1.5 py-0.5 text-[10.5px] text-subtle">administrador</span>}
            {u.blocked && <span className="rounded border border-danger-fg/40 px-1.5 py-0.5 text-[10.5px] text-danger-fg">bloqueada</span>}
          </div>

          {u.is_admin ? (
            <p className="text-[11px] text-muted">
              Los administradores no tienen límites: se ignoran todos.
            </p>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {LEVERS.map(([key, label]) => {
                  const overridden = key in detail.overrides;
                  const value = JSON.stringify((u.limits as unknown as Record<string, unknown>)[key]);
                  const g = JSON.stringify((detail.global as unknown as Record<string, unknown>)[key]);
                  return (
                    <tr key={key} className="border-b border-border/60 last:border-0">
                      <td className="py-2 text-muted">{label}</td>
                      <td className="py-2 font-mono text-fg">{value}</td>
                      {/* El origen SIEMPRE visible: un límite sin origen es
                          indepurable cuando alguien pregunta por qué solo
                          puede lanzar uno. */}
                      <td className="py-2 text-[10.5px] text-subtle">
                        {overridden ? `anulado · global ${g}` : "hereda del global"}
                      </td>
                      <td className="py-2 text-right">
                        {overridden && (
                          <button onClick={() => patch(u.id, { limits: { [key]: null } })}
                            className="text-[10.5px] text-muted hover:text-fg">quitar anulación</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="my-4 h-px bg-border" />
          <div className="mb-2 text-[11px] text-muted">Dispositivos y sesiones</div>
          {detail.devices.map((d) => (
            <div key={d.name + d.first_seen} className="py-1 text-xs text-muted">{d.name} · {d.os ?? "—"}</div>
          ))}
          {detail.sessions.map((s) => (
            <div key={s.public_id} className="flex items-center gap-2 py-1 text-xs text-muted">
              <span className="font-mono text-[10.5px] text-subtle">{s.device_name ?? "sin equipo"}</span>
              <button onClick={() => api.del(`/v1/sessions/${s.public_id}`, token).then(() => open(u.id))}
                className="ml-auto text-[10.5px] text-muted hover:text-fg">revocar</button>
            </div>
          ))}

          <div className="my-4 h-px bg-border" />
          <div className="flex gap-2">
            <button onClick={() => patch(u.id, { blocked: !u.blocked })}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px">
              {u.blocked ? "Desbloquear" : "Bloquear"}
            </button>
            <button onClick={() => patch(u.id, { must_change_password: true })}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px">
              Exigir cambio de contraseña
            </button>
          </div>
          {error && <p className="mt-3 text-xs text-danger-fg">{error}</p>}
        </div>
      </>
    );
  }

  return (
    <>
      <p className="mb-4 text-xs text-muted">
        {rows.length} cuentas · {rows.filter((r) => r.blocked).length} bloqueadas.
      </p>
      <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-4">
        <table className="w-full text-xs">
          <thead className="text-[10.5px] text-subtle">
            <tr><th className="pb-2 text-left">Usuario</th><th className="pb-2 text-left">Modelos</th>
              <th className="pb-2 text-left">Al día</th><th className="pb-2 text-left">Estado</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              // Bloquear ATENÚA, no borra: en forense, quitar a alguien de la
              // lista borraría el rastro de quién hizo qué.
              <tr key={u.id} className={`border-t border-border/60 ${u.blocked ? "opacity-45" : ""}`}>
                <td className="py-2 text-fg">{u.username}</td>
                <td className="py-2 font-mono text-muted">{u.is_admin ? "todos" : u.limits.models.join(" ")}</td>
                <td className="py-2 font-mono text-muted">{u.is_admin ? "∞" : u.limits.max_daily}</td>
                <td className="py-2 text-muted">{u.blocked ? "bloqueada" : "activa"}</td>
                <td className="py-2 text-right">
                  <button onClick={() => open(u.id)} className="text-[10.5px] text-muted hover:text-fg">Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-3 text-xs text-danger-fg">{error}</p>}
    </>
  );
}
