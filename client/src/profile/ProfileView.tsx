import { useEffect, useState } from "react";
import { api, type ApiKeyInfo, type IssuedApiKey, type Me, type SessionInfo } from "../lib/api";
import { blobToBase64, pickImagePath, readImageAsDataUrl, uploadAvatarBytes } from "../lib/bridge";
import { useServer } from "../lib/store";
import { ModalEmitir, ModalRevelada } from "../admin/ApiKeysView";
import { Seccion } from "../admin/AdminPanel";
import { Icon } from "../ui/Icon";
import { ImageCropModal } from "../ui/ImageCropModal";
import { UsageBar } from "../ui/UsageBar";
import { UserTile } from "../ui/UserTile";
import { ProfileSidebar, type ProfileSeccion } from "./ProfileSidebar";

const AVATAR_SIDE = 256;

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
        {seccion === "perfil" ? <PerfilPanel token={token} />
          : seccion === "claves" ? <ClavesPanel token={token} />
          : <SesionesPanel token={token} />}
      </div>
    </div>
  );
}

function PerfilPanel({ token }: { token: string }) {
  const usuario = useServer((s) => s.username);
  const userId = useServer((s) => s.userId);
  const esAdmin = useServer((s) => s.isAdmin);
  const addr = useServer((s) => s.addr);
  // Se pide fresco en vez de leerlo del store: el uso cambia con cada
  // análisis lanzado, y `useServer` solo lo trae al iniciar sesión.
  const [me, setMe] = useState<Me | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [recortando, setRecortando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<Me>("/v1/auth/me", token).then(setMe).catch(() => setMe(null)); }, [token]);

  async function cambiarFoto() {
    const path = await pickImagePath();
    if (!path) return;
    setError(null);
    try {
      setRecortando(await readImageAsDataUrl(path));
    } catch (e) {
      setError(String(e));
    }
  }

  async function confirmarRecorte(blob: Blob) {
    setRecortando(null);
    setSubiendo(true); setError(null);
    try {
      await uploadAvatarBytes(await blobToBase64(blob));
      useServer.getState().bumpAvatarVersion();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubiendo(false);
    }
  }

  async function quitarFoto() {
    setError(null);
    try {
      await api.del("/v1/me/avatar", token);
      useServer.getState().bumpAvatarVersion();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <Seccion titulo="Perfil" grupo="Cuenta">
      <p className="text-[11px] text-muted">Quién eres en este servidor.</p>

      <div className="mt-4 flex items-center gap-3.5">
        <UserTile nombre={usuario} conectado={false} size={56} userId={userId ?? undefined} />
        <div className="flex flex-col gap-1.5">
          <button onClick={() => void cambiarFoto()} disabled={subiendo}
            className="jg-press rounded-lg border border-white/15 px-2.5 py-1 text-[10.5px] text-fg disabled:opacity-40">
            {subiendo ? "Subiendo…" : "Cambiar foto"}
          </button>
          <button onClick={() => void quitarFoto()}
            className="text-left text-[9.5px] text-subtle hover:text-fg">
            Quitar foto
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-[10.5px] text-danger-fg">{error}</p>}

      <div className="mt-4 rounded-card border border-border bg-panel">
        <Fila etiqueta="Usuario" valor={usuario} />
        <Fila etiqueta="Rol" valor={esAdmin ? "Administrador" : "Investigador"} />
        <Fila etiqueta="Servidor" valor={addr} mono />
      </div>

      {!esAdmin && me?.uso && (
        <div className="mt-4 rounded-card border border-border bg-panel p-[13px_16px]">
          <div className="mb-2.5 text-[8.5px] uppercase tracking-[.15em] text-subtle">Uso</div>
          <div className="flex flex-col gap-2">
            <UsageBar etiqueta="Al día" usado={me.uso.hoy} tope={me.limits.max_daily} />
            {me.limits.weekly_enabled && (
              <UsageBar etiqueta="Semanal" usado={me.uso.semana} tope={me.limits.max_weekly} />
            )}
          </div>
        </div>
      )}

      <p className="mt-4 text-[10.5px] text-subtle">
        El cambio de nombre o contraseña no vive todavía aquí.
      </p>

      {recortando && (
        <ImageCropModal imageDataUrl={recortando} aspect={1} shape="circle"
          outputW={AVATAR_SIDE} outputH={AVATAR_SIDE}
          onConfirm={confirmarRecorte} onCancel={() => setRecortando(null)} />
      )}
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
