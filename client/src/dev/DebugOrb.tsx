import { useState } from "react";
import { api } from "../lib/api";
import { getEnv, resetEnv, setEnv } from "../lib/session";
import { useServer } from "../lib/store";

/** Herramienta de desarrollo: simula "dispositivos" aislados sin borrar
 *  localStorage a mano. Cada entorno tiene su propia sesión, sus propios
 *  servidores recordados y su propio deviceId — se comporta como un
 *  dispositivo que nunca ha abierto la app.
 *
 *  Solo existe en dev: el padre (App.tsx) la renderiza detrás de
 *  `import.meta.env.DEV`, que Vite sustituye por una constante en build de
 *  producción — el bloque entero se elimina del bundle, no es una
 *  comprobación que sobreviva en runtime. */
export function DebugOrb() {
  const [open, setOpen] = useState(false);
  const [cmd, setCmd] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    const [name, arg] = cmd.trim().split(/\s+/);
    if (name === "env" && arg) {
      setEnv(arg);
      window.location.reload();
    } else if (name === "env") {
      setMsg(`entorno activo: ${getEnv()}`);
    } else if (name === "reset") {
      resetEnv();
      window.location.reload();
    } else if (name === "fake" && arg) {
      // Sin motor no hay nada que dibujar, y el mapa y la tarjeta de
      // resultado no se pueden construir a ciegas. Solo en desarrollo: este
      // archivo entero desaparece del bundle de producción.
      const token = useServer.getState().token ?? undefined;
      api
        .patch(`/v1/analyses/${arg}/fake`, {}, token)
        .then(() => setMsg(`análisis ${arg} relleno con coordenadas falsas`))
        .catch((e) => setMsg(String(e)));
    } else if (name === "fake") {
      setMsg("uso: fake <id de análisis>");
    } else if (name) {
      setMsg(`comando desconocido: ${name}`);
    }
    setCmd("");
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 font-mono text-[11px]">
      {open && (
        <div className="mb-2 w-56 rounded-lg border border-border bg-[#0d0f12] p-2.5 shadow-lg shadow-black/50">
          <input autoFocus value={cmd} onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="env 2 · reset · fake 3"
            className="w-full rounded border border-border bg-transparent px-2 py-1 text-fg outline-none focus:border-white/40" />
          {msg && <p className="mt-1.5 text-subtle">{msg}</p>}
          <p className="mt-1.5 text-subtle">entorno actual: {getEnv()}</p>
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-[#0d0f12] text-fg shadow-lg shadow-black/50 transition-transform duration-300 ease-expo hover:scale-110 active:scale-95">
        ●
      </button>
    </div>
  );
}
