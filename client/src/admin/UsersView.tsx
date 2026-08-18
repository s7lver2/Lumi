import { useEffect, useState } from "react";
import { api, type AdminUser, type Limits, type UserDetail } from "../lib/api";
import { Icon } from "../ui/Icon";
import { Seccion } from "./AdminPanel";
import { LimitsEditor } from "./LimitsEditor";
import { UserTile } from "../ui/UserTile";

type Vista = "lista" | "foto" | "nombre";

function Barra({ etiqueta, usado, tope }: { etiqueta: string; usado: number; tope: number }) {
  const pct = tope > 0 ? Math.min(100, (usado / tope) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-[11px]">
      <span className="w-[70px] shrink-0 text-subtle">{etiqueta}</span>
      <span className="h-[3px] flex-1 overflow-hidden rounded-sm bg-elevated">
        <span className={`block h-full rounded-sm transition-[width] duration-700 ease-expo ${
          pct >= 100 ? "bg-warning" : "bg-fg"}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="w-[64px] shrink-0 text-right font-mono text-[10.5px] text-muted">{usado} / {tope}</span>
    </div>
  );
}

export function UsersView({ token }: { token: string }) {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<"usuario" | "global" | null>(null);
  const [globalActual, setGlobalActual] = useState<Limits | null>(null);
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
      <Seccion titulo={u.username} grupo="Personas"
        accion={
          <button onClick={() => setDetail(null)}
            className="flex items-center gap-1.5 text-[11px] text-subtle transition-colors hover:text-fg">
            <Icon name="back" size={12} /> Usuarios
          </button>
        }>
        <div className="flex items-center gap-2">
          <UserTile nombre={u.username} conectado={false} size={30} />
          {u.is_admin && (
            <span className="rounded-[5px] border border-border px-1.5 py-px text-[9.5px] tracking-[.03em] text-subtle">
              administrador
            </span>
          )}
          {u.blocked && (
            <span className="rounded-[5px] border border-danger-fg/40 px-1.5 py-px text-[9.5px] tracking-[.03em] text-danger-fg">
              bloqueada
            </span>
          )}
        </div>

        {!u.is_admin && (
          <div className="mt-4 rounded-[11px] border border-border bg-panel p-[13px_15px]">
            <div className="mb-2.5 text-[8.5px] uppercase tracking-[.15em] text-subtle">Uso</div>
            <div className="flex flex-col gap-2">
              <Barra etiqueta="Al día" usado={detail.uso.hoy} tope={u.limits.max_daily} />
              {u.limits.weekly_enabled && (
                <Barra etiqueta="Semanal" usado={detail.uso.semana} tope={u.limits.max_weekly} />
              )}
            </div>
          </div>
        )}

        <div className="mt-4 rounded-[11px] border border-border bg-panel p-[13px_15px]">
          {u.is_admin ? (
            <p className="text-[11px] text-muted">Los administradores no tienen límites: se ignoran todos.</p>
          ) : (
            <div className="flex flex-col">
              <button onClick={() => setEditando("usuario")}
                className="mb-2.5 self-start text-[10.5px] text-muted hover:text-fg">
                editar límites de esta cuenta
              </button>
              {LEVERS.map(([key, label]) => {
                const overridden = key in detail.overrides;
                const value = JSON.stringify((u.limits as unknown as Record<string, unknown>)[key]);
                const g = JSON.stringify((detail.global as unknown as Record<string, unknown>)[key]);
                return (
                  <div key={key}
                    className="flex items-center justify-between gap-3 border-b border-border py-[7px] text-[11px] last:border-none">
                    <span className="text-subtle">{label}</span>
                    <span className="font-mono text-fg">{value}</span>
                    <span className="text-[10px] text-subtle">
                      {overridden ? `anulado · global ${g}` : "hereda del global"}
                    </span>
                    <span className="w-[92px] text-right">
                      {overridden && (
                        <button onClick={() => patch(u.id, { limits: { [key]: null } })}
                          className="text-[10px] text-muted hover:text-fg">
                          quitar anulación
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 rounded-[11px] border border-border bg-panel p-[13px_15px]">
          <div className="mb-2 text-[8.5px] uppercase tracking-[.15em] text-subtle">Dispositivos y sesiones</div>
          {detail.devices.length === 0 && detail.sessions.length === 0 && (
            <p className="text-[11px] text-subtle">sin dispositivos registrados</p>
          )}
          {detail.devices.map((d) => (
            <div key={d.name + d.first_seen} className="border-b border-border py-1.5 text-[11px] text-muted last:border-none">
              {d.name} · {d.os ?? "—"}
            </div>
          ))}
          {detail.sessions.map((s) => (
            <div key={s.public_id}
              className="flex items-center gap-2 border-b border-border py-1.5 text-[11px] text-muted last:border-none">
              <span className="font-mono text-[10.5px] text-subtle">{s.device_name ?? "sin equipo"}</span>
              <button onClick={() => api.del(`/v1/sessions/${s.public_id}`, token).then(() => open(u.id))}
                className="ml-auto text-[10px] text-muted hover:text-fg">
                revocar
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
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

        {editando === "usuario" && (
          <LimitsEditor modo="usuario" titulo={`Límites de ${u.username}`}
            valores={u.limits} overrides={detail.overrides} userId={u.id} token={token}
            onGuardado={() => { setEditando(null); open(u.id); }}
            onCerrar={() => setEditando(null)} />
        )}
      </Seccion>
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
    <Seccion titulo="Usuarios" grupo="Personas" accion={
      <span className="flex items-center gap-3">
        <button onClick={() => {
          api.get<Limits>("/v1/admin/limits", token).then(setGlobalActual).catch((e) => setError(String(e)));
          setEditando("global");
        }} className="text-[10.5px] text-muted hover:text-fg">
          límites globales
        </button>
        {seg}
      </span>
    }>
      {error && <p className="mb-3 text-[11px] text-danger-fg">{error}</p>}
      <p className="mb-4 text-xs text-muted">
        {rows.length} cuentas · {rows.filter((r) => r.blocked).length} bloqueadas.
      </p>
      {cuerpo}

      {editando === "global" && globalActual && (
        <LimitsEditor modo="global" titulo="Límites globales" valores={globalActual} token={token}
          onGuardado={() => setEditando(null)}
          onCerrar={() => setEditando(null)} />
      )}
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
  ["background_jobs", "Trabajo en segundo plano"],
  ["weekly_enabled", "Tope semanal activo"],
  ["max_weekly", "A la semana"],
];