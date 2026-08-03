import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api, type TaskStatus } from "../lib/api";
import { useServer } from "../lib/store";
import { loadSession, updateSession } from "../lib/session";
import { Icon } from "../ui/Icon";

export function ProvisionStep({ onDone, onStatusChange }: {
  onDone: () => void; onStatusChange?: (done: boolean) => void;
}) {
  const token = useServer((s) => s.token);
  const [log, setLog] = useState("");
  const [running, setRunning] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const box = useRef<HTMLPreElement>(null);
  const done = !running && exitCode === 0;
  // "Siguiente" en el wizard depende de esto: no debe poder avanzar mientras
  // no haya un "instalado" confirmado por el servidor.
  useEffect(() => { onStatusChange?.(done); }, [done, onStatusChange]);

  useEffect(() => {
    const un = listen<string>("task-log", (e) => setLog((l) => l + e.payload));
    return () => { un.then((f) => f()); };
  }, []);

  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [log]);

  // Si al reabrir la app ya había una tarea en marcha (persistida en la
  // tarea de vinculación), reengancharse solo en vez de mostrar "sin
  // iniciar" y obligar a pulsar el botón otra vez. El log se reproduce
  // desde el principio: SSE de tareas es barato, no como el de telemetría.
  useEffect(() => {
    const id = loadSession()?.taskId;
    if (!id || !token) return;
    setTaskId(id);
    (async () => {
      try {
        const status = await api.get<TaskStatus>(`/v1/tasks/${id}`, token);
        setRunning(status.running);
        setExitCode(status.exit_code);
        await invoke("start_task_log", { id, from: 0, token });
      } catch {
        // La tarea ya no existe (base de datos borrada, reinstalación) o el
        // token venció: se descarta el id persistido y se deja el botón.
        updateSession({ taskId: undefined });
        setTaskId(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El SSE del log no tiene condición de corte al terminar la tarea: sigue
  // abierto indefinidamente aunque el proceso ya haya salido. Sin esto, la
  // interfaz se quedaba en "Instalando" para siempre aunque el log ya
  // mostrara un FATAL. Se sondea el estado real hasta que deje de correr.
  useEffect(() => {
    if (!running || !taskId || !token) return;
    const t = setInterval(async () => {
      try {
        const s = await api.get<TaskStatus>(`/v1/tasks/${taskId}`, token);
        if (!s.running) {
          setRunning(false);
          setExitCode(s.exit_code);
          clearInterval(t);
        }
      } catch {
        // fallo de red puntual: se reintenta en el siguiente tick, no se
        // apaga el spinner por un solo golpe fallido.
      }
    }, 1500);
    return () => clearInterval(t);
  }, [running, taskId, token]);

  async function start() {
    setExitCode(null);
    setLog("");
    const t = await api.post<{ id: string }>("/v1/tasks", { kind: "inference_runtime" }, token!);
    updateSession({ taskId: t.id });
    setTaskId(t.id);
    setRunning(true);
    await invoke("start_task_log", { id: t.id, from: 0, token });
  }

  const failed = !running && exitCode !== null && exitCode !== 0;

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-fg">torch 2.5.1 + cu126</span>
        <span className={`font-mono text-[11px] ${failed ? "text-danger-fg" : done ? "text-fg" : "text-muted"}`}>
          {running ? "en curso" : failed ? `error · código ${exitCode}` : done ? "instalado" : "sin iniciar"}
        </span>
      </div>
      <pre ref={box}
        className="max-h-[132px] overflow-auto whitespace-pre rounded-lg border border-border bg-[#08090b] px-3.5 py-3 font-mono text-[11px] leading-[1.7] text-muted">
        {log || "esperando a lanzar la tarea"}
      </pre>
      <p className="mt-3 max-w-[52ch] text-[11px] text-muted">
        Corre en el servidor. Puedes cerrar la app: al volver te reenganchas a este mismo log.
      </p>
      <div className="mt-4 flex gap-2">
        {!running && (
          <button onClick={start} className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-black">
            {failed ? "Reintentar" : done ? "Reinstalar runtime" : "Instalar runtime"}
          </button>
        )}
        {running && (
          <span className="flex items-center gap-2 text-xs text-muted"><Icon name="spinner" /> Instalando</span>
        )}
      </div>
      <button hidden onClick={onDone} />
    </>
  );
}
