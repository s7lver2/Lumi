import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { api, type LoginRes } from "../lib/api";
import { useServer } from "../lib/store";
import { updateSession } from "../lib/session";

/** Se muestra al reabrir la app cuando el servidor ya conoce el equipo
 *  (dirección y huella persistidas, reconectado sin problema) pero la
 *  sesión de administrador venció (12 h) o nunca llegó a guardarse. No es
 *  la creación del admin (ya existe): solo pide credenciales otra vez. */
export function ReloginStep({ onDone }: { onDone: () => void }) {
  const [username, setUser] = useState("");
  const [password, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setToken = useServer((s) => s.setToken);

  async function submit() {
    setError(null);
    try {
      const res = await api.post<LoginRes>("/v1/auth/login", { username, password });
      setToken(res.token);
      updateSession({ token: res.token });
      await invoke("start_telemetry", { token: res.token });
      onDone();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    // Composición completa como StatusOverlay: sustituye al wizard en su
    // mismo hueco, no es un paso numerado del stepper.
    <div className="relative z-10 mx-auto w-full max-w-xl px-6 py-9" style={{ animation: "jg-fade-rise .6s both" }}>
      <div className="mb-1 flex items-center gap-2.5">
        <span className="text-fg" style={{ animation: "jg-lock-breathe 2.4s ease-in-out infinite" }}>✦</span>
        <span className="text-[17px] font-medium text-fg">Sesión vencida</span>
      </div>
      <p className="mb-6 text-xs text-muted">Vuelve a entrar para continuar donde estabas.</p>

      <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl">
        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label className="mb-[7px] block text-[11px] text-muted">Usuario</label>
            <input value={username} onChange={(e) => setUser(e.target.value)}
              className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
          </div>
          <div>
            <label className="mb-[7px] block text-[11px] text-muted">Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
          </div>
        </div>
        {error && <p className="mt-3 text-[11px] text-danger-fg">{error}</p>}
      </div>

      <div className="mt-4 flex justify-end">
        <button onClick={submit}
          className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px">
          Entrar
        </button>
      </div>
    </div>
  );
}
