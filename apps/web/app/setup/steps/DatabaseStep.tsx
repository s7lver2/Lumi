// apps/web/app/setup/steps/DatabaseStep.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useCommandRun } from "../../lib/useCommandRun";
import { migrateProgress } from "../../lib/migrate-progress";
import { RunConsole } from "../../components/RunConsole";

const TABLES = ["areas", "indexed_images", "searches", "search_regions", "search_candidates", "api_usage", "system_settings"];
const TOTAL_MIGRATIONS = 5;
const GRID_BG: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px)",
  backgroundSize: "26px 26px",
};

export function DatabaseStep({ onComplete }: { onComplete: () => void }) {
  const { lines, done, code, run } = useCommandRun();
  const started = useRef(false);
  const reported = useRef(false);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => { if (!started.current) { started.current = true; run("migrate", true); } }, [run]);
  useEffect(() => { if (done && code === 0 && !reported.current) { reported.current = true; onComplete(); } }, [done, code, onComplete]);

  const finished = done && code === 0;
  const failed = done && code !== 0;
  const { applied, total, fraction } = migrateProgress(lines, TOTAL_MIGRATIONS);
  const extOk = applied >= 1 || finished;
  const revealed = finished ? TABLES.length : Math.round(fraction * TABLES.length);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e9ecf1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>
        <span className="text-base font-medium text-fg">Construyendo la base de datos</span>
      </div>
      <p className="mb-4 text-xs text-muted">Aplicando migraciones · las extensiones y tablas se materializan según se crean.</p>

      <div className="mb-4 flex gap-2.5">
        {[["pgvector", "embeddings 8448-d"], ["PostGIS", "geometría · índices"]].map(([name, sub]) => (
          <div key={name} className={`flex flex-1 items-center gap-2 rounded-card border px-3 py-2.5 ${extOk ? "border-white/20 bg-white/[.06]" : "border-white/10 bg-white/[.03] opacity-60"}`}>
            <div className="flex-1">
              <div className="text-[12.5px] font-medium text-fg">{name}</div>
              <div className="text-[11px] text-subtle">{sub}</div>
            </div>
            {extOk && <span className="text-fg">✓</span>}
          </div>
        ))}
      </div>

      <div className="rounded-card border border-white/10 bg-white/[.03] p-2" style={GRID_BG}>
        <div className="grid grid-cols-2 gap-1.5">
          {TABLES.map((t, i) => {
            const isDone = i < revealed;
            const isCurrent = i === revealed && !finished && !failed;
            return (
              <div key={t} className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${isDone ? "border-white/10 bg-white/[.04]" : isCurrent ? "border-white/20 bg-white/[.07]" : "border-dashed border-white/10 bg-white/[.02] opacity-55"}`}>
                <span className="flex-1 font-mono text-xs text-fg">{t}</span>
                {isDone ? <span className="text-xs text-fg">✓</span> : isCurrent ? <span className="lumi-anim h-3.5 w-3.5 rounded-full border-2 border-white/25 border-t-white" style={{ animation: "lumi-spin 1s linear infinite" }} /> : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2.5">
        <span className="relative h-1 flex-1 overflow-hidden rounded bg-white/10">
          <span className="absolute left-0 top-0 h-full rounded bg-accent transition-[width] duration-500" style={{ width: `${Math.round((finished ? 1 : fraction) * 100)}%` }} />
        </span>
        <span className="text-[11.5px] text-muted">{finished ? total : applied} / {total} migraciones</span>
      </div>

      {failed && (
        <div className="mt-3 text-xs text-danger-fg">
          Falló la migración. <button onClick={() => setShowLog((v) => !v)} className="underline">ver log</button>
          <button onClick={() => { started.current = true; reported.current = false; setShowLog(true); run("migrate", true); }} className="ml-2 rounded-md border border-white/10 px-2 py-1 text-fg hover:bg-white/10">Reintentar</button>
        </div>
      )}
      {showLog && <RunConsole lines={lines} />}
    </div>
  );
}