import { useState } from "react";
import { api } from "../lib/api";

export function AdminStep({ bootstrapToken, onDone }: { bootstrapToken: string; onDone: () => void }) {
  const [username, setUser] = useState("");
  const [password, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await api.post("/v1/admin", { bootstrap_token: bootstrapToken, username, password });
      onDone();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3.5">
        <div>
          <label className="mb-[7px] block text-[11px] text-muted">Usuario</label>
          <input value={username} onChange={(e) => setUser(e.target.value)}
            className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
        </div>
        <div>
          <label className="mb-[7px] block text-[11px] text-muted">Contraseña</label>
          <input type="password" value={password} onChange={(e) => setPass(e.target.value)}
            className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
        </div>
      </div>
      <p className="mt-3 max-w-[52ch] text-[11px] text-muted">
        Se almacena con Argon2id. Ni el servidor ni otro administrador podrán leerla: solo
        solicitar que la cambies.
      </p>
      {error && <p className="mt-3 text-[11px] text-danger-fg">{error}</p>}
      <button hidden onClick={submit} id="admin-submit" />
    </>
  );
}
