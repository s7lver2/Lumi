import { useEffect, useState } from "react";
import { api, type ApiKeyInfo, type IssuedApiKey, type SessionInfo } from "../lib/api";
import { useServer } from "../lib/store";
import { ModalEmitir, ModalRevelada } from "../admin/ApiKeysView";
import { Seccion } from "../admin/AdminPanel";
import { Icon } from "../ui/Icon";
import { ProfileSidebar, type ProfileSeccion } from "./ProfileSidebar";

/** Autoservicio: mis propias claves de API, y mis sesiones activas. Cuelga
 *  del hueco `onProfile` que `TitleBar.tsx` ya declaraba sin que nadie lo
 *  conectara. Mismo fondo liso, misma barra lateral y el mismo patrón de
 *  sección que el panel de administración — esta pantalla gestiona la
 *  cuenta, no es ambientación de un caso de trabajo. */
export function ProfileView({ token, onBack }: { token: string; onBack: () => void }) {
  const [seccion, setSeccion] = useState<ProfileSeccion>("perfil");

  return (
    <div className="grid h-full w-full grid-cols-[206px_1fr] overflow-hidden bg-bg">
      <ProfileSidebar actual={seccion} onIr={setSeccion} onBack={onBack} />
      <div key={seccion} className="overflow-y-auto"
        style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
        {seccion === "perfil" ? <PerfilPanel />
          : seccion === "claves" ? <ClavesPanel token={token} />
          : <SesionesPanel token={token} />}
      </div>
    </div>
  );
}

function PerfilPanel() {
  const usuario = useServer((s) => s.username);
  const esAdmin = useServer((s) => s.isAdmin);
  const addr = useServer((s) => s.addr);

  return (
    <Seccion titulo="Perfil" grupo="Cuenta">
      <p className="text-[11px] text-muted">Quién eres en este servidor.</p>
      <div className="mt-4 rounded-card border border-border bg-panel">
        <Fila etiqueta="Usuario" valor={usuario} />
        <Fila etiqueta="Rol" valor={esAdmin ? "Administrador" : "Investigador"} />
        <Fila etiqueta="Servidor" valor={addr} mono />
      </div>
      <p className="mt-4 text-[10.5px] text-subtle">
        El cambio de nombre o contraseña no vive todavía aquí.
      </p>
    </Seccion>
  );
}

function Fila({ etiqueta, valor, mono }: { etiqueta: string; valor: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-border p-[11px_16px] last:border-b-0">
      <span className="text-[11px] text-muted">{etiqueta}</span>
      <span className={`ml-auto text-[11.5px] text-fg ${mono ? "font-mono text-[10.5px]" : ""}`}>{valor}</span>
    </div>
  );
}

function ClavesPanel({ token }: { token: string }) {
  const [claves, setClaves] = useState<ApiKeyInfo[] | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);
  const [revelada, setRevelada] = useState<IssuedApiKey | null>(null);

  useEffect(() => { void cargarClaves(); }, [token]);

  function cargarClaves() { return api.get<ApiKeyInfo[]>("/v1/me/api-keys", token).then(setClaves); }

  async function revocar(publicId: string) {
    await api.del(`/v1/api-keys/${publicId}`, token);
    void cargarClaves();
  }

  return (
    <Seccion titulo="API Keys" grupo="Cuenta"
      accion={
        <button onClick={() => setEmitiendo(true)} className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black">
          + Crear clave
        </button>
      }>
      <p className="text-[11px] text-muted">Tus propias claves para llamar a la API.</p>
      <div className="mt-4 rounded-card border border-border bg-panel">
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

      {emitiendo && (
        <ModalEmitir token={token} soloParaMi
          onCancelar={() => setEmitiendo(false)}
          onCreada={(r) => { setEmitiendo(false); setRevelada(r); void cargarClaves(); }} />
      )}
      {revelada && <ModalRevelada revelada={revelada} onCerrar={() => setRevelada(null)} />}
    </Seccion>
  );
}

function SesionesPanel({ token }: { token: string }) {
  const [sesiones, setSesiones] = useState<SessionInfo[] | null>(null);

  useEffect(() => { void cargar(); }, [token]);

  function cargar() { return api.get<SessionInfo[]>("/v1/me/sessions", token).then(setSesiones); }

  async function cerrarSesion(publicId: string) {
    await api.del(`/v1/sessions/${publicId}`, token);
    void cargar();
  }

  return (
    <Seccion titulo="Sesiones" grupo="Cuenta">
      <p className="text-[11px] text-muted">Dispositivos con sesión abierta como tú.</p>
      <div className="mt-4 rounded-card border border-border bg-panel">
        {(sesiones ?? []).length === 0 && <p className="p-6 text-center text-[11px] text-subtle">Sin sesiones.</p>}
        {(sesiones ?? []).map((s) => (
          <div key={s.public_id} className="flex items-center gap-3 border-b border-border p-[11px_16px] last:border-b-0">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border bg-elevated text-muted">
              <Icon name="device" size={14} />
            </span>
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
    </Seccion>
  );
}
