// apps/web/app/components/SettingsPanel.tsx
"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FloatingCard } from "./FloatingCard";
import { Menu } from "./Menu";
import { Tabs } from "./Tabs";
import { SliderRow } from "./SliderRow";
import { CalibrationGrid } from "./CalibrationGrid";
import { OverwriteKeyModal } from "./OverwriteKeyModal";
import { AreasManagePanel } from "./AreasManagePanel";
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
  "areas": svg(<><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3Z" /><path d="M9 3v15M15 6v15" /></>, "#7edca4"),
};

const SLIDER_KEYS = new Set(["VERIFICATION_CONFIRM_THRESHOLD", "VERIFICATION_TILE_PASSES"]);
const CALIBRATION_KEYS = [
  "VERIFICATION_MIN_INLIERS",
  "VERIFICATION_INLIER_SATURATION",
  "VERIFICATION_ERROR_SCALE_PX",
  "VERIFICATION_MAGSAC_THRESHOLD_PX",
];

export function SettingsPanel() {
  const groups = groupSettings();
  const [activeTab, setActiveTab] = useState(groups[0]?.section.id ?? "areas");
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
    const body: Record<string, string> = { ...dirty };
    const { ok, data } = await fetchJson("/api/settings", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    setSaving(false);
    if (!ok) return setStatus({ tone: "error", text: (data as { error?: string })?.error ?? "No se pudo guardar" });
    setValues((prev) => ({ ...prev, ...body })); setDirty({}); setStatus({ tone: "ok", text: "Guardado" });
  }

  const tabItems = [
    ...groups.map(({ section }) => ({ id: section.id, label: section.title, icon: SECTION_ICON[section.id] })),
    { id: "areas", label: "Áreas", icon: SECTION_ICON.areas },
  ];
  const activeGroup = groups.find((g) => g.section.id === activeTab);

  return (
    <>
      <div className="flex gap-6">
        <div className="w-40 flex-shrink-0">
          <Tabs items={tabItems} value={activeTab} onChange={setActiveTab} />
        </div>

        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="min-w-0 flex-1 space-y-4">
          {activeTab === "areas" ? (
            <motion.div variants={staggerItem}>
              <AreasManagePanel />
            </motion.div>
          ) : activeGroup ? (
            <motion.div variants={staggerItem}>
              <FloatingCard className="p-5">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-fg">
                  {SECTION_ICON[activeGroup.section.id]}{activeGroup.section.title}
                </h2>
                <div className="space-y-4">
                  {activeGroup.defs
                    .filter((def) => !SLIDER_KEYS.has(def.key) && !CALIBRATION_KEYS.includes(def.key))
                    .map((def) => (
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

                  {activeGroup.defs
                    .filter((def) => SLIDER_KEYS.has(def.key))
                    .map((def) => (
                      <SliderRow key={def.key} def={def} value={current(def)} onChange={(v) => set(def.key, v)} />
                    ))}

                  {activeGroup.section.id === "models" && (
                    <CalibrationGrid
                      defs={activeGroup.defs.filter((def) => CALIBRATION_KEYS.includes(def.key))}
                      values={Object.fromEntries(activeGroup.defs.map((def) => [def.key, current(def)]))}
                      onChange={set}
                    />
                  )}

                  {activeGroup.section.id === "models" && (
                    <p className="text-[11px] text-warning-fg">Cambiar de modelo requiere reiniciar el servicio de inferencia para aplicarse (spec §15.4).</p>
                  )}
                </div>
              </FloatingCard>
            </motion.div>
          ) : null}

          {activeTab !== "areas" && (
            <div className="flex items-center gap-3">
              <button onClick={save} disabled={saving || Object.keys(dirty).length === 0}
                className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50">{saving ? "Guardando…" : "Guardar cambios"}</button>
              {status && <span className={`text-xs ${status.tone === "ok" ? "text-fg" : "text-danger-fg"}`}>{status.text}</span>}
            </div>
          )}

          <motion.div variants={staggerItem}>
            <FloatingCard className="flex items-center justify-between p-5">
              <div>
                <div className="text-sm font-medium text-fg">Volver a ejecutar el setup</div>
                <p className="mt-1 text-xs text-muted">Reinstala dependencias, migra la base de datos o cambia credenciales paso a paso.</p>
              </div>
              <a href="/setup" className="rounded-md border border-white/15 px-4 py-2 text-xs text-fg hover:bg-white/10">Abrir setup</a>
            </FloatingCard>
          </motion.div>
        </motion.div>
      </div>

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
