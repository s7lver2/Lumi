// apps/web/app/setup/steps/CredentialsStep.tsx
"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { fetchJson } from "../../lib/fetch-json";
import { fadeRise } from "../../lib/motion";

const LIMITS = [
  { key: "MAX_AREA_KM2", label: "Área máx. (km²)" },
  { key: "MAX_MONTHLY_BUDGET_USD", label: "Presupuesto mensual (USD)" },
  { key: "GOOGLE_FREE_MONTHLY_CREDIT_USD", label: "Crédito gratis Google (USD)" },
  { key: "GOOGLE_FREE_MONTHLY_IMAGES", label: "Imágenes gratis Google" },
];

export function CredentialsStep({ values, onChange, onComplete }: {
  values: Record<string, string>; onChange: (k: string, v: string) => void; onComplete: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const google = values.GOOGLE_MAPS_API_KEY ?? "";

  async function test() {
    setTesting(true); setResult(null);
    const { data } = await fetchJson<{ ok: boolean; error?: string }>("/api/setup/test-key", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: google }),
    });
    setTesting(false);
    if (data?.ok) { setResult({ ok: true, msg: "Clave válida · Street View respondió OK" }); onComplete(); }
    else setResult({ ok: false, msg: data?.error ?? "La clave no es válida" });
  }

  const field = "h-[38px] w-full rounded-lg border border-white/12 bg-white/5 px-3 text-sm text-fg outline-none focus:border-white/30";

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-0.5 text-[15px] font-medium text-fg">Credenciales</div>
      <p className="mb-4 text-xs text-muted">Se guardan cifradas y se aplican al terminar. Nada se escribe hasta confirmar.</p>

      <label className="mb-1.5 block text-xs text-muted">Google Street View Static API key <span className="text-danger-fg">· obligatoria</span></label>
      <div className="mb-1.5 flex items-center gap-2">
        <input value={google} onChange={(e) => { onChange("GOOGLE_MAPS_API_KEY", e.target.value); setResult(null); }} className={field} placeholder="AIza…" />
        <button onClick={test} disabled={!google || testing} className="h-[38px] flex-none rounded-lg border border-white/20 bg-white/[.06] px-3.5 text-xs text-fg hover:bg-white/10 disabled:opacity-50">{testing ? "Probando…" : "Probar"}</button>
      </div>
      {result && <p className={`mb-4 flex items-center gap-1.5 text-xs ${result.ok ? "text-fg" : "text-danger-fg"}`}>{result.ok ? "✓" : "✕"} {result.msg}</p>}

      <label className="mb-1.5 block text-xs text-muted">Mapbox token <span className="text-subtle">· opcional</span></label>
      <input value={values.MAPBOX_TOKEN ?? ""} onChange={(e) => onChange("MAPBOX_TOKEN", e.target.value)} className={`${field} mb-5`} placeholder="Déjalo vacío para usar MapLibre + tiles gratis" />

      <div className="mb-3 flex items-center gap-2"><span className="text-[11px] uppercase tracking-wide text-subtle">Límites y coste</span><span className="h-px flex-1 bg-white/10" /></div>
      <div className="grid grid-cols-2 gap-3">
        {LIMITS.map((l) => (
          <div key={l.key}>
            <label className="mb-1.5 block text-xs text-muted">{l.label}</label>
            <input type="number" step="any" value={values[l.key] ?? ""} onChange={(e) => onChange(l.key, e.target.value)}
              className="h-9 w-full rounded-lg border border-white/12 bg-white/5 px-3 text-sm text-fg outline-none focus:border-white/30" />
          </div>
        ))}
      </div>
    </motion.div>
  );
}