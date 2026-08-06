import { useState } from "react";
import { api, type Me } from "../lib/api";
import { announcePresence } from "../lib/bridge";
import { updateSession } from "../lib/session";
import { useServer } from "../lib/store";
import { Icon } from "../ui/Icon";

export function ChangePasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const token = useServer((s) => s.token);

  // Descarta el intento sin cambiar nada: no cierra la sesión en el
  // servidor (el token de "solo cambiar contraseña" expira solo), solo deja
  // de usarlo aquí para poder loguear con otra cuenta.
  function cancel() {
    useServer.getState().setToken(null);
    updateSession({ token: undefined });
    onCancel();
  }
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api.post("/v1/auth/change-password", { current, new: next }, token!);
      // Antes de aquí la sesión iba con un token "solo cambiar contraseña":
      // `/v1/auth/me` contestaba 403 y ni se intentaba pedir, así que
      // `limits` se quedaba en `null` y la telemetría y la cola nunca
      // arrancaban para quien entraba por este camino.
      const me = await api.get<Me>("/v1/auth/me", token!);
      useServer.getState().setUser(me.username, me.is_admin, me.limits);
      await announcePresence(token!);
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]";
  const mismatch = repeat.length > 0 && repeat !== next;

  return (
    <>
      <div className="flex items-start gap-2.5 py-[7px] text-xs text-muted">
        {/* Naranja de estado sellado en DESIGN.md: no se inventa un color nuevo. */}
        <Icon name="alert" className="mt-0.5 text-warning-fg" />
        <span>El administrador ha pedido que cambies tu contraseña antes de continuar.</span>
      </div>
      <div className="my-3 h-px bg-border" />
      <label className="mb-[7px] block text-[11px] text-muted">Contraseña actual</label>
      <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={field} />
      <div className="h-3" />
      <label className="mb-[7px] block text-[11px] text-muted">Nueva contraseña</label>
      <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className={field} />
      <div className="h-3" />
      <label className="mb-[7px] block text-[11px] text-muted">Repítela</label>
      <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={field} />
      <p className="mt-2.5 max-w-[54ch] text-[11px] text-muted">
        Mínimo 12 caracteres. Las demás sesiones abiertas se cerrarán.
      </p>

      {(error || mismatch) && (
        <div className="mt-3.5 flex items-start gap-2.5 text-xs">
          <Icon name="alert" className="mt-0.5 text-danger-fg" />
          <span className="text-muted">{mismatch ? "las dos contraseñas no coinciden" : error}</span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <button onClick={cancel} className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg active:translate-y-px">
          Cancelar
        </button>
        <button onClick={submit} disabled={busy || next.length < 12 || mismatch || !current}
          className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          {busy ? "Guardando" : "Cambiar y continuar"}
        </button>
      </div>
    </>
  );
}
