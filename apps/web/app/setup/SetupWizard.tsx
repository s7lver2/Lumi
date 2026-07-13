// apps/web/app/setup/SetupWizard.tsx
"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PlanetBackground } from "../components/PlanetBackground";
import { WIZARD_STEPS, nextStep, prevStep, type StepId } from "./wizard-steps";
import { InstallStep } from "./steps/InstallStep";
import { DatabaseStep } from "./steps/DatabaseStep";
import { CredentialsStep } from "./steps/CredentialsStep";
import { ConfirmStep } from "./steps/ConfirmStep";
import { fadeRise } from "../lib/motion";

const DEFAULT_COLLECTED: Record<string, string> = {
  MAX_AREA_KM2: "5", MAX_MONTHLY_BUDGET_USD: "50",
  GOOGLE_FREE_MONTHLY_CREDIT_USD: "0", GOOGLE_FREE_MONTHLY_IMAGES: "0",
  INFERENCE_RUNTIME: "windows",
};
const SUBTITLE: Record<StepId, string> = {
  install: "descarga el entorno y los modelos.",
  database: "crea las tablas y extensiones.",
  credentials: "conecta tus llaves de Google y el mapa.",
  confirm: "revisa y termina.",
};

export function SetupWizard() {
  const [current, setCurrent] = useState<StepId>("install");
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [collected, setCollected] = useState<Record<string, string>>(DEFAULT_COLLECTED);
  const mark = (id: StepId) => setDone((d) => ({ ...d, [id]: true }));
  const setField = (k: string, v: string) => setCollected((c) => ({ ...c, [k]: v }));

  const idx = WIZARD_STEPS.findIndex((s) => s.id === current);
  const next = nextStep(current);
  const prev = prevStep(current);

  const panel = {
    install: (
      <InstallStep
        onComplete={() => mark("install")}
        runtime={collected.INFERENCE_RUNTIME === "wsl" || collected.INFERENCE_RUNTIME === "linux" ? collected.INFERENCE_RUNTIME : "windows"}
        onRuntimeChange={(r) => setField("INFERENCE_RUNTIME", r)}
      />
    ),
    database: <DatabaseStep onComplete={() => mark("database")} />,
    credentials: <CredentialsStep values={collected} onChange={setField} onComplete={() => mark("credentials")} />,
    confirm: <ConfirmStep values={collected} />,
  }[current];

  return (
    <div className="relative min-h-screen overflow-hidden">
      <PlanetBackground />
      <div className="relative mx-auto max-w-xl px-6 py-10">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="animate-pulse text-fg">✦</span>
          <span className="text-lg font-medium text-fg">Vamos a preparar Lumi</span>
        </div>
        <p className="mb-6 text-xs text-muted">Paso {idx + 1} de {WIZARD_STEPS.length} · {SUBTITLE[current]}</p>

        <div className="relative mb-6 flex items-start justify-between">
          <div className="absolute left-[6%] right-[6%] top-3.5 h-0.5 bg-white/10" />
          <div className="absolute left-[6%] top-3.5 h-0.5 bg-accent transition-[width] duration-500"
            style={{ width: `${(idx / (WIZARD_STEPS.length - 1)) * 88}%` }} />
          {WIZARD_STEPS.map((s, i) => {
            const state = done[s.id] ? "done" : i === idx ? "active" : "todo";
            return (
              <div key={s.id} className="relative flex w-1/4 flex-col items-center gap-1.5">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${state === "done" ? "bg-accent text-black" : state === "active" ? "animate-pulse border-2 border-accent bg-bg text-fg" : "border border-white/15 bg-white/5 text-subtle"}`}>
                  {state === "done" ? "✓" : i + 1}
                </div>
                <span className={`text-center text-[11px] leading-tight ${i === idx ? "text-fg" : "text-subtle"}`}>{s.title}</span>
              </div>
            );
          })}
        </div>

        <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl">
          <AnimatePresence mode="wait">
            <motion.div key={current} variants={fadeRise} initial="hidden" animate="show" exit="exit">
              {panel}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-4 flex justify-between">
          <button onClick={() => prev && setCurrent(prev)} disabled={!prev}
            className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg disabled:opacity-40">Atrás</button>
          {next && (
            <button onClick={() => next && setCurrent(next)} disabled={!done[current]}
              className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black disabled:opacity-40">Siguiente</button>
          )}
        </div>
      </div>
    </div>
  );
}