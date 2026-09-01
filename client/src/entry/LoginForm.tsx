import { useState } from "react";
import { api, parseVersionMismatch, type LoginRes, type Me } from "../lib/api";
import { announcePresence, fetchLumiAvatarDataUrl, setAuth } from "../lib/bridge";
import { deviceId, deviceName, updateServerAvatar, updateSession, type Server } from "../lib/session";
import { useServer } from "../lib/store";
import { Icon } from "../ui/Icon";
import { ServerSelect } from "./ServerSelect";
import { VersionMismatchModal } from "./VersionMismatchNotice";

export function LoginForm({ server, onServer, onAdd, onRequest, onSignedIn, onMustChange }: {
  server: Server | null; onServer: (s: Server) => void; onAdd: () => void;
  onRequest: () => void; onSignedIn: () => void; onMustChange: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Sobrevive al cierre del popup: una vez que se aceptó el desajuste de
  // versión, el siguiente intento de "Entrar" no debe volver a chocar con
  // el mismo bloqueo.
  const [forzarVersion, setForzarVersion] = useState(false);

  // `forzar`, no solo el estado `forzarVersion`: cuando `forzarEntrada` (más
  // abajo) dispara el login de inmediato tras aceptar el desajuste de
  // versión, `setForzarVersion(true)` todavía no se ha aplicado en el
  // siguiente render — `submit` seguiría leyendo el `forzarVersion` viejo
  // (`false`) de este cierre y chocaría otra vez con el mismo bloqueo.
  // Pasarlo explícito evita depender del timing de React.
  async function submit(forzar = forzarVersion) {
    if (!server || !username || !password) return;
    setBusy(true); setError(null);
    try {
      // Sin guardar esto, `hello` se queda en null: la franja de telemetría
      // no se muestra (exige `hello`) y el sondeo de conexión ni arranca
      // (depende de `hello !== null`) — quien entra por aquí en vez de por
      // el asistente del owner se queda sin heartbeat para siempre.
      const h = await api.reconnect(server.addr, server.fingerprint, forzar);
      useServer.getState().setHello(h);
      // En segundo plano — un avatar desactualizado no debe retrasar el
      // login, y un fallo aquí (servidor sin avatar, sin red un instante)
      // no es un error de inicio de sesión.
      void fetchLumiAvatarDataUrl().then((d) => { if (d) updateServerAvatar(server.addr, d); });
      const res = await api.post<LoginRes>("/v1/auth/login", {
        username, password,
        device: { client_id: deviceId(), name: deviceName(), os: navigator.userAgent },
      });
      useServer.getState().setToken(res.token);
      setAuth(res.token);
      useServer.getState().setUser(res.username, res.is_admin, null, res.id);
      useServer.getState().setAddr(server.addr);
      updateSession({ addr: server.addr, fingerprint: server.fingerprint, token: res.token, username: res.username });
      if (res.must_change_password) { onMustChange(); return; }
      // El login no trae los límites, y la primera pantalla ya los necesita
      // para saber si ofrecer "nuevo proyecto". Con un cambio de contraseña
      // pendiente esta ruta contesta 403 a propósito, así que solo se pide
      // cuando la sesión está completa.
      const me = await api.get<Me>("/v1/auth/me", res.token);
      useServer.getState().setUser(me.username, me.is_admin, me.limits, me.id);
      // Sin esto, quien entra por aquí (todo usuario normal, siempre) se
      // quedaba sin resultados de sus análisis hasta la próxima vez que
      // cerrara y reabriera la app — el único otro camino que lo arrancaba.
      await announcePresence(res.token);
      onSignedIn();
    } catch (e) {
      const msg = String(e);
      // El error de conexión trae este prefijo (ver `client_for`/`connect`
      // en `client/src-tauri/src/main.rs`) cuando la dirección guardada ya
      // no responde — puede ser un corte de red normal, o que el admin
      // cambió el puerto/host y esta sesión no estaba conectada para
      // recibir el aviso en vivo. La pista cubre ese segundo caso sin
      // afirmar que sea la causa segura.
      setError(
        msg.includes("no se pudo conectar")
          ? `${msg}. ¿Cambió de dirección el servidor? Pide una tarjeta nueva y añádela.`
          : msg
      );
    } finally {
      setBusy(false);
    }
  }

  const mismatch = error ? parseVersionMismatch(error) : null;

  async function forzarEntrada() {
    if (!server) return;
    const h = await api.reconnect(server.addr, server.fingerprint, true);
    useServer.getState().setHello(h);
    setForzarVersion(true);
    setError(null);
    // Antes esto solo cerraba el popup y dejaba el error en null: el
    // usuario tenía que pulsar "Entrar" una segunda vez para que el login
    // realmente se intentara — el primer "continuar" no hacía nada
    // visible, y si las credenciales eran incorrectas el fallo se sentía
    // "silencioso" porque nada indicaba que hiciera falta ese segundo
    // clic. Se dispara el intento real de inmediato, pasando `true`
    // explícito (ver comentario en `submit`) en vez de esperar a que
    // `forzarVersion` se actualice en el próximo render.
    await submit(true);
  }

  return (
    <>
      {mismatch && <VersionMismatchModal {...mismatch} onClose={() => setError(null)} onForzar={forzarEntrada} />}
      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Servidor</label>
      <ServerSelect value={server} onChange={onServer} onAdd={onAdd} />
      {server && (
        <div className="mt-2.5 flex items-center gap-2 text-[11px] text-muted">
          <Icon name="check" /> Servidor verificado
        </div>
      )}
      <div className="my-3.5 h-px bg-border" />

      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Usuario</label>
      <input value={username} onChange={(e) => setUsername(e.target.value)}
        className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]" />
      <div className="h-3" />
      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Contraseña</label>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]" />

      {error && !mismatch && (
        <div className="mt-3.5 flex items-start gap-2.5 text-xs">
          <Icon name="alert" className="mt-0.5 text-danger-fg" />
          <span className="text-muted">{error}</span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-4">
        {/* Sin servidor elegido no hay a quién pedirle acceso. */}
        {server ? (
          <button onClick={onRequest} className="whitespace-nowrap text-[11px] text-muted underline-offset-4 hover:text-fg hover:underline">
            ¿Sin cuenta? · Solicitar acceso
          </button>
        ) : <span />}
        {/* No `onClick={submit}`: `submit` ahora acepta un `forzar` opcional
            (ver más arriba), y React pasaría el propio evento de clic como
            ese argumento — forzando el bypass de versión en cada intento
            normal de login. */}
        <button onClick={() => void submit()} disabled={busy || !server}
          className="shrink-0 rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          {busy ? "Entrando" : "Entrar"}
        </button>
      </div>
    </>
  );
}
