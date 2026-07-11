// apps/web/app/setup/steps/MigrateStep.tsx
"use client";
import { useEffect } from "react";
import { useCommandRun } from "../../lib/useCommandRun";
import { RunConsole } from "../../components/RunConsole";
export function MigrateStep({ onComplete }: { onComplete: () => void }) {
  const { lines, running, done, code, run } = useCommandRun();
  useEffect(() => { if (done && code === 0) onComplete(); }, [done, code, onComplete]);
  return (
    <div>
      <h2 className="text-sm font-medium text-fg">Base de datos</h2>
      <p className="mt-1 text-xs text-muted">Crea las tablas y las extensiones vector/PostGIS.</p>
      <button onClick={() => run("migrate")} disabled={running}
        className="mt-3 rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50">
        {running ? "Aplicando…" : done && code === 0 ? "Aplicado ✓" : "Aplicar migraciones"}
      </button>
      <RunConsole lines={lines} />
    </div>
  );
}