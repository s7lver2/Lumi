// apps/web/app/components/OverwriteKeyModal.tsx
"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { SettingDefinition } from "@netryx/shared-types";
import { fetchJson } from "../lib/fetch-json";
import { maskSecret } from "../settings/mask";
import { popIn, overlay } from "../lib/motion";

export function OverwriteKeyModal({ def, onClose, onSaved }: {
  def: SettingDefinition; onClose: () => void; onSaved: (preview: string) => void;
}) {
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isGoogle = def.key === "GOOGLE_MAPS_API_KEY";

  async function test() {
    if (isGoogle) {
      setTesting(true); setResult(null);
      const { data } = await fetchJson<{ ok: boolean; error?: string }>("/api/setup/test-key", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: value }),
      });
      setTesting(false);
      setResult(data?.ok ? { ok: true, msg: "Clave válida" } : { ok: false, msg: data?.error ?? "No válida" });
    } else {
      const ok = /^(pk|sk)\./.test(value);
      setResult(ok ? { ok: true, msg: "Formato correcto" } : { ok: false, msg: "Un token Mapbox empieza por pk. o sk." });
    }
  }

  async function save() {
    setSaving(true);
    const { ok, data } = await fetchJson("/api/settings", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [def.key]: value }),
    });
    setSaving(false);
    if (!ok) { setResult({ ok: false, msg: (data as { error?: string })?.error ?? "No se pudo guardar" }); return; }
    onSaved(maskSecret(value));
  }

  const canSave = value.length > 0 && (!def.required || result?.ok === true);

  return (
    <motion.div variants={overlay} initial="hidden" animate="show" exit="exit"
      onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <motion.div variants={popIn} initial="hidden" animate="show" exit="exit"
        onClick={(e) => e.stopPropagation()}
        className="w-[340px] rounded-[14px] border border-white/12 bg-elevated p-[18px] shadow-2xl shadow-black/50">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#e9ecf1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0" /></svg>
            <span className="text-sm font-medium text-fg">Sustituir clave</span>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-subtle hover:text-fg">✕</button>
        </div>
        <p className="mb-3.5 text-xs leading-relaxed text-muted">La clave actual no se puede leer por seguridad. Pega una nueva para reemplazarla.</p>
        <label className="mb-1.5 block text-xs text-muted">Nueva {def.label}</label>
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/25 bg-white/5 px-3">
          <input type={reveal ? "text" : "password"} value={value}
            onChange={(e) => { setValue(e.target.value); setResult(null); }}
            className="h-[38px] flex-1 bg-transparent font-mono text-sm text-fg outline-none" placeholder="Pega la nueva clave" />
          <button onClick={() => setReveal((v) => !v)} className="text-[11px] text-subtle hover:text-fg">{reveal ? "Ocultar" : "Mostrar"}</button>
        </div>
        <div className="mb-4 flex items-center gap-2.5">
          <button onClick={test} disabled={!value || testing}
            className="rounded-lg border border-white/20 bg-white/[.06] px-3 py-1.5 text-xs text-fg hover:bg-white/10 disabled:opacity-50">{testing ? "Probando…" : "Probar"}</button>
          {result && <span className={`flex items-center gap-1.5 text-xs ${result.ok ? "text-fg" : "text-danger-fg"}`}>{result.ok ? "✓" : "✕"} {result.msg}</span>}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-white/15 px-3.5 py-2 text-xs text-muted hover:text-fg">Cancelar</button>
          <button onClick={save} disabled={!canSave || saving}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50">{saving ? "Guardando…" : "Guardar clave"}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}