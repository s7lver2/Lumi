import { useEffect, useState } from "react";
import { api, type AdminUser, type UserDetail } from "../lib/api";
import { Icon } from "../ui/Icon";
import { Seccion } from "./AdminPanel";

type Vista = "lista" | "foto" | "nombre";

function UserTile({ nombre, conectado = false, size = 36 }: { nombre: string; conectado?: boolean; size?: number }) {
  const inicial = nombre.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <div className="relative shrink-0">
      <div
        className="flex items-center justify-center rounded-full bg-white/[.08] font-mono text-[10px] uppercase text-fg"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        {inicial}
      </div>
      {conectado && (
        <span className="absolute -right-0.5 -top-0.5 block h-2 w-2 rounded-full bg-success-fg ring-2 ring-panel" />
      )}
    </div>
  );
}

export function UsersView({ token }: { token: string }) {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>(
    () => (localStorage.getItem("lumi.usuarios.vista") as Vista) ?? "lista"
  );

  useEffect(() => {
    localStorage.setItem("lumi.usuarios.vista", vista);
  }, [vista]);

  const load = () =>
    api
      .get<AdminUser[]>("/v1/admin/users", token)
      .then(setRows)
      .catch((e) => setError(String(e)));

  useEffect(() => {
    load();
  }, []);

  const open = (id: number) =>
    api
      .get<UserDetail>(`/v1/admin/users/${id}`, token)
      .then(setDetail)
      .catch((e) => setError(String(e)));

  async function patch(id: number, body: unknown) {
    try {
      setDetail(await api.patch<UserDetail>(`/v1/admin/users/${id}`, body, token));
      load();
    } catch (e) {
      setError(String(e));
    }
  }

  // Detalle abierto
  if (detail) {
    const u = detail.user;
    return (
      <>
        <button onClick={() => setDetail(null)} className="mb-4 text-[11px] text-muted hover:text-fg">
          ← Usuarios
        </button>
        <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-5">
          <div className="mb-3 flex items-center gap-2.5 text-xs">
            <span className="text-fg">{u.username}</span>
            {u.is_admin && (
              <span className="rounded border border-border px-1.5 py-0.5 text-[10.5px] text-subtle">
                administrador
              </span>
            )}
            {u.blocked && (
              <span className="rounded border border-danger-fg/40 px-1.5 py-0.5 text-[10.5px] text-danger-fg">
                bloqueada
              </span>
            )}
          </div>

          {u.is_admin ? (
            <p className="text-[11px] text-muted">Los administradores no tienen límites: se ignoran todos.</p>
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
                      <td className="py-2 text-[10.5px] text-subtle">
                        {overridden ? `anulado · global ${g}` : "hereda del global"}
                      </td>
                      <td className="py-2 text-right">
                        {overridden && (
                          <button
                            onClick={() => patch(u.id, { limits: { [key]: null } })}
                            className="text-[10.5px] text-muted hover:text-fg"
                          >
                            quitar anulación
                          </button>
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
            <div key={d.name + d.first_seen} className="py-1 text-xs text-muted">
              {d.name} · {d.os ?? "—"}
            </div>
          ))}
          {detail.sessions.map((s) => (
            <div key={s.public_id} className="flex items-center gap-2 py-1 text-xs text-muted">
              <span className="font-mono text-[10.5px] text-subtle">{s.device_name ?? "sin equipo"}</span>
              <button
                onClick={() =>
                  api.del(`/v1/sessions/${s.public_id}`, token).then(() => open(u.id))
                }
                className="ml-auto text-[10.5px] text-muted hover:text-fg"
              >
                revocar
              </button>
            </div>
          ))}

          <div className="my-4 h-px bg-border" />
          <div className="flex gap-2">
            <button
              onClick={() => patch(u.id, { blocked: !u.blocked })}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px"
            >
              {u.blocked ? "Desbloquear" : "Bloquear"}
            </button>
            <button
              onClick={() => patch(u.id, { must_change_password: true })}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px"
            >
              Exigir cambio de contraseña
            </button>
          </div>
          {error && <p className="mt-3 text-xs text-danger-fg">{error}</p>}
        </div>
      </>
    );
  }

  // Selector de vista (segmentado)
  const seg = (
    <span className="flex overflow-hidden rounded-[8px] border border-border bg-panel shadow-[inset_0_1px_0_rgba(255,255,255,.045)]">
      {(
        [
          ["lista", "Lista"],
          ["foto", "Retícula"],
          ["nombre", "Retícula con nombre"],
        ] as const
      ).map(([v, t], i) => (
        <button
          key={v}
          title={t}
          onClick={() => setVista(v)}
          className={`flex items-center px-2 py-[4.5px] transition-colors duration-[340ms] ease-expo
            ${i > 0 ? "border-l border-border" : ""}
            ${vista === v ? "bg-white/[.075] text-fg" : "text-subtle hover:text-muted"}`}
        >
          <Icon name={v === "lista" ? "layers" : v === "foto" ? "boxes" : "image"} size={13} />
        </button>
      ))}
    </span>
  );

  const cuerpo =
    vista === "lista" ? (
      <div className="overflow-hidden rounded-[11px] border border-border bg-panel">
        {rows.map((u, i) => (
          <div
            key={u.id}
            onClick={() => open(u.id)}
            style={{
              animation: `jg-fade-rise .58s ${Math.min(i, 8) * 45}ms cubic-bezier(.16,1,.3,1) both`,
            }}
            className="grid cursor-pointer grid-cols-[1fr_96px_108px] items-center gap-3 border-t border-border px-3.5 py-2.5 first:border-t-0 transition-colors duration-[400ms] ease-expo hover:bg-white/[.026]"
          >
            <span className="flex min-w-0 items-center gap-2.5 text-[11.5px] text-fg">
              <UserTile nombre={u.username} conectado={false} size={24} />
              {u.username}
            </span>
            <span className="text-[10.5px] text-muted">{u.is_admin ? "administrador" : "analista"}</span>
            <span className="text-right font-mono text-[10.5px] text-muted">#{u.id}</span>
          </div>
        ))}
      </div>
    ) : (
      <div
        className={`grid gap-3 ${
          vista === "foto"
            ? "grid-cols-[repeat(auto-fill,minmax(76px,1fr))]"
            : "grid-cols-[repeat(auto-fill,minmax(124px,1fr))]"
        }`}
      >
        {rows.map((u, i) => (
          <button
            key={u.id}
            onClick={() => open(u.id)}
            style={{
              animation: `jg-fade-rise .58s ${Math.min(i, 8) * 45}ms cubic-bezier(.16,1,.3,1) both`,
            }}
            className="flex flex-col items-center gap-2.5 rounded-[11px] border border-border bg-panel p-[13px_10px] shadow-[inset_0_1px_0_rgba(255,255,255,.045)] transition-[border-color,transform] duration-[450ms] ease-expo hover:-translate-y-[3px] hover:border-white/[.22]"
          >
            <UserTile nombre={u.username} conectado={false} />
            {vista === "nombre" && (
              <>
                <span className="max-w-full truncate text-[11px] text-fg">{u.username}</span>
                <span className="text-[9px] tracking-[.04em] text-subtle">
                  {u.is_admin ? "administrador" : "analista"}
                </span>
              </>
            )}
          </button>
        ))}
      </div>
    );

  return (
    <Seccion titulo="Usuarios" grupo="Personas" accion={seg}>
      {error && <p className="mb-3 text-[11px] text-danger-fg">{error}</p>}
      <p className="mb-4 text-xs text-muted">
        {rows.length} cuentas · {rows.filter((r) => r.blocked).length} bloqueadas.
      </p>
      {cuerpo}
    </Seccion>
  );
}

// LEVERS (no se modifica)
const LEVERS: [string, string][] = [
  ["models", "Modelos"],
  ["max_concurrent", "Concurrentes"],
  ["max_daily", "Al día"],
  ["max_storage_gb", "Almacenamiento (GB)"],
  ["queue_priority", "Prioridad"],
  ["can_create_projects", "Crear proyectos"],
];