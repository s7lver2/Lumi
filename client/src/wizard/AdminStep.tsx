import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api, type LoginRes } from "../lib/api";
import { useServer } from "../lib/store";
import { updateSession } from "../lib/session";

export function AdminStep({ bootstrapToken, onDone, onBusyChange }: {
  bootstrapToken: string; onDone: () => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [username, setUser] = useState("");
  const [password, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setToken = useServer((s) => s.setToken);

  async function submit() {
    setError(null);
    if (password.length < 12) {
      setError("La contraseña necesita al menos 12 caracteres.");
      return;
    }
    // Crear admin → login → telemetría es una cadena de tres peticiones: sin
    // avisar de que está "ocupado", el botón de Siguiente parece congelado
    // durante ese rato.
    onBusyChange?.(true);
    try {
      await api.post("/v1/admin", { bootstrap_token: bootstrapToken, username, password });
      // Crear el administrador no deja sesión iniciada: sin este login el
      // token queda nulo y todo lo que exige admin (lanzar tareas, telemetría)
      // responde 401.
      const res = await api.post<LoginRes>("/v1/auth/login", { username, password });
      setToken(res.token);
      // bootstrapToken ya está gastado (/v1/admin lo consume); el token de
      // sesión es lo único que hace falta a partir de ahora para retomar.
      updateSession({ token: res.token, bootstrapToken: undefined });
      await invoke("start_telemetry", { token: res.token });
      onDone();
    } catch (e) {
      setError(String(e));
      onBusyChange?.(false);
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
