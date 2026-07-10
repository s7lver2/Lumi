// apps/web/app/setup/steps/InstallItem.tsx
"use client";
import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useCommandRun } from "../../lib/useCommandRun";
import { RunConsole } from "../../components/RunConsole";

export function InstallItem({ stepId, label, engine, active, onDone }: {
  stepId: string; label: string; engine?: string; active: boolean; onDone: (ok: boolean) => void;
}) {
  const { lines, running, done, code, run } = useCommandRun();
  const started = useRef(false);
  const reported = useRef(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (active && !started.current) { started.current = true; run(stepId); }
  }, [active, run, stepId]);

  useEffect(() => {
    if (done && !reported.current) { reported.current = true; onDone(code === 0); }
  }, [done, code, onDone]);

  const ok = done && code === 0;
  const failed = done && code !== 0;
  const showConsole = running || failed;

  return (
    <div className={`rounded-card border p-3 ${running ? "border-white/20 bg-white/[.06]" : "border-white/10 bg-white/[.03]"} ${!active && !done ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-[22px] w-[22px] flex-none items-center justify-center">
          {ok ? (
            <span className="flex h-full w-full items-center justify-center rounded-full bg-accent text-[11px] text-black">✓</span>
          ) : failed ? (
            <span className="flex h-full w-full items-center justify-center rounded-full text-danger-fg">✕</span>
          ) : running ? (
            <span className="lumi-anim h-4 w-4 rounded-full border-2 border-white/25 border-t-white" style={{ animation: "lumi-spin 1s linear infinite" }} />
          ) : (
            <span className="h-full w-full rounded-full border border-white/20" />
          )}
        </span>
        <span className="flex-1 text-sm text-fg">{label}{engine && <span className="text-subtle"> · {engine}</span>}</span>
        <span className="text-xs text-subtle">{ok ? "listo" : failed ? "error" : running ? "…" : "en cola"}</span>
        {failed && (
          <button onClick={() => { started.current = true; reported.current = false; run(stepId, true); }}
            className="ml-2 rounded-md border border-white/10 px-2 py-1 text-xs text-fg hover:bg-white/10">Reintentar</button>
        )}
      </div>
      {showConsole && (
        <motion.div initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} style={{ overflow: "hidden" }}>
          <RunConsole lines={lines} />
        </motion.div>
      )}
    </div>
  );
}