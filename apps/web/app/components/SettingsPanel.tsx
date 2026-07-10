// apps/web/app/components/SettingsPanel.tsx
"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FloatingCard } from "./FloatingCard";
import { Menu } from "./Menu";
import { OverwriteKeyModal } from "./OverwriteKeyModal";
import { groupSettings } from "../settings/sections";
import { fetchJson } from "../lib/fetch-json";
import { staggerContainer, staggerItem } from "../lib/motion";
import type { SettingDefinition } from "@netryx/shared-types";

const svg = (path: React.ReactNode, stroke: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);
const SECTION_ICON: Record<string, React.ReactNode> = {
  "street-view": svg(<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>, "#85b7eb"),
  "map": svg(<><path d="m9 3 6 3 6-3v15l-6 3-6-3-6 3V6l6-3Z" /><path d="M9 3v15" /><path d="M15 6v15" /></>, "#85b7eb"),
  "limits-cost": svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5a2.5 2.5 0 0 1 5 0M9.5 14.5a2.5 2.5 0 0 0 5 0" /></>, "#f0c477"),
  "models": svg(<><rect x="6" y="6" width="12" height="12" rx="1" /><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" /></>, "#a89fff"),
};

export function SettingsPanel() {
  const groups = groupSettings();
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<SettingDefinition | null>(null);

  useEffect(() => {
    fetchJson<Record<string, string>>("/api/settings").then((r) => setValues(r.data ?? {}));
  }, []);

  const set = (key: string, value: string) => setDirty((d) => ({ ...d, [key]: value }));
  const current = (def: SettingDefinition) => dirty[def.key] ?? values[def.key] ?? def.defaultValue ?? "";

  async function save() {
    setSaving(true); setStatus(null);
    const body: Record<string, string> = { ...dirty }; // secrets never enter `dirty`
    const { ok, data } = await fetchJson("/api/settings", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    setSaving(false);
    if (!ok) return setStatus({ tone: "error", text: (data as { error?: string })?.error ?? "No se pudo guardar" });
    setValues((prev) => ({ ...prev, ...body })); setDirty({}); setStatus({ tone: "ok", text: "Guardado" });
  }

  return (
    <>
      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-4">
        {groups.map(({ section, defs }) => (
          <motion.div key={section.id} variants={staggerItem}>
            <FloatingCard className="p-5">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-fg">{SECTION_ICON[section.id]}{section.title}</h2>
              <div className="space-y-4">
                {defs.map((def) => (
                  <div key={def.key}>
                    <span className="mb-1 block text-xs text-muted">{def.label}</span>
                    {def.isSecret ? (
                      <SecretRow display={values[def.key]} onEdit={() => setEditing(def)} />
                    ) : def.type === "enum" ? (
                      <Menu value={current(def)} onChange={(v) => set(def.key, v)}
                        options={(def.options ?? []).map((o) => ({ value: o, label: o }))} />
                    ) : (
                      <input type={def.type === "number" ? "number" : "text"} step={def.type === "number" ? "any" : undefined}
                        value={current(def)} onChange={(e) => set(def.key, e.target.value)}
                        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
                    )}
                  </div>
                ))}
                {section.id === "models" && (
                  <p className="text-[11px] text-warning-fg">Cambiar de modelo requiere reiniciar el servicio de inferencia para aplicarse (spec §15.4).</p>
                )}
              </div>
            </FloatingCard>
          </motion.div>
        ))}
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving || Object.keys(dirty).length === 0}
            className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50">{saving ? "Guardando…" : "Guardar cambios"}</button>
          {status && <span className={`text-xs ${status.tone === "ok" ? "text-fg" : "text-danger-fg"}`}>{status.text}</span>}
        </div>
      </motion.div>

      <AnimatePresence>
        {editing && (
          <OverwriteKeyModal def={editing} onClose={() => setEditing(null)}
            onSaved={(preview) => { const key = editing.key; setValues((v) => ({ ...v, [key]: preview })); setEditing(null); }} />
        )}
      </AnimatePresence>
    </>
  );
}

function SecretRow({ display, onEdit }: { display?: string; onEdit: () => void }) {
  const lockBtn = (
    <button onClick={onEdit} aria-label="Sustituir clave"
      className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-md border border-white/22 bg-white/[.08] text-fg hover:bg-white/15">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0" /></svg>
    </button>
  );
  if (display) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex h-[38px] flex-1 select-none items-center gap-2.5 rounded-md border border-white/10 bg-white/[.04] px-3">
          <span className="flex-1 font-mono text-[13px] tracking-wide text-fg">{display}</span>
          <span className="text-[11px] text-fg/80">✓ verificada</span>
        </div>
        {lockBtn}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-[38px] flex-1 select-none items-center rounded-md border border-dashed border-white/14 bg-white/[.03] px-3 text-xs text-subtle">Sin definir</div>
      {lockBtn}
    </div>
  );
}