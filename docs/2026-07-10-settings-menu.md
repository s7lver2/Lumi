# Settings Menu Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unstyled `/settings` form with a polished, dark, translucent, sectioned settings panel matching the Raven-style design system — grouping every `SETTINGS_SCHEMA` field into meaningful sections, using the translucent `Menu` for enums, masking secrets, surfacing per-field help and the "inference restart required" caveat, and giving clear save feedback.

**Architecture:** Pure frontend. A new client `SettingsPanel` component drives the existing `GET`/`PATCH /api/settings` contract (which already masks secrets as `••••••••` and validates on PATCH). Fields are grouped by a static section map derived from `SETTINGS_SCHEMA`; enum fields render through the existing `Menu` primitive; each section is a `FloatingCard`. No backend or schema change.

**Tech Stack:** Next.js 14 App Router (client component), React 18, TypeScript, Tailwind (existing theme), vitest.

**Depends on:** Foundation (`SETTINGS_SCHEMA`, `/api/settings` GET/PATCH), Dashboard & Map UI Part 1 (Tailwind theme, `FloatingCard`), and the `Menu` primitive + Google free-tier settings from the UI-Refinement plan (`2026-07-09-ui-refinement-onboarding-cost.md`). **Supersedes Task 11 of that plan** — build this instead of that terser task.

**Out of scope:** changing what settings exist (this only reorganizes/represents `SETTINGS_SCHEMA`); the setup wizard (separate plan `2026-07-10-setup-wizard-ui.md`); live validation beyond what `PATCH /api/settings` already enforces.

## Global Constraints

- **Reuse the design system** — `FloatingCard` (translucent + `backdrop-blur`), `Menu`, Tailwind tokens. Inputs styled `bg-white/5 border border-white/10 rounded-md`. Never flat-opaque.
- **Never render or send a real secret value** — GET returns `••••••••` for secrets; treat an unchanged masked field as "don't send" on save (matches the current page's behavior).
- **Route-export rule** for `page.tsx`. **No path aliases.**
- **Every `SETTINGS_SCHEMA` key must appear in exactly one section** — a test enforces no key is orphaned, so adding a future setting can't silently vanish from the UI.
- TDD for the pure section-grouping logic; the panel component is verified manually. Frequent commits.

---

## File Structure

```
apps/web/app/
├── settings/
│   ├── page.tsx                        # Modify — render <SettingsPanel/>
│   └── sections.ts                     # Task 1 (pure grouping)
│   └── sections.test.ts                # Task 1
└── components/
    └── SettingsPanel.tsx               # Task 2
```

---

### Task 1: Section grouping (pure)

Map every setting key to a section, in display order, and guarantee full coverage.

**Files:** Create `apps/web/app/settings/sections.ts`, `sections.test.ts`.

**Interfaces:**
- Produces: `SETTINGS_SECTIONS: { id: string; title: string; keys: string[] }[]`; `groupSettings(): { section, defs }[]` returning each section paired with its `SettingDefinition`s; throws if any `SETTINGS_SCHEMA` key is unassigned.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/app/settings/sections.test.ts
import { describe, it, expect } from "vitest";
import { SETTINGS_SCHEMA } from "@netryx/shared-types";
import { SETTINGS_SECTIONS, groupSettings } from "./sections";

describe("settings sections", () => {
  it("assigns every SETTINGS_SCHEMA key to exactly one section", () => {
    const assigned = SETTINGS_SECTIONS.flatMap((s) => s.keys).sort();
    const all = SETTINGS_SCHEMA.map((d) => d.key).sort();
    expect(assigned).toEqual(all);
    expect(new Set(assigned).size).toBe(assigned.length); // no dupes
  });

  it("groupSettings returns sections paired with their definitions in order", () => {
    const grouped = groupSettings();
    expect(grouped[0].section.id).toBe("street-view");
    expect(grouped[0].defs.some((d) => d.key === "GOOGLE_MAPS_API_KEY")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test sections.test.ts` → FAIL (`Cannot find module './sections'`).

- [ ] **Step 3: Implement `sections.ts`**

```typescript
// apps/web/app/settings/sections.ts
import { SETTINGS_SCHEMA, getSettingDefinition, type SettingDefinition } from "@netryx/shared-types";

export interface SettingsSection { id: string; title: string; keys: string[] }

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "street-view", title: "Street View", keys: ["GOOGLE_MAPS_API_KEY"] },
  { id: "map", title: "Mapa", keys: ["MAPBOX_TOKEN"] },
  {
    id: "limits-cost",
    title: "Límites y coste",
    keys: [
      "MAX_AREA_KM2",
      "MAX_MONTHLY_BUDGET_USD",
      "MAX_CONCURRENT_REQUESTS",
      "STREET_VIEW_PRICE_PER_IMAGE_USD",
      "GOOGLE_FREE_MONTHLY_CREDIT_USD",
      "GOOGLE_FREE_MONTHLY_IMAGES",
    ],
  },
  {
    id: "models",
    title: "Modelos",
    keys: ["RETRIEVAL_MODEL", "VERIFICATION_MODEL", "VERIFICATION_CONFIRM_THRESHOLD"],
  },
];

/** Pairs each section with its definitions; throws if a schema key is unassigned. */
export function groupSettings(): { section: SettingsSection; defs: SettingDefinition[] }[] {
  const assigned = new Set(SETTINGS_SECTIONS.flatMap((s) => s.keys));
  const orphan = SETTINGS_SCHEMA.find((d) => !assigned.has(d.key));
  if (orphan) throw new Error(`Setting ${orphan.key} is not assigned to a section`);
  return SETTINGS_SECTIONS.map((section) => ({
    section,
    defs: section.keys.map((k) => getSettingDefinition(k)),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test sections.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/settings/sections.ts apps/web/app/settings/sections.test.ts
git commit -m "feat(web): settings section grouping with full-coverage guard"
```

---

### Task 2: `SettingsPanel` + restyled `/settings`

**Files:** Create `apps/web/app/components/SettingsPanel.tsx`; Modify `apps/web/app/settings/page.tsx`.

**Interfaces:**
- Consumes: `groupSettings`, `GET`/`PATCH /api/settings`, `FloatingCard`, `Menu`, `fetchJson`.

- [ ] **Step 1: Implement `SettingsPanel.tsx`**

```tsx
// apps/web/app/components/SettingsPanel.tsx
"use client";

import { useEffect, useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { Menu } from "./Menu";
import { groupSettings } from "../settings/sections";
import { fetchJson } from "../lib/fetch-json";
import type { SettingDefinition } from "@netryx/shared-types";

const MASK = "••••••••";

export function SettingsPanel() {
  const groups = groupSettings();
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchJson<Record<string, string>>("/api/settings").then((r) => setValues(r.data ?? {}));
  }, []);

  function set(key: string, value: string) {
    setDirty((d) => ({ ...d, [key]: value }));
  }
  const current = (def: SettingDefinition) =>
    dirty[def.key] ?? values[def.key] ?? def.defaultValue ?? "";

  async function save() {
    setSaving(true);
    setStatus(null);
    // Only send changed keys, and never re-send an untouched masked secret.
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(dirty)) {
      if (v !== MASK) body[k] = v;
    }
    const { ok, data } = await fetchJson("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!ok) return setStatus({ tone: "error", text: data?.error ?? "No se pudo guardar" });
    setValues((prev) => ({ ...prev, ...body }));
    setDirty({});
    setStatus({ tone: "ok", text: "Guardado" });
  }

  return (
    <div className="space-y-4">
      {groups.map(({ section, defs }) => (
        <FloatingCard key={section.id} className="p-5">
          <h2 className="mb-4 text-sm font-medium text-fg">{section.title}</h2>
          <div className="space-y-4">
            {defs.map((def) => (
              <label key={def.key} className="block">
                <span className="mb-1 block text-xs text-muted">{def.label}</span>
                {def.type === "enum" ? (
                  <Menu
                    value={current(def)}
                    onChange={(v) => set(def.key, v)}
                    options={(def.options ?? []).map((o) => ({ value: o, label: o }))}
                  />
                ) : (
                  <input
                    type={def.type === "number" ? "number" : def.isSecret ? "password" : "text"}
                    step={def.type === "number" ? "any" : undefined}
                    value={current(def)}
                    onChange={(e) => set(def.key, e.target.value)}
                    className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25"
                  />
                )}
              </label>
            ))}
            {section.id === "models" && (
              <p className="text-[11px] text-warning-fg">
                Cambiar de modelo requiere reiniciar el servicio de inferencia para aplicarse (spec §15.4).
              </p>
            )}
          </div>
        </FloatingCard>
      ))}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || Object.keys(dirty).length === 0}
          className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {status && (
          <span className={`text-xs ${status.tone === "ok" ? "text-accent-fg" : "text-danger-fg"}`}>
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Restyle `settings/page.tsx`**

```tsx
// apps/web/app/settings/page.tsx
import { SettingsPanel } from "../components/SettingsPanel";

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-lg font-medium text-fg">Configuración</h1>
      <SettingsPanel />
    </main>
  );
}
```

- [ ] **Step 3: Manual verification**

`pnpm dev` → `/settings`: sections (Street View / Mapa / Límites y coste incl. the two Google free-tier fields / Modelos) render as translucent cards; secrets show masked; changing a field enables "Guardar"; saving PATCHes only changed keys and shows "Guardado"; the models section shows the restart caveat; an invalid value (e.g. negative price) shows the server's error.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/SettingsPanel.tsx apps/web/app/settings/page.tsx
git commit -m "feat(web): sectioned translucent settings panel (spec §14, §15.4)"
```

---

## Self-Review

- **Coverage:** every `SETTINGS_SCHEMA` key (incl. the Google free-tier pair and the verification threshold) lands in one section, enforced by a test (Task 1). Secrets masked + never re-sent unchanged (Task 2). Enum fields use `Menu`; models section carries the §15.4 restart caveat.
- **Reuse:** no new styling; `FloatingCard`/`Menu`/theme/`fetchJson`. Backend untouched (`/api/settings` already masks + validates).
- **Supersedes:** Task 11 of `2026-07-09-ui-refinement-onboarding-cost.md`.
- **Manual-only:** the panel is an interactive form (not unit-tested in jsdom); grouping logic is unit-tested.

## Execution Handoff

Plan complete, saved to `docs/2026-07-10-settings-menu.md`. Subagent-driven (recommended) or inline execution.
