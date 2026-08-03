import { useState } from "react";
import { api } from "../lib/api";
import { updateSession, type Server } from "../lib/session";
import { Icon } from "../ui/Icon";

const MAX_NAME = 80;
const MAX_MESSAGE = 500;

export function RequestForm({ server, onSent, onBack }: {
  server: Server | null; onSent: () => void; onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!server || !name.trim()) return;
    setBusy(true); setError(null);
    try {
      await api.reconnect(server.addr, server.fingerprint);
      const res = await api.post<{ ticket: string }>("/v1/access-requests", {
        display_name: name.trim(), message: message.trim(),
      });
      // El ticket es lo único que prueba que esta solicitud es tuya, y solo se
      // entrega una vez: se persiste antes de cambiar de pantalla.
      updateSession({ addr: server.addr, fingerprint: server.fingerprint, ticket: res.ticket });
      onSent();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]";

  return (
    <>
      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Tu nombre</label>
      <input value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} className={field} />
      <div className="h-3.5" />
      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Mensaje para el administrador</label>
      <textarea value={message} maxLength={MAX_MESSAGE} rows={4}
        onChange={(e) => setMessage(e.target.value)} className={`${field} resize-none`} />
      <p className="mt-2.5 text-[11px] text-muted">
        Aún no tienes cuenta: eso viene después de que te aprueben.
      </p>

      {error && (
        <div className="mt-3.5 flex items-start gap-2.5 text-xs">
          <Icon name="alert" className="mt-0.5 text-danger-fg" />
          <span className="text-muted">{error}</span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <button onClick={onBack} className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg active:translate-y-px">
          Atrás
        </button>
        <button onClick={send} disabled={busy || !name.trim()}
          className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          {busy ? "Enviando" : "Enviar solicitud"}
        </button>
      </div>
    </>
  );
}
