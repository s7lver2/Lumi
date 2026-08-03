import { useState } from "react";
import { api, type AccessStatus } from "../lib/api";
import { loadSession, updateSession } from "../lib/session";
import { Icon } from "../ui/Icon";

export function ResolvedScreen({ status, onCreated, onRetry, onBack }: {
  status: AccessStatus; onCreated: () => void; onRetry: () => void; onBack: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status.status === "rejected") {
    return (
      <>
        <div className="flex items-center gap-2.5 py-[7px] text-xs text-muted">
          <Icon name="x" className="text-danger-fg" /> Solicitud rechazada
        </div>
        {status.reason && (
          <>
            <div className="my-3 h-px bg-border" />
            <p className="max-w-[56ch] text-xs leading-relaxed text-muted">«{status.reason}»</p>
          </>
        )}
        <div className="my-3 h-px bg-border" />
        <p className="text-[11px] text-muted">Un rechazo no te impide volver a solicitarlo.</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button onClick={onBack} className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg active:translate-y-px">
            Volver al inicio
          </button>
          <button onClick={onRetry}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px">
            Solicitar de nuevo
          </button>
        </div>
      </>
    );
  }

  async function create() {
    const ticket = loadSession()?.ticket;
    if (!ticket) return;
    setBusy(true); setError(null);
    try {
      await api.ticketPost("/v1/accounts", { username: username.trim(), password }, ticket);
      // El ticket ya está consumido: guardarlo solo serviría para que la app
      // volviera a aterrizar en una espera que ya terminó.
      updateSession({ ticket: undefined });
      onCreated();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]";

  return (
    <>
      <div className="flex items-center gap-2.5 py-[7px] text-xs text-muted">
        <Icon name="check" /> Acceso aprobado
      </div>
      <div className="flex items-center gap-2.5 py-[7px] text-xs text-muted">
        <Icon name="clock" /> Tienes <b className="font-normal text-fg">48 h</b> para crear la cuenta
      </div>
      <div className="my-3 h-px bg-border" />
      <div className="grid grid-cols-2 gap-3.5">
        <div>
          <label className="mb-[7px] block text-[11px] text-muted">Usuario</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} className={field} />
        </div>
        <div>
          <label className="mb-[7px] block text-[11px] text-muted">Contraseña</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        </div>
      </div>
      <p className="mt-3 max-w-[54ch] text-[11px] text-muted">
        Mínimo 12 caracteres. Nadie podrá leerla, ni siquiera un administrador: solo pedirte
        que la cambies.
      </p>

      {error && (
        <div className="mt-3.5 flex items-start gap-2.5 text-xs">
          <Icon name="alert" className="mt-0.5 text-danger-fg" />
          <span className="text-muted">{error}</span>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button onClick={create} disabled={busy || password.length < 12 || !username.trim()}
          className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          {busy ? "Creando" : "Crear cuenta"}
        </button>
      </div>
    </>
  );
}
