// apps/web/app/components/ModelUsageSection.tsx
"use client";
import { useEffect, useState } from "react";
import { FloatingCard } from "./FloatingCard";

interface ModelUsageRow {
  kind: string;
  totalCalls: number;
  totalDurationMs: number;
  rateUsdPerHour: number;
  estimatedCostUsd: number;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function ModelUsageSection() {
  const [rows, setRows] = useState<ModelUsageRow[] | null>(null);

  function load() {
    fetch("/api/settings/model-usage")
      .then((res) => res.json())
      .then(setRows)
      .catch(() => setRows([]));
  }

  useEffect(() => {
    load();
  }, []);

  async function updateRate(kind: string, rateUsdPerHour: number) {
    await fetch("/api/settings/model-usage/rate", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, rateUsdPerHour }),
    });
    load();
  }

  if (rows === null) return null;

  return (
    <FloatingCard className="p-5">
      <h2 className="mb-4 text-sm font-medium text-fg">Consumo de cómputo por modelo</h2>
      {rows.length === 0 ? (
        <div className="text-xs text-muted">Todavía no se ha registrado ninguna llamada a un modelo.</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-subtle">
              <th className="pb-2">Modelo</th>
              <th className="pb-2">Llamadas</th>
              <th className="pb-2">Tiempo total</th>
              <th className="pb-2">Tarifa ($/hora)</th>
              <th className="pb-2">Costo estimado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.kind} className="border-t border-border">
                <td className="py-2 font-mono text-fg">{row.kind}</td>
                <td className="py-2 text-fg">{row.totalCalls}</td>
                <td className="py-2 text-fg">{formatDuration(row.totalDurationMs)}</td>
                <td className="py-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={row.rateUsdPerHour}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (Number.isFinite(value) && value >= 0) updateRate(row.kind, value);
                    }}
                    className="w-20 rounded border border-border bg-transparent px-1.5 py-0.5 text-fg"
                  />
                </td>
                <td className="py-2 text-fg">${row.estimatedCostUsd.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </FloatingCard>
  );
}
