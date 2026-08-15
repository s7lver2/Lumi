import { useEffect, useState } from "react";
import { api, type ApiKeyInfo, type IssuedApiKey, type SessionInfo } from "../lib/api";
import { ModalEmitir, ModalRevelada } from "../admin/ApiKeysView";
import { Icon } from "../ui/Icon";

/** Autoservicio: mis propias claves de API, y mis sesiones activas. Cuelga
 *  del hueco `onProfile` que `TitleBar.tsx` ya declaraba sin que nadie lo
 *  conectara. */
export function ProfileView({ token, onBack }: { token: string; onBack: () => void }) {
  const [claves, setClaves] = useState<ApiKeyInfo[] | null>(null);
  const [sesiones, setSesiones] = useState<SessionInfo[] | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);
  const [revelada, setRevelada] = useState<IssuedApiKey | null>(null);

  useEffect(() => { void cargarClaves(); }, [token]);
  useEffect(() => { void api.get<SessionInfo[]>("/v1/me/sessions", token).then(setSesiones); }, [token]);

  function cargarClaves() { return api.get<ApiKeyInfo[]>("/v1/me/api-keys", token).then(setClaves); }

  async function revocar(publicId: string) {
    await api.del(`/v1/api-keys/${publicId}`, token);
    void cargarClaves();
  }
  async function cerrarSesion(publicId: string) {
    await api.del(`/v1/sessions/${publicId}`, token);
    void api.get<SessionInfo[]>("/v1/me/sessions", token).then(setSesiones);
  }

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto p-8">
      <button onClick={onBack} className="mb-4 text-[10.5px] text-subtle hover:text-fg">← Volver</button>
      <h2 className="text-[19px] font-medium">Perfil y sesiones</h2>
      <p className="mt-1 text-[11px] text-muted">Tus claves de API y tus sesiones activas.</p>

      <div className="mt-6 flex items-baseline gap-3">
        <h3 className="text-[12.5px] font-medium">Mis claves de API</h3>
        <button onClick={() => setEmitiendo(true)} className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black">
          + Crear clave
        </button>
      </div>
      <div className="mt-2 rounded-card border border-border bg-panel">
        {(claves ?? []).length === 0 && <p className="p-6 text-center text-[11px] text-subtle">Sin claves.</p>}
        {(claves ?? []).map((k) => (
          <div key={k.public_id} className="flex items-center gap-3 border-b border-border p-[11px_16px] last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] text-fg">{k.label}</p>
              <p className="mt-0.5 font-mono text-[10px] text-subtle">{k.prefix}</p>
            </div>
            <button onClick={() => void revocar(k.public_id)} className="rounded-lg border border-danger/40 px-2.5 py-1 text-[9.5px] text-danger-fg">Revocar</button>
          </div>
        ))}
      </div>

      <h3 className="mb-2 mt-6 text-[12.5px] font-medium">Sesiones activas</h3>
      <div className="rounded-card border border-border bg-panel">
        {(sesiones ?? []).map((s) => (
          <div key={s.public_id} className="flex items-center gap-3 border-b border-border p-[11px_16px] last:border-b-0">
            <Icon name="device" size={14} />
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] text-fg">{s.device_name ?? "dispositivo desconocido"}{s.os ? ` · ${s.os}` : ""}</p>
              <p className="mt-0.5 text-[10px] text-subtle">{s.current ? "este equipo" : `visto ${new Date(s.last_seen * 1000).toLocaleString()}`}</p>
            </div>
            {!s.current && (
              <button onClick={() => void cerrarSesion(s.public_id)} className="rounded-lg border border-danger/40 px-2.5 py-1 text-[9.5px] text-danger-fg">Cerrar</button>
            )}
          </div>
        ))}
      </div>

      {emitiendo && (
        <ModalEmitir token={token} soloParaMi
          onCancelar={() => setEmitiendo(false)}
          onCreada={(r) => { setEmitiendo(false); setRevelada(r); void cargarClaves(); }} />
      )}
      {revelada && <ModalRevelada revelada={revelada} onCerrar={() => setRevelada(null)} />}
    </div>
  );
}
