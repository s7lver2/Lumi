import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api, type TaskStatus } from "../lib/api";
import { useServer } from "../lib/store";
import { loadSession, updateSession } from "../lib/session";
import { Icon } from "../ui/Icon";

export function ProvisionStep({ onDone }: { onDone: () => void }) {
  const token = useServer((s) => s.token);
  const [log, setLog] = useState("");
  const [running, setRunning] = useState(false);
  const box = useRef<HTMLPreElement>(null);

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
    (async () => {
      try {
        const status = await api.get<TaskStatus>(`/v1/tasks/${id}`, token);
        setRunning(status.running);
        await invoke("start_task_log", { id, from: 0, token });
      } catch {
        // La tarea ya no existe (base de datos borrada, reinstalación) o el
        // token venció: se descarta el id persistido y se deja el botón.
        updateSession({ taskId: undefined });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    const t = await api.post<{ id: string }>("/v1/tasks", { kind: "inference_runtime" }, token!);
    updateSession({ taskId: t.id });
    setRunning(true);
    await invoke("start_task_log", { id: t.id, from: 0, token });
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-fg">torch 2.5.1 + cu126</span>
        <span className="font-mono text-[11px] text-muted">{running ? "en curso" : "sin iniciar"}</span>
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
            Instalar runtime
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
