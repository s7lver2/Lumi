// apps/web/app/setup/steps/ConfirmStep.tsx
"use client";
import { motion } from "framer-motion";
import { fadeRise } from "../../lib/motion";
import { maskSecret } from "../../settings/mask";
import { submitSetupAction } from "../actions";

export function ConfirmStep({ values }: { values: Record<string, string> }) {
  const rows: [string, string][] = [
    ["Google Street View key", values.GOOGLE_MAPS_API_KEY ? maskSecret(values.GOOGLE_MAPS_API_KEY) : "— (obligatoria)"],
    ["Mapbox token", values.MAPBOX_TOKEN ? maskSecret(values.MAPBOX_TOKEN) : "sin definir (MapLibre)"],
    ["Área máx. (km²)", values.MAX_AREA_KM2 ?? "5"],
    ["Presupuesto mensual (USD)", values.MAX_MONTHLY_BUDGET_USD ?? "50"],
    ["Crédito gratis Google (USD)", values.GOOGLE_FREE_MONTHLY_CREDIT_USD ?? "0"],
    ["Imágenes gratis Google", values.GOOGLE_FREE_MONTHLY_IMAGES ?? "0"],
  ];
  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-0.5 text-[15px] font-medium text-fg">Confirmación</div>
      <p className="mb-4 text-xs text-muted">Revisa y finaliza. Los valores se guardan cifrados en una sola operación.</p>
      <div className="mb-5 overflow-hidden rounded-card border border-white/10">
        {rows.map(([k, v], i) => (
          <div key={k} className={`flex items-center justify-between px-3.5 py-2.5 text-xs ${i % 2 ? "bg-white/[.02]" : ""}`}>
            <span className="text-muted">{k}</span>
            <span className="font-mono text-fg">{v}</span>
          </div>
        ))}
      </div>
      <form action={submitSetupAction}>
        {Object.entries(values).map(([k, v]) => (<input key={k} type="hidden" name={k} value={v} />))}
        <button type="submit" className="w-full rounded-lg bg-accent py-3 text-sm font-medium text-black hover:brightness-105">Finalizar setup</button>
      </form>
    </motion.div>
  );
}