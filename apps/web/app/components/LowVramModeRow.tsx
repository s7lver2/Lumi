// apps/web/app/components/LowVramModeRow.tsx
"use client";
import { useEffect, useState } from "react";
import { Menu } from "./Menu";

const OPTIONS = [
  { value: "auto", label: "auto" },
  { value: "on", label: "on" },
  { value: "off", label: "off" },
];

export function LowVramModeRow({
  value,
  onChange,
  onSaveBeforeRestart,
}: {
  value: string;
  onChange: (v: string) => void;
  // Must persist `value` to system_settings and resolve `true` only once that
  // write is durably confirmed. restart() awaits this before ever calling the
  // restart-inference endpoint, so the service is never restarted (and the
  // page never navigated away) while the displayed value is still unsaved.
  onSaveBeforeRestart: (value: string) => Promise<boolean>;
}) {
  const [runningLowVram, setRunningLowVram] = useState<boolean | null>(null);
  const [gpuNote, setGpuNote] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "saving" | "restarting">("idle");
  const [restartLog, setRestartLog] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/model-status")
      .then((r) => r.json())
      .then((d: { lowVramMode: boolean; gpuNote: string }) => {
        setRunningLowVram(d.lowVramMode);
        setGpuNote(d.gpuNote);
      })
      .catch(() => {});
  }, []);

  // The setting is "on"/"off" or "auto" (resolved against hardware at
  // startup) — comparing the SAVED setting's on/off intent against what's
  // actually running only makes unambiguous sense for explicit on/off;
  // "auto" always shows the banner as a nudge to restart after any change,
  // since we can't know here whether "auto" would still resolve the same
  // way without asking the running service (which is exactly what a
  // restart does).
  const restartPending =
    runningLowVram !== null &&
    ((value === "on" && !runningLowVram) || (value === "off" && runningLowVram));

  async function restart() {
    setSaveError(null);
    setPhase("saving");
    let saved = false;
    try {
      saved = await onSaveBeforeRestart(value);
    } catch {
      saved = false;
    }
    if (!saved) {
      setPhase("idle");
      setSaveError("No se pudo guardar el cambio. Inténtalo de nuevo antes de reiniciar.");
      return;
    }

    setPhase("restarting");
    setRestartLog([]);
    const res = await fetch("/api/setup/run/restart-inference", { method: "POST" });
    const reader = res.body?.getReader();
    if (!reader) {
      setPhase("idle");
      window.location.href = "/";
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const raw of events) {
        if (!raw.startsWith("data: ")) continue;
        const event = JSON.parse(raw.slice("data: ".length));
        if (event.type === "log") setRestartLog((lines) => [...lines, event.line]);
        if (event.type === "done") window.location.href = "/";
      }
    }
  }

  return (
    <div>
      {gpuNote && <div className="mb-1 text-xs text-muted">{gpuNote}</div>}
      <Menu value={value} onChange={onChange} options={OPTIONS} />
      {restartPending && phase === "idle" && (
        <div className="mt-2 rounded-md border border-[rgba(239,159,39,0.4)] bg-[rgba(239,159,39,0.08)] px-3 py-2 text-[11.5px] text-warning-fg">
          Este cambio requiere reiniciar el servicio de inferencia para aplicarse.
          <button onClick={restart} className="ml-2 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-black">
            Reiniciar ahora
          </button>
        </div>
      )}
      {phase === "saving" && (
        <div className="mt-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-muted">
          Guardando…
        </div>
      )}
      {phase === "restarting" && (
        <div className="mt-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-muted">
          {restartLog[restartLog.length - 1] ?? "Reiniciando…"}
        </div>
      )}
      {saveError && (
        <div className="mt-2 rounded-md border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[11.5px] text-danger-fg">
          {saveError}
        </div>
      )}
    </div>
  );
}
