// apps/web/app/setup/steps/InstallStep.tsx
"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { InstallItem } from "./InstallItem";
import { fetchJson } from "../../lib/fetch-json";
import { fadeRise } from "../../lib/motion";

const ITEMS_BY_RUNTIME = {
  windows: [
    { id: "inference-venv", label: "Entorno Python", engine: "venv" },
    { id: "inference-deps", label: "Dependencias PyTorch + CUDA", engine: "pip install" },
  ],
  // Native Linux (e.g. Pop!_OS) — same steps/ids as "windows", the server
  // resolves venv/bin vs venv/Scripts per host (see run/[step]/route.ts).
  linux: [
    { id: "inference-venv", label: "Entorno Python", engine: "venv" },
    { id: "inference-deps", label: "Dependencias PyTorch + CUDA", engine: "pip install" },
  ],
  wsl: [
    { id: "inference-wsl-prereqs", label: "Dependencias del sistema (WSL2)", engine: "apt install" },
    { id: "inference-venv-wsl", label: "Entorno Python (WSL2)", engine: "venv" },
    { id: "inference-deps-wsl", label: "Dependencias PyTorch + CUDA (WSL2)", engine: "pip install" },
  ],
} as const;

type Runtime = keyof typeof ITEMS_BY_RUNTIME;
interface Check { id: string; label: string; ok: boolean; detail: string }

export function InstallStep({
  onComplete,
  runtime = "windows",
  onRuntimeChange,
}: {
  onComplete: () => void;
  runtime?: Runtime;
  onRuntimeChange?: (runtime: Runtime) => void;
}) {
  const [started, setStarted] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [platform, setPlatform] = useState<"windows" | "linux" | null>(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const items = ITEMS_BY_RUNTIME[runtime];

  async function loadChecks() {
    const { data } = await fetchJson<{ checks: Check[]; platform: "windows" | "linux" }>("/api/setup/prereqs");
    setChecks(data?.checks ?? []);
    if (data?.platform) setPlatform(data.platform);
  }
  // Cargados al montar (no solo al pulsar Install) para que el interruptor
  // WSL2 de la pantalla inicial ya sepa si está disponible antes de elegir.
  useEffect(() => { loadChecks(); }, []);
  // En Linux nativo no hay elección Windows/WSL2 que ofrecer — solo existe
  // el runtime "linux" (ver ITEMS_BY_RUNTIME). Se fija en cuanto se conoce
  // la plataforma real del host, sobreescribiendo el "windows" por defecto.
  useEffect(() => {
    if (platform === "linux" && runtime !== "linux") onRuntimeChange?.("linux");
  }, [platform, runtime, onRuntimeChange]);

  async function start() {
    setStarted(true);
    await loadChecks();
    setActiveIdx(0);
  }
  function onDone(ok: boolean) {
    if (!ok) return;
    setActiveIdx((x) => {
      const next = x + 1;
      if (next >= items.length) onComplete();
      return next;
    });
  }
  const postgresOk = checks?.find((c) => c.id === "postgres")?.ok ?? false;
  const wslCheck = checks?.find((c) => c.id === "wsl");
  const visibleChecks = checks?.filter((c) => c.id !== "wsl") ?? [];

  if (!started) {
    return (
      <motion.div variants={fadeRise} initial="hidden" animate="show" className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[.06]">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#e9ecf1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" /></svg>
        </div>
        <div className="text-base font-medium text-fg">Instalar dependencias locales</div>
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted">Verificaremos PostgreSQL y prepararemos el entorno de inferencia (Python + PyTorch/CUDA).</p>

        {platform === "linux" ? (
          // Ya estás en Linux nativo — no hay nada que ofrecer entre
          // "Windows" y "WSL2" (ambos son formas de llegar a Linux desde
          // Windows). Solo se informa qué runtime se va a usar.
          <div className="mt-4 w-full max-w-sm rounded-card border border-white/10 bg-white/[.03] p-3 text-left">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-fg">Entorno de inferencia</span>
              <span className="text-[10px] text-fg">Linux (nativo)</span>
            </div>
          </div>
        ) : (
          /* Interruptor opcional: WSL2 evita el fallback lento de romatch en
             Windows (verificación RoMa/Laila mucho más lenta fuera de Linux).
             No instala WSL2 — solo cambia dónde se instalan las dependencias. */
          <div className="mt-4 w-full max-w-sm rounded-card border border-white/10 bg-white/[.03] p-3 text-left">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-fg">Entorno de inferencia</span>
              {wslCheck && (
                <span className={`text-[10px] ${wslCheck.ok ? "text-fg" : "text-subtle"}`}>
                  WSL2 {wslCheck.ok ? "detectado" : "no detectado"}
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => onRuntimeChange?.("windows")}
                className={`flex-1 rounded-md px-2.5 py-1.5 text-[11px] ${runtime === "windows" ? "bg-accent text-black" : "border border-white/10 text-fg hover:bg-white/10"}`}
              >
                Windows (nativo)
              </button>
              <button
                onClick={() => wslCheck?.ok && onRuntimeChange?.("wsl")}
                disabled={!wslCheck?.ok}
                title={wslCheck?.ok ? undefined : wslCheck?.detail}
                className={`flex-1 rounded-md px-2.5 py-1.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-40 ${runtime === "wsl" ? "bg-accent text-black" : "border border-white/10 text-fg hover:bg-white/10"}`}
              >
                WSL2 (más rápido)
              </button>
            </div>
            {runtime === "wsl" && (
              <p className="mt-2 text-[11px] text-subtle">La verificación (Laila/RoMa) corre notablemente más rápido en Linux — romatch desactiva su kernel optimizado en Windows.</p>
            )}
          </div>
        )}

        <button onClick={start} className="mt-4 rounded-[10px] bg-accent px-7 py-2.5 text-sm font-medium text-black hover:brightness-105">Install</button>
      </motion.div>
    );
  }

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-fg">Instalando{runtime === "wsl" ? " (WSL2)" : runtime === "linux" ? " (Linux)" : ""}…</span>
        <span className="text-xs text-muted">{Math.max(activeIdx, 0)} / {items.length} completado</span>
      </div>
      {checks && (
        <div className="mb-3 flex items-center gap-3 rounded-card border border-white/10 bg-white/[.045] px-3 py-2.5">
          <span className="text-xs text-fg/80">Prerequisitos</span>
          <div className="ml-auto flex items-center gap-3">
            {visibleChecks.map((c) => (
              <span key={c.id} className={`flex items-center gap-1 text-[11px] ${c.ok ? "text-fg" : "text-danger-fg"}`}>{c.ok ? "✓" : "✕"} {c.label}</span>
            ))}
          </div>
        </div>
      )}
      {!postgresOk ? (
        <div className="rounded-card border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger-fg">
          PostgreSQL no responde. Arráncalo y reintenta.
          <button onClick={start} className="ml-2 rounded-md border border-white/10 px-2 py-1 text-fg hover:bg-white/10">Reintentar</button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it, i) => (
            <InstallItem key={it.id} stepId={it.id} label={it.label} engine={it.engine} active={i === activeIdx} onDone={onDone} />
          ))}
        </div>
      )}
    </motion.div>
  );
}
