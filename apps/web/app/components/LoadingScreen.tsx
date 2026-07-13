// apps/web/app/components/LoadingScreen.tsx
"use client";
import { useEffect, useState } from "react";
import { PlanetBackground } from "./PlanetBackground";

type ServiceStatus = "ready" | "loading" | "crashed";
interface HealthResponse { web: ServiceStatus; worker: ServiceStatus; inference: ServiceStatus }

const SERVICES: { key: keyof HealthResponse; label: string; icon: JSX.Element }[] = [
  {
    key: "web", label: "Web",
    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8.5h18"/><circle cx="6" cy="6.25" r=".4" fill="currentColor" stroke="none"/></svg>,
  },
  {
    key: "worker", label: "Worker",
    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 8 4.5-8 4.5-8-4.5Z"/><path d="m4 12 8 4.5 8-4.5"/><path d="m4 16.5 8 4.5 8-4.5"/></svg>,
  },
  {
    key: "inference", label: "Inferencia",
    icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v5.5"/><path d="m19.8 8-4.8 2.7"/><path d="m19.8 16-4.8-2.7"/><path d="M12 21v-5.5"/><path d="m4.2 16 4.8-2.7"/><path d="m4.2 8 4.8 2.7"/></svg>,
  },
];

function PreflightChip({ label, icon, status }: { label: string; icon: JSX.Element; status: ServiceStatus }) {
  const ringClass = status === "ready" ? "ready" : status === "crashed" ? "failed" : "pending";
  return (
    <div className="flex w-24 flex-col items-center gap-2">
      <div className={`relative flex h-[42px] w-[42px] items-center justify-center rounded-full ${
        ringClass === "pending" ? "animate-pulse border border-dashed border-white/25" :
        ringClass === "ready" ? "border border-[rgba(127,214,143,0.45)] bg-[rgba(127,214,143,0.07)]" :
        "border border-[rgba(239,159,39,0.5)] bg-[rgba(239,159,39,0.08)]"
      }`}>
        <span className={ringClass === "ready" ? "text-[#cdeed3]" : ringClass === "failed" ? "text-warning-fg" : "text-subtle"}>{icon}</span>
        {status !== "loading" && (
          <span className={`absolute -bottom-[3px] -right-[3px] h-4 w-4 rounded-full border-2 border-bg ${status === "ready" ? "bg-[#7fd68f]" : "bg-warning-fg"}`} />
        )}
      </div>
      <span className="text-[11.5px] font-medium text-fg">{label}</span>
      <span className="text-[10.5px] text-subtle">
        {status === "ready" ? "listo" : status === "crashed" ? "detenido" : "cargando…"}
      </span>
    </div>
  );
}

function LoadingScene({ health }: { health: HealthResponse }) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden">
      <PlanetBackground satellite />
      <div className="relative text-center">
        <div className="text-5xl font-medium tracking-[6px] text-fg">Lumi</div>
        <p className="mt-2 text-sm text-muted">Preparando tu espacio de trabajo…</p>
        <div className="relative mx-auto mt-5 h-[3px] w-56 overflow-hidden rounded-full bg-white/10">
          <div className="lumi-anim absolute left-0 top-0 h-full w-2/5 rounded-full"
            style={{ background: "linear-gradient(90deg,transparent,#f4f6f9,transparent)", animation: "lumi-shimmer 1.6s ease-in-out infinite" }} />
        </div>
        <div className="mt-7 flex items-start justify-center gap-1">
          {SERVICES.map((s) => <PreflightChip key={s.key} label={s.label} icon={s.icon} status={health[s.key]} />)}
        </div>
      </div>
    </div>
  );
}

function CrashScene({ health }: { health: HealthResponse }) {
  const crashedService = SERVICES.find((s) => health[s.key] === "crashed");
  const [logLines, setLogLines] = useState<string[]>([]);

  useEffect(() => {
    if (!crashedService || crashedService.key === "web") return;
    fetch(`/api/health/logs?service=${crashedService.key}`)
      .then((r) => r.json())
      .then((data) => setLogLines(data.lines ?? []))
      .catch(() => {});
  }, [crashedService]);

  const serviceLabel = crashedService?.label ?? "un servicio";

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden px-6 text-center">
      <PlanetBackground dead />
      <svg className="mb-2 text-warning-fg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9.3" y="9.3" width="5.4" height="5.4" rx="1.1" />
        <path d="M9.3 10.6 4.5 8.2" /><path d="M9.3 13.4 4.5 15.8" />
        <path d="M14.7 10.6 19.5 8.2" strokeDasharray="1 2.6" /><path d="M14.7 13.4 19.5 15.8" />
      </svg>
      <div className="text-[21px] font-semibold text-fg">El servicio de {serviceLabel.toLowerCase()} dejó de responder</div>
      <p className="mt-1.5 max-w-[50ch] text-[13.5px] text-muted">
        Lumi no puede continuar sin él. Esto es lo último que escribió antes de detenerse:
      </p>

      <div className="mt-5 flex items-start justify-center gap-1">
        {SERVICES.map((s) => <PreflightChip key={s.key} label={s.label} icon={s.icon} status={health[s.key]} />)}
      </div>

      {crashedService && crashedService.key !== "web" && (
        <div className="mt-5 w-[min(560px,88vw)] overflow-hidden rounded-xl border border-[rgba(239,159,39,0.3)] bg-elevated/90 text-left shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
            <span className="text-xs font-medium text-fg">data/logs/{crashedService.key}.log</span>
            <span className="rounded-full bg-[rgba(239,159,39,0.15)] px-2.5 py-0.5 text-[10.5px] font-medium text-warning-fg">proceso detenido</span>
          </div>
          <pre className="max-h-[190px] overflow-y-auto whitespace-pre-wrap break-words p-3.5 font-mono text-[11px] leading-relaxed text-muted">
            {logLines.length > 0 ? logLines.join("\n") : "(sin líneas de log todavía)"}
          </pre>
        </div>
      )}

      <div className="mt-4 flex gap-2.5">
        <button onClick={() => window.location.reload()} className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-black">Reintentar</button>
        <a href="/settings" className="flex items-center rounded-lg border border-white/15 px-4 py-2 text-xs text-fg hover:bg-white/10">Ver ajustes</a>
      </div>
    </div>
  );
}

export function BootGate({ children }: { children: React.ReactNode }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/health");
        const data: HealthResponse = await res.json();
        if (!cancelled) setHealth(data);
      } catch {
        // Network hiccup polling /api/health itself — keep the previous
        // state (or null/loading) rather than flashing a crash screen.
      }
    }
    poll();
    const interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (!health || health.worker !== "ready" || health.inference !== "ready") {
    const anyCrashed = health && (health.worker === "crashed" || health.inference === "crashed");
    return anyCrashed ? <CrashScene health={health} /> : <LoadingScene health={health ?? { web: "ready", worker: "loading", inference: "loading" }} />;
  }
  return <>{children}</>;
}
