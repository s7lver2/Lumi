import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { comprobarActualizacion, type EstadoActualizacion } from "../lib/actualizaciones";

/** El mismo log que se ve en la terminal de `cargo tauri dev`, pero dentro de
 *  la aplicación: para no tener que pedir que copien a mano de una consola
 *  que puede tener miles de líneas de TRACE de por medio. Un botón, y lo que
 *  se ve aquí es justo lo que hay que mandar para depurar algo. */
export function DebugPanel({ onRepetirSetup }: { onRepetirSetup: () => void }) {
  const [texto, setTexto] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fondo = useRef<HTMLDivElement>(null);
  const [actEstado, setActEstado] = useState<EstadoActualizacion | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [actComprobando, setActComprobando] = useState(false);

  async function comprobarAhora() {
    setActComprobando(true);
    setActError(null);
    try {
      setActEstado(await comprobarActualizacion());
    } catch (e) {
      setActEstado(null);
      setActError(String(e));
    } finally {
      setActComprobando(false);
    }
  }

  useEffect(() => {
    let vivo = true;
    const tick = () =>
      void api.debugLogLeer().then(
        (t) => { if (vivo) { setTexto(t); setError(null); } },
        (e) => { if (vivo) setError(String(e)); },
      );
    tick();
    const t = setInterval(tick, 1500);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  useEffect(() => { fondo.current?.scrollIntoView({ block: "end" }); }, [texto]);

  async function copiar() {
    await navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  return (
    <div className="flex h-full flex-col p-8">
      <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col">
        <div className="flex items-center">
          <div className="flex-1">
            <p className="text-sm text-fg">Debug</p>
            <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
              El registro completo de esta sesión, tal cual sale por consola. Solo se guardan los
              últimos {(300_000 / 1000).toFixed(0)} KB — de sobra para lo que acaba de pasar.
            </p>
          </div>
          <button
            onClick={() => void copiar()}
            disabled={texto.length === 0}
            className="jg-press shrink-0 rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg disabled:opacity-40"
          >
            {copiado ? "Copiado" : "Copiar"}
          </button>
        </div>

        {error && (
          <p className="mt-2.5 text-[11px] leading-relaxed text-danger-fg">
            No se pudo leer el fichero de log: {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5">
          <div>
            <p className="text-[11.5px] text-fg">Actualizaciones</p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
              {actEstado?.tipo === "disponible" && `Versión ${actEstado.version} disponible — ${actEstado.notas}`}
              {actEstado?.tipo === "retirada" && "Tu versión fue retirada. Actualiza en cuanto puedas."}
              {!actEstado && !actError && "Sin comprobar en esta sesión."}
              {actError && `No se pudo comprobar: ${actError}`}
            </p>
          </div>
          <button
            onClick={() => void comprobarAhora()}
            disabled={actComprobando}
            className="jg-press shrink-0 rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg disabled:opacity-40"
          >
            {actComprobando ? "Comprobando…" : "Comprobar ahora"}
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5">
          <div>
            <p className="text-[11.5px] text-fg">Asistente inicial</p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
              Solo se enseña la primera vez. Repetirlo no desinstala ni reconfigura nada — es para
              revisarlo después de, por ejemplo, instalar Redis o Qdrant en WSL.
            </p>
          </div>
          <button
            onClick={onRepetirSetup}
            className="jg-press shrink-0 rounded-lg border border-border px-3.5 py-2 text-[11.5px] text-fg"
          >
            Repetir
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-[#0b0d0f] px-3 py-2.5">
          {texto.length === 0 && !error && (
            <p className="font-mono text-[10px] text-subtle">sin salida todavía</p>
          )}
          <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-[1.85] text-muted">
            {texto}
          </pre>
          <div ref={fondo} />
        </div>
      </div>
    </div>
  );
}
