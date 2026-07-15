// apps/web/app/components/LowVramModeRow.tsx
"use client";
import { useEffect, useState } from "react";
import { Menu } from "./Menu";

const OPTIONS = [
  { value: "auto", label: "auto" },
  { value: "on", label: "on" },
  { value: "off", label: "off" },
];

export function LowVramModeRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [runningLowVram, setRunningLowVram] = useState<boolean | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartLog, setRestartLog] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/model-status")
      .then((r) => r.json())
      .then((d: { lowVramMode: boolean }) => setRunningLowVram(d.lowVramMode))
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
    setRestarting(true);
    setRestartLog([]);
    const res = await fetch("/api/setup/run/restart-inference", { method: "POST" });
    const reader = res.body?.getReader();
    if (!reader) {
      setRestarting(false);
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
      <Menu value={value} onChange={onChange} options={OPTIONS} />
      {restartPending && !restarting && (
        <div className="mt-2 rounded-md border border-[rgba(239,159,39,0.4)] bg-[rgba(239,159,39,0.08)] px-3 py-2 text-[11.5px] text-warning-fg">
          Este cambio requiere reiniciar el servicio de inferencia para aplicarse.
          <button onClick={restart} className="ml-2 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-black">
            Reiniciar ahora
          </button>
        </div>
      )}
      {restarting && (
        <div className="mt-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-muted">
          {restartLog[restartLog.length - 1] ?? "Reiniciando…"}
        </div>
      )}
    </div>
  );
}
