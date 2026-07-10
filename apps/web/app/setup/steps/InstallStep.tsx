// apps/web/app/setup/steps/InstallStep.tsx
"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { InstallItem } from "./InstallItem";
import { fetchJson } from "../../lib/fetch-json";
import { fadeRise } from "../../lib/motion";

const ITEMS = [
  { id: "inference-venv", label: "Entorno Python", engine: "venv" },
  { id: "inference-deps", label: "Dependencias PyTorch + CUDA", engine: "pip install" },
  { id: "weights-retrieval", label: "Modelo de recuperación", engine: "Lumi Preview" },
  { id: "weights-verification", label: "Modelo de verificación", engine: "Laila" },
];
interface Check { id: string; label: string; ok: boolean; detail: string }

export function InstallStep({ onComplete }: { onComplete: () => void }) {
  const [started, setStarted] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(-1);

  async function start() {
    setStarted(true);
    const { data } = await fetchJson<{ checks: Check[] }>("/api/setup/prereqs");
    const c = data?.checks ?? [];
    setChecks(c);
    if (c.find((x) => x.id === "postgres")?.ok) setActiveIdx(0);
  }
  function onDone(ok: boolean) {
    if (!ok) return;
    setActiveIdx((x) => {
      const next = x + 1;
      if (next >= ITEMS.length) onComplete();
      return next;
    });
  }
  const postgresOk = checks?.find((c) => c.id === "postgres")?.ok ?? false;

  if (!started) {
    return (
      <motion.div variants={fadeRise} initial="hidden" animate="show" className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[.06]">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#e9ecf1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 12 5 5 5-5" /><path d="M5 21h14" /></svg>
        </div>
        <div className="text-base font-medium text-fg">Instalar dependencias locales</div>
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted">Verificaremos PostgreSQL y descargaremos el entorno de inferencia y los pesos de Lumi Preview y Laila. Ocupan ~2.5 GB y se guardan en tu equipo.</p>
        <button onClick={start} className="mt-4 rounded-[10px] bg-accent px-7 py-2.5 text-sm font-medium text-black hover:brightness-105">Install</button>
      </motion.div>
    );
  }

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-fg">Instalando…</span>
        <span className="text-xs text-muted">{Math.max(activeIdx, 0)} / {ITEMS.length} completado</span>
      </div>
      {checks && (
        <div className="mb-3 flex items-center gap-3 rounded-card border border-white/10 bg-white/[.045] px-3 py-2.5">
          <span className="text-xs text-fg/80">Prerequisitos</span>
          <div className="ml-auto flex items-center gap-3">
            {checks.map((c) => (
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
          {ITEMS.map((it, i) => (
            <InstallItem key={it.id} stepId={it.id} label={it.label} engine={it.engine} active={i === activeIdx} onDone={onDone} />
          ))}
        </div>
      )}
    </motion.div>
  );
}