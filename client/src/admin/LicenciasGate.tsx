import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api, type MetaPeso, type TaskStatus } from "../lib/api";

/** La última línea `@progreso {...}` del log, si hay alguna — el mismo
 *  prefijo que ya lee el servidor en `GET /v1/admin/model-task`, leído aquí
 *  también porque el log SSE ya está en el cliente y no hace falta otra
 *  petición para lo mismo. */
function ultimoProgreso(log: string): { item: string; pct: number } | null {
  const linea = log.split("\n").reverse().find((l) => l.startsWith("@progreso "));
  if (!linea) return null;
  try {
    const v = JSON.parse(linea.slice("@progreso ".length));
    return { item: v.item, pct: v.pct };
  } catch {
    return null;
  }
}

function DescargaProgreso({ token, taskId, onCerrar }: {
  token: string; taskId: string; onCerrar: () => void;
}) {
  const [log, setLog] = useState("");
  const [running, setRunning] = useState(true);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const box = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const un = listen<string>("task-log", (e) => setLog((l) => l + e.payload));
    void invoke("start_task_log", { id: taskId, from: 0, token });
    return () => { un.then((f) => f()); };
  }, [taskId, token]);

  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [log]);

  useEffect(() => {
    const i = setInterval(async () => {
      try {
        const s = await api.get<TaskStatus>(`/v1/tasks/${taskId}`, token);
        setRunning(s.running);
        setExitCode(s.exit_code);
        if (!s.running) clearInterval(i);
      } catch { /* red caída un instante: se reintenta en el próximo tick */ }
    }, 1200);
    return () => clearInterval(i);
  }, [taskId, token]);

  const progreso = ultimoProgreso(log);
  const fallo = !running && exitCode !== null && exitCode !== 0;

  // Las líneas @progreso/@sha256 son para la máquina (la barra de arriba, y
  // el registro re-escrito en el servidor) — mostrarlas también en el log
  // sería ruido de protocolo delante de quien solo quiere ver qué está pasando.
  const lineasVisibles = log.split("\n").filter((l) => l && !l.startsWith("@"));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="text-fg">
          {running ? (progreso?.item ? `Descargando ${progreso.item}` : "Descargando…")
            : fallo ? "La descarga falló" : "Instalado"}
        </span>
        {progreso && <span className="font-mono text-subtle">{progreso.pct}%</span>}
      </div>
      <div className="h-[3px] overflow-hidden rounded-sm bg-elevated">
        <div className="h-full bg-fg transition-[width] duration-500 ease-expo"
          style={{ width: `${progreso?.pct ?? (running ? 0 : 100)}%` }} />
      </div>
      <pre ref={box}
        className="mt-3 max-h-[190px] overflow-auto whitespace-pre-wrap rounded-lg border border-border
          bg-[#08090b] px-3 py-2.5 font-mono text-[10.5px] leading-[1.7] text-muted">
        {lineasVisibles.join("\n") || "esperando al servidor…"}
      </pre>
      {fallo && (
        <p className="mt-2 text-[11px] text-danger-fg">
          código de salida {exitCode} — revisa el log de arriba.
        </p>
      )}
      {!running && (
        <div className="mt-3 flex justify-end">
          <button onClick={onCerrar}
            className="rounded-lg border border-white/15 px-3.5 py-2 text-[11.5px] text-fg">
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}

export function LicenciasGate({ token, items, onListo }: {
  token: string; items: MetaPeso[]; onListo: () => void;
}) {
  // Agrupado por texto: la misma licencia que cubre dos pesos se lee y se
  // acepta una vez, no dos.
  const grupos = useMemo(() => {
    const m = new Map<string, { texto: string; para: MetaPeso[] }>();
    for (const it of items) {
      if (it.puerta) continue; // la puerta no se acepta aquí, es el bloque de abajo
      const g = m.get(it.licencia) ?? { texto: it.licencia_texto, para: [] };
      g.para.push(it);
      m.set(it.licencia, g);
    }
    return [...m.entries()].map(([licencia, v]) => ({ licencia, ...v }));
  }, [items]);

  const puertas = items.filter((it) => it.puerta);
  const [sel, setSel] = useState(grupos[0]?.licencia ?? null);
  const [aceptando, setAceptando] = useState(false);
  const [tokenProveedor, setTokenProveedor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tareaId, setTareaId] = useState<string | null>(null);

  async function aceptarYDescargar() {
    setAceptando(true);
    setError(null);
    try {
      const licencias: Record<string, string[]> = {};
      grupos.forEach((g) => { licencias[g.licencia] = g.para.map((p) => p.id); });
      await api.post("/v1/admin/models/accept-licenses", { licencias }, token);
      const t = await api.post<TaskStatus>("/v1/admin/models/download", { items: grupos.flatMap((g) => g.para.map((p) => p.id)) }, token);
      setTareaId(t.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setAceptando(false);
    }
  }

  async function guardarTokenYDescargar(item: MetaPeso) {
    setError(null);
    try {
      if (tokenProveedor) {
        await api.patch("/v1/admin/models/provider-token", { token: tokenProveedor }, token);
      }
      const t = await api.post<TaskStatus>("/v1/admin/models/download", { items: [item.id] }, token);
      setTareaId(t.id);
    } catch (e) {
      setError(String(e));
    }
  }

  if (tareaId) {
    return <DescargaProgreso token={token} taskId={tareaId} onCerrar={onListo} />;
  }

  return (
    <div>
      {error && <p className="mb-3 text-[11px] text-danger-fg">{error}</p>}

      {grupos.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-[9px]">
            {grupos.map((g) => (
              <button key={g.licencia} onClick={() => setSel(g.licencia)}
                className={`rounded-[10px] border p-[11px_12px] text-left transition-colors duration-300 ease-expo
                  ${sel === g.licencia ? "border-white/[.34] bg-elevated" : "border-border bg-panel hover:border-white/[.22]"}`}>
                <h4 className="flex items-center gap-[7px] text-[11.5px] font-medium">
                  <span className={`h-[5px] w-[5px] shrink-0 rounded-full border border-subtle
                    ${sel === g.licencia ? "border-fg bg-fg" : ""}`} />
                  {g.licencia}
                </h4>
                <span className="mt-1 block text-[9.5px] text-subtle">
                  {g.para.map((p) => p.nombre).join(" · ")}
                </span>
              </button>
            ))}
          </div>

          {sel && (
            <div className="mt-[9px] rounded-[10px] border border-border bg-panel p-[13px_15px]">
              <h4 className="mb-2 text-[12.5px] font-medium">{sel}</h4>
              <div className="max-h-[150px] overflow-auto font-mono text-[10.5px] leading-[1.75] text-muted">
                {grupos.find((g) => g.licencia === sel)?.texto || "sin texto cacheado — revisa licencia_url"}
              </div>
            </div>
          )}

          <div className="mt-3.5 flex items-center gap-2.5 rounded-[10px] border border-white/[.16] bg-panel p-3">
            <p className="text-[11px] text-muted">
              Acepto los términos de las <b className="text-fg">{grupos.length}</b> licencias en nombre de este servidor.
            </p>
            <button disabled={aceptando} onClick={aceptarYDescargar}
              className="ml-auto rounded-lg bg-accent px-3.5 py-2 text-[11.5px] font-medium text-black disabled:opacity-40">
              {aceptando ? "aceptando…" : "Aceptar y descargar"}
            </button>
          </div>
        </>
      )}

      {puertas.map((p) => (
        <div key={p.id} className="mt-4 rounded-[10px] border border-draw/[.34] bg-draw/[.045] p-[13px_14px]">
          <h4 className="mb-1.5 text-[11.5px] font-medium">{p.nombre} no se puede descargar sin tu intervención</h4>
          <p className="max-w-[78ch] text-[10.5px] leading-[1.7] text-muted">
            Su licencia obliga a aceptarla en el sitio del proveedor y a usar un token propio.
            Lumi no acepta términos en tu nombre.
          </p>
          <div className="mt-[11px] flex items-center gap-2">
            <input type="password" value={tokenProveedor} onChange={(e) => setTokenProveedor(e.target.value)}
              placeholder="token del proveedor · se guarda y se redacta en los logs"
              className="min-w-[220px] flex-1 rounded-lg border border-border bg-elevated px-2.5 py-1.5 font-mono text-[10.5px] text-fg outline-none focus:border-white/40" />
            <button onClick={() => guardarTokenYDescargar(p)}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg">
              Guardar y descargar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
