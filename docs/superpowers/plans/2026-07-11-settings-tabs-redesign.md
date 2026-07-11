# Settings Tabs Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Settings page from one long stack of `FloatingCard`s into a tabbed layout (left rail, per-tab content), with nicer, more purpose-built controls for the numeric settings — real `<input type="range">` sliders for genuinely bounded values (confirm threshold, tile passes), and a compact visual calibration grid for the 4 unbounded verification-tuning numbers — instead of every numeric setting rendering as the same plain text-like `<input type="number">`.

**Architecture:** A new reusable `Tabs.tsx` (rail + content slot, proper ARIA roles) replaces the current flat `.map()` over `SETTINGS_SECTIONS`. `Areas indexadas` (currently a `FloatingCard` bolted on after the save bar, unrelated to `SETTINGS_SCHEMA`) becomes its own tab, sitting alongside the schema-driven ones. Two new small presentational components — `SliderRow` (a real range input, used for `VERIFICATION_CONFIRM_THRESHOLD` and `VERIFICATION_TILE_PASSES`) and `CalibrationGrid` (a 2x2 grid of number inputs with a cosmetic mini progress-bar underneath, used for the 4 `VERIFICATION_*` calibration settings) — replace the generic `<input type="number">` fallback for those specific keys only; every other numeric setting (budget, area size, API price, etc.) keeps the existing plain number input, since those don't have natural bounds a slider could honestly represent.

## Global Constraints

- Only real Tailwind tokens confirmed to exist in `apps/web/tailwind.config.ts` are used anywhere in this plan: `bg`, `surface`, `panel`, `elevated`, `border`, `muted`, `subtle`, `fg`, `accent`/`accent-fg`, `draw`/`draw-fg`, `warning`/`warning-fg`, `danger`/`danger-fg`, plus `rounded-card` (12px). No invented tokens.
- The 4 `VERIFICATION_MIN_INLIERS`/`VERIFICATION_INLIER_SATURATION`/`VERIFICATION_ERROR_SCALE_PX`/`VERIFICATION_MAGSAC_THRESHOLD_PX` settings do NOT get converted to real `<input type="range">` sliders — they have no natural, honest upper bound (e.g. inlier saturation could sensibly be 500 or 50,000 depending on the scene), so forcing a fixed slider range would silently clip valid values a user might want to type. They stay real number inputs; only their visual presentation (compact grid + a cosmetic reference bar) changes.
- `groupSettings()`'s existing safety net (throws if any `SETTINGS_SCHEMA` key isn't assigned to a section) is preserved exactly — the new "Áreas" tab is NOT a `SETTINGS_SECTIONS` entry (it renders `AreasManagePanel`, unrelated to the schema), so it's added as a separate, explicit tab definition in `SettingsPanel.tsx` itself, not by relaxing that safety net.

---

### Task 1: Let slider settings represent fractional values, and convert `VERIFICATION_CONFIRM_THRESHOLD` into one

**Files:**
- Modify: `packages/shared-types/src/settings.ts`
- Modify: `packages/shared-types/src/settings.test.ts`

**Interfaces:**
- Produces: `SettingDefinition` gains `step?: number` (UI granularity hint, defaults to `1` if unset — used by Task 3's `SliderRow`). `validateSettingValue`'s `"slider"` branch now only enforces `min <= parsed <= max` (dropping the previous `Number.isInteger` requirement, which was only ever correct for `VERIFICATION_TILE_PASSES`'s integer 1-10 range and would incorrectly reject `0.55` for a threshold slider).

- [ ] **Step 1: Update the existing test that asserts `VERIFICATION_CONFIRM_THRESHOLD` is a `"number"`**

```ts
// packages/shared-types/src/settings.test.ts — replace this existing test:
  it("defines VERIFICATION_CONFIRM_THRESHOLD as a number setting with a sane default", () => {
    const def = getSettingDefinition("VERIFICATION_CONFIRM_THRESHOLD");
    expect(def.type).toBe("number");
    expect(def.defaultValue).toBe("0.5");
    expect(() => validateSettingValue("VERIFICATION_CONFIRM_THRESHOLD", "0.7")).not.toThrow();
  });
// with:
  it("defines VERIFICATION_CONFIRM_THRESHOLD as a 0-1 slider setting with a sane default", () => {
    const def = getSettingDefinition("VERIFICATION_CONFIRM_THRESHOLD");
    expect(def.type).toBe("slider");
    expect(def.min).toBe(0);
    expect(def.max).toBe(1);
    expect(def.defaultValue).toBe("0.5");
    expect(() => validateSettingValue("VERIFICATION_CONFIRM_THRESHOLD", "0.7")).not.toThrow();
  });
```

Add a new test for fractional slider validation, in the existing `describe("validateSettingValue", ...)` block:

```ts
  it("accepts a fractional value within a slider's min/max", () => {
    expect(() => validateSettingValue("VERIFICATION_CONFIRM_THRESHOLD", "0.55")).not.toThrow();
  });
  it("rejects a slider value outside its min/max even if fractional", () => {
    expect(() => validateSettingValue("VERIFICATION_CONFIRM_THRESHOLD", "1.5")).toThrow(/between/i);
  });
```

- [ ] **Step 2: Run tests to verify the updated/new ones fail**

Run: `cd packages/shared-types && npx vitest run src/settings.test.ts`
Expected: FAIL — current `type` is `"number"`, and current slider validation still requires `Number.isInteger`.

- [ ] **Step 3: Implement**

```ts
// packages/shared-types/src/settings.ts — SettingDefinition gains `step`
export interface SettingDefinition {
  key: string;
  label: string;
  type: SettingType;
  isSecret: boolean;
  required: boolean;
  defaultValue?: string;
  options?: string[];
  min?: number;
  max?: number;
  /** UI granularity for type "slider" (the <input type="range">'s step attribute). Defaults to 1 if unset. */
  step?: number;
}
```

Change `VERIFICATION_CONFIRM_THRESHOLD`'s entry:

```ts
  {
    key: "VERIFICATION_CONFIRM_THRESHOLD",
    label: "Auto-confirm threshold for verification score (0–1)",
    type: "slider",
    isSecret: false,
    required: true,
    defaultValue: String(DEFAULT_CONFIRM_THRESHOLD),
    min: 0,
    max: 1,
    step: 0.05,
  },
```

Relax the slider validation branch (drop the integer requirement):

```ts
  if (def.type === "slider") {
    const parsed = Number(value);
    const min = def.min ?? 1;
    const max = def.max ?? 10;
    if (Number.isNaN(parsed) || parsed < min || parsed > max) {
      throw new Error(`${def.label} must be a number between ${min} and ${max}`);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/shared-types && npx vitest run src/settings.test.ts`
Expected: PASS (17 tests — 15 existing minus the one replaced, plus 2 new, net +2)

- [ ] **Step 5: Fix the now-broken exact-array assertion in the setup wizard's test**

`apps/web/app/setup/actions.test.ts` asserts `completeSetup` is called with an exact array including `{ key: "VERIFICATION_TILE_PASSES", value: "5", isSecret: false }` — unaffected by this task (that key's type/validation is untouched). No change needed there. Run it anyway to confirm:

Run: `cd apps/web && npx vitest run app/setup/actions.test.ts`
Expected: PASS, unchanged (3 tests) — confirms this task didn't accidentally affect setup's write path.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/settings.ts packages/shared-types/src/settings.test.ts
git commit -m "feat(shared-types): let slider settings hold fractional values; make the confirm threshold one"
```

---

### Task 2: `Tabs.tsx` — reusable tab rail component

**Files:**
- Create: `apps/web/app/components/Tabs.tsx`

**Interfaces:**
- Produces: `<Tabs items={{id, label, icon?}[]} value={activeId} onChange={(id) => void} />`, consumed by Task 5's `SettingsPanel.tsx`.

No automated test for this component: confirmed via `grep -rl "@testing-library" apps/web` and `find . -iname "*.test.tsx"` that **zero** `.test.tsx` files exist anywhere in this codebase and `@testing-library/react` isn't in `apps/web/package.json` — every existing test is `.test.ts` against pure logic/stores/API routes, never a rendered component. Introducing React Testing Library here would be a new, unprecedented test dependency for one small presentational component. Matches `SliderRow`/`CalibrationGrid` below, which are also manually verified only (Task 3/4's Step 2) — this component gets the same treatment for consistency, verified end-to-end in Task 5's browser check instead.

- [ ] **Step 1: Implement**

```tsx
// apps/web/app/components/Tabs.tsx
"use client";
import type { ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
}

/**
 * A left-rail tab list (role="tablist"/"tab", ARIA-correct — the existing
 * Windows/WSL2 toggle in InstallStep.tsx is the closest visual precedent
 * but is two inline buttons with no ARIA roles; this generalizes that same
 * look — bg-accent text-black on the active item, border+hover otherwise —
 * into a reusable, keyboard-accessible component).
 */
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.id)}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] ${
              selected ? "bg-accent font-medium text-black" : "text-muted hover:bg-white/5 hover:text-fg"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Manually verify (covered end-to-end in Task 5's browser check — no standalone test, per this task's note above)**

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/Tabs.tsx
git commit -m "feat(web): add a reusable Tabs component"
```

---

### Task 3: `SliderRow.tsx` — a real range-input row for bounded settings

**Files:**
- Create: `apps/web/app/components/SliderRow.tsx`

**Interfaces:**
- Produces: `<SliderRow def={SettingDefinition} value={string} onChange={(v: string) => void} />`, consumed by Task 5's `SettingsPanel.tsx` for any `def.type === "slider"`.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/SliderRow.tsx
"use client";
import type { SettingDefinition } from "@netryx/shared-types";

export function SliderRow({
  def,
  value,
  onChange,
}: {
  def: SettingDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  const min = def.min ?? 1;
  const max = def.max ?? 10;
  const step = def.step ?? 1;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs text-muted">{def.label}</span>
        <span className="text-xs font-medium text-fg">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full accent-accent"
      />
      <div className="mt-1 flex justify-between text-[11px] text-subtle">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manually verify (visual component, covered end-to-end in Task 5's browser check)**

No standalone test — this is a thin, purely presentational wrapper around a native `<input type="range">`; its behavior is exercised by Task 5's manual browser verification once wired into the real Settings page.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/SliderRow.tsx
git commit -m "feat(web): add a SliderRow component for bounded numeric settings"
```

---

### Task 4: `CalibrationGrid.tsx` — compact grid for the 4 verification-tuning numbers

**Files:**
- Create: `apps/web/app/components/CalibrationGrid.tsx`

**Interfaces:**
- Consumes: the 4 `VERIFICATION_MIN_INLIERS`/`VERIFICATION_INLIER_SATURATION`/`VERIFICATION_ERROR_SCALE_PX`/`VERIFICATION_MAGSAC_THRESHOLD_PX` definitions + their current values.
- Produces: rendered inside Task 5's `SettingsPanel.tsx`, replacing those 4 keys' individual full-width rows.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/CalibrationGrid.tsx
"use client";
import type { SettingDefinition } from "@netryx/shared-types";

// Cosmetic-only reference maximums for the mini progress bar under each
// input — these settings have no honest hard upper bound (e.g. inlier
// saturation could sensibly be 500 or 50,000 depending on the scene), so
// they stay real, freely-typed number inputs (see this plan's Global
// Constraints) and this bar is just a rough visual sense of scale, not a
// clamp. A value beyond the reference max simply fills the bar to 100%.
const REFERENCE_MAX: Record<string, number> = {
  VERIFICATION_MIN_INLIERS: 50,
  VERIFICATION_INLIER_SATURATION: 5000,
  VERIFICATION_ERROR_SCALE_PX: 20,
  VERIFICATION_MAGSAC_THRESHOLD_PX: 10,
};

function MiniBar({ value, referenceMax }: { value: number; referenceMax: number }) {
  const pct = Math.max(0, Math.min(1, value / referenceMax)) * 100;
  return (
    <div className="h-1 w-full rounded-full bg-white/10">
      <div className="h-1 rounded-full bg-draw" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CalibrationGrid({
  defs,
  values,
  onChange,
}: {
  defs: SettingDefinition[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {defs.map((def) => {
        const value = values[def.key] ?? def.defaultValue ?? "0";
        const referenceMax = REFERENCE_MAX[def.key] ?? 100;
        return (
          <div key={def.key}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs text-muted">{def.label}</span>
              <span className="text-xs font-medium text-fg">{value}</span>
            </div>
            <input
              type="number"
              step="any"
              value={value}
              onChange={(e) => onChange(def.key, e.target.value)}
              className="mb-1.5 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-fg outline-none focus:border-white/25"
            />
            <MiniBar value={Number(value) || 0} referenceMax={referenceMax} />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Manually verify**

Covered end-to-end in Task 5's browser check (same reasoning as Task 3 Step 2).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/CalibrationGrid.tsx
git commit -m "feat(web): add a compact calibration grid for the 4 verification-tuning numbers"
```

---

### Task 5: Rewrite `SettingsPanel.tsx` into a tabbed layout

**Files:**
- Modify: `apps/web/app/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `Tabs` (Task 2), `SliderRow` (Task 3), `CalibrationGrid` (Task 4), the existing `AreasManagePanel` (unchanged, just relocated into its own tab).

- [ ] **Step 1: Rewrite the component**

```tsx
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

// Keys rendered by the specialized components (Task 3/4) instead of the
// generic per-def switch below — pulled out of each tab's plain-loop list.
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
```

- [ ] **Step 2: Manually verify in the browser**

Open `/settings`. Confirm: a left rail with 5 tabs (Street View, Mapa, Límites y coste, Modelos, Áreas); clicking each swaps the content without a page reload; the "Modelos" tab shows the model dropdowns, a real drag-able slider for "Auto-confirm threshold" (0-1, step 0.05) and "Pasadas de verificación" (1-10, whole numbers), a 2x2 calibration grid below with mini bars that visibly grow/shrink as you edit the number inputs, and the WSL2/Windows enum dropdown unchanged; "Guardar cambios" persists edits made in any tab (dirty state isn't tab-scoped, so switching tabs before saving doesn't lose changes — confirm this explicitly); the "Áreas" tab shows the exact same `AreasManagePanel` as before (export/import/merge), just now behind its own tab instead of always-visible below the save bar.

- [ ] **Step 3: Run the full `apps/web` test suite to confirm nothing else broke**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/SettingsPanel.tsx
git commit -m "feat(web): reorganize Settings into tabs with slider/calibration controls"
```

---

## Self-Review

**1. Spec coverage:** "reorganizar los ajustes en varias tabs" → Task 5. "diseño y componentes un poco más innovadores (sliders, barras, cosas bonitas)" → Task 3 (`SliderRow`, real range inputs for the two genuinely-bounded settings) + Task 4 (`CalibrationGrid`'s mini bars for the 4 unbounded ones) + Task 1 (making the confirm threshold an actual slider, not just a number box).

**2. Placeholder scan:** no TBD/TODO; every component is complete, working code with real styling values (no invented Tailwind tokens, per Global Constraints).

**3. Type consistency:** `SliderRow`'s `def: SettingDefinition` / `value: string` / `onChange: (value: string) => void` matches `SettingsPanel.tsx`'s existing `current(def)`/`set(key, value)` helpers exactly — no new state shape introduced, `dirty`/`values` stay `Record<string, string>` throughout. `CalibrationGrid`'s `REFERENCE_MAX` keys match `VERIFICATION_MIN_INLIERS`/etc. exactly as spelled in `packages/shared-types/src/settings.ts`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-11-settings-tabs-redesign.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
