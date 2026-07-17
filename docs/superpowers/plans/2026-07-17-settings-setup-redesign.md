# Settings & Setup Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Settings page use the full window width with a dedicated "Sistema" section for the setup-rerun action, and restructure the Setup wizard so it asks what the user will use Lumi for and installs a recommended model (today: just Lumi Preview) with visible progress, instead of downloading weights unconditionally.

**Architecture:** Settings changes are a container-width tweak plus one new special-cased sidebar tab (mirroring the existing "areas" tab pattern) backed by a new presentational `SystemPanel`. The Setup wizard grows from 4 to 6 steps by inserting `usage` and `models` between `install` and `database`; `install` sheds its weight-download items (moved to `models`, which also inherits `verify-services` since that check needs weights present to be meaningful); a new pure `recommendedBundles()` function maps use-case selections to entries in the existing static `MODEL_BUNDLES` registry, and the actual download/verify commands are the exact same backend step ids as today, just run from a different wizard step via the unmodified `InstallItem` component.

**Tech Stack:** Next.js 14 (App Router) client components, TypeScript, Tailwind CSS, framer-motion, Vitest (`environment: "node"` — no DOM/testing-library infra).

## Global Constraints

- `apps/web/vitest.config.ts` sets `environment: "node"` — there is **no DOM/testing-library infrastructure** in this repo. Do not write component-render tests for `UsageStep`, `ModelsStep`, `SettingsPanel`, or `SystemPanel`. Only plain, framework-free functions get real test coverage in this plan (`model-recommendations.ts`, `wizard-steps.ts`). This matches existing precedent: `InstallStep.tsx`, `CredentialsStep.tsx`, `DatabaseStep.tsx` have no tests today either.
- All user-facing copy is in Spanish, matching the existing tone (see `CredentialsStep.tsx`, `DatabaseStep.tsx` for reference phrasing).
- Do not modify `apps/web/app/setup/steps/InstallItem.tsx` — it is reused unmodified by the new `ModelsStep.tsx`.
- Do not modify anything under `apps/web/lib/model-catalog/`, any `/api/model-catalog/*` route, or `apps/web/app/components/CatalogBrowser.tsx`/`DatasetsSection.tsx`/`ModelosSection.tsx` — the live GitHub model catalog ("Tienda") is out of scope for this plan.
- Do not modify `services/inference/download_weights.py` or anything under `packages/shared-types` — `MODEL_BUNDLES` is read-only input to the new code in this plan.
- Publishing Lumi Preview to the model catalog is **not a task in this plan** — it's a manual, guided operational step performed after all tasks below are complete and verified.
- Real color/class tokens to reuse (confirmed by reading `tailwind.config.ts` and existing step components — do not invent new ones): `rounded-card` (12px radius), `border-white/10` / `bg-white/[.03]` for default cards, `border-white/20` / `bg-white/[.06]` for active/selected cards, `bg-accent` (`#f2f3f5`) with `text-black` for the selected checkmark badge and primary buttons, `text-fg` / `text-muted` / `text-subtle` for text hierarchy, `fadeRise` from `apps/web/app/lib/motion.ts` for step entrance animation.

---

### Task 1: Settings — full width + dedicated "Sistema" section

**Files:**
- Modify: `apps/web/app/settings/page.tsx`
- Modify: `apps/web/app/components/SettingsPanel.tsx`
- Create: `apps/web/app/components/SystemPanel.tsx`

**Interfaces:**
- Consumes: `FloatingCard` from `./FloatingCard` (existing, `{ className?: string; children: React.ReactNode }`).
- Produces: `SystemPanel` — a zero-prop component (`export function SystemPanel()`) other tasks/files don't depend on (self-contained, rendered only from `SettingsPanel.tsx`).

This task has no automated test — there is no DOM test infrastructure in this repo (see Global Constraints), and `SettingsPanel.tsx` itself has no existing tests. Verification is a manual dev-server check, folded into this task's steps instead of a separate test-run step.

- [ ] **Step 1: Widen the settings page container**

Open `apps/web/app/settings/page.tsx`. It currently reads:

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

Change `max-w-2xl` to `max-w-[1100px]`:

```tsx
// apps/web/app/settings/page.tsx
import { SettingsPanel } from "../components/SettingsPanel";

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-[1100px] p-8">
      <h1 className="mb-6 text-lg font-medium text-fg">Configuración</h1>
      <SettingsPanel />
    </main>
  );
}
```

- [ ] **Step 2: Create `SystemPanel.tsx`**

This is the exact content of the current loose "Volver a ejecutar el setup" card from `SettingsPanel.tsx` (lines 178-186 today), extracted into its own component so it can be rendered as a full tab instead of a fragment glued below every other tab's content.

```tsx
// apps/web/app/components/SystemPanel.tsx
import { FloatingCard } from "./FloatingCard";

export function SystemPanel() {
  return (
    <FloatingCard className="flex items-center justify-between p-5">
      <div>
        <div className="text-sm font-medium text-fg">Volver a ejecutar el setup</div>
        <p className="mt-1 text-xs text-muted">Reinstala dependencias, migra la base de datos o cambia credenciales paso a paso.</p>
      </div>
      <a href="/setup" className="rounded-md border border-white/15 px-4 py-2 text-xs text-fg hover:bg-white/10">Abrir setup</a>
    </FloatingCard>
  );
}
```

- [ ] **Step 3: Wire the "Sistema" tab into `SettingsPanel.tsx`**

Open `apps/web/app/components/SettingsPanel.tsx`. Four edits, in order:

**3a.** Add the import (next to the existing `AreasManagePanel` import):

```tsx
import { AreasManagePanel } from "./AreasManagePanel";
import { SystemPanel } from "./SystemPanel";
```

**3b.** Add a `system` icon to `SECTION_ICON` (a gear, distinct from the existing `models` gear-ish icon — reuse the same gear path already used for `models` is fine since they're never shown side by side in a way that would confuse, but to keep them visually distinct use a wrench-style path):

```tsx
const SECTION_ICON: Record<string, React.ReactNode> = {
  "street-view": svg(<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>, "#85b7eb"),
  "map": svg(<><path d="m9 3 6 3 6-3v15l-6 3-6-3-6 3V6l6-3Z" /><path d="M9 3v15" /><path d="M15 6v15" /></>, "#85b7eb"),
  "limits-cost": svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5a2.5 2.5 0 0 1 5 0M9.5 14.5a2.5 2.5 0 0 0 5 0" /></>, "#f0c477"),
  "models": svg(<><rect x="6" y="6" width="12" height="12" rx="1" /><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" /></>, "#a89fff"),
  "areas": svg(<><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3Z" /><path d="M9 3v15M15 6v15" /></>, "#7edca4"),
  "system": svg(<><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a5 5 0 0 1-6.6 6.6L6.7 20.3a2.1 2.1 0 0 1-3-3l7.5-7.5a5 5 0 0 1 6.6-6.6l-3 3.1Z" /></>, "#9aa1ac"),
};
```

**3c.** Add `"system"` to `tabItems` (after the `groups.map(...)` spread, alongside `"areas"`):

```tsx
const tabItems = [
    ...groups.map(({ section }) => ({ id: section.id, label: section.title, icon: SECTION_ICON[section.id] })),
    { id: "areas", label: "Áreas", icon: SECTION_ICON.areas },
    { id: "system", label: "Sistema", icon: SECTION_ICON.system },
  ];
```

**3d.** In the render, add a `activeTab === "system"` branch, and delete the old loose card. The render conditional currently reads:

```tsx
{activeTab === "areas" ? (
            <motion.div variants={staggerItem}>
              <AreasManagePanel />
            </motion.div>
          ) : activeGroup ? (
```

Change it to:

```tsx
{activeTab === "areas" ? (
            <motion.div variants={staggerItem}>
              <AreasManagePanel />
            </motion.div>
          ) : activeTab === "system" ? (
            <motion.div variants={staggerItem}>
              <SystemPanel />
            </motion.div>
          ) : activeGroup ? (
```

Then delete the old loose card block that currently sits after the "Guardar cambios" button block:

```tsx
          <motion.div variants={staggerItem}>
            <FloatingCard className="flex items-center justify-between p-5">
              <div>
                <div className="text-sm font-medium text-fg">Volver a ejecutar el setup</div>
                <p className="mt-1 text-xs text-muted">Reinstala dependencias, migra la base de datos o cambia credenciales paso a paso.</p>
              </div>
              <a href="/setup" className="rounded-md border border-white/15 px-4 py-2 text-xs text-fg hover:bg-white/10">Abrir setup</a>
            </FloatingCard>
          </motion.div>
```

(delete this whole block — it's superseded by the new "Sistema" tab). Also change the "Guardar cambios" button's guard from `activeTab !== "areas"` to also exclude `"system"` (Sistema has nothing to save):

```tsx
{activeTab !== "areas" && activeTab !== "system" && (
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors (this task adds/removes JSX and one component; no type-level changes to props consumed elsewhere).

- [ ] **Step 5: Manual verification**

Run: `cd apps/web && timeout 20 pnpm dev &` then `sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/settings`
Expected: `200`, and the dev server log shows no compile errors for `/settings`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/settings/page.tsx apps/web/app/components/SettingsPanel.tsx apps/web/app/components/SystemPanel.tsx
git commit -m "feat(web): widen Settings page and move setup-rerun into its own Sistema tab"
```

---

### Task 2: Setup wizard — extend the step sequence

**Files:**
- Modify: `apps/web/app/setup/wizard-steps.ts`
- Modify: `apps/web/app/setup/wizard-steps.test.ts`

**Interfaces:**
- Produces: `WIZARD_STEPS` now has 6 entries with ids `"install" | "database" | "credentials" | "confirm" | "usage" | "models"` (the `StepId` union grows accordingly). `nextStep`/`prevStep`/`isComplete` signatures are unchanged. Task 7 (`SetupWizard.tsx`) relies on this exact 6-id sequence and on `isComplete` still only being true for `"confirm"`.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `apps/web/app/setup/wizard-steps.test.ts`:

```ts
// apps/web/app/setup/wizard-steps.test.ts
import { describe, it, expect } from "vitest";
import { WIZARD_STEPS, nextStep, prevStep, isComplete } from "./wizard-steps";

describe("wizard steps", () => {
  it("orders the six steps and walks forward/back", () => {
    expect(WIZARD_STEPS.map((s) => s.id)).toEqual(["install", "usage", "models", "database", "credentials", "confirm"]);
    expect(nextStep("install")).toBe("usage");
    expect(nextStep("usage")).toBe("models");
    expect(nextStep("models")).toBe("database");
    expect(prevStep("database")).toBe("models");
    expect(prevStep("models")).toBe("usage");
    expect(prevStep("usage")).toBe("install");
    expect(prevStep("credentials")).toBe("database");
    expect(nextStep("confirm")).toBeNull();
    expect(prevStep("install")).toBeNull();
    expect(isComplete("confirm")).toBe(true);
    expect(isComplete("install")).toBe(false);
    expect(isComplete("usage")).toBe(false);
    expect(isComplete("models")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run app/setup/wizard-steps.test.ts`
Expected: FAIL — `WIZARD_STEPS.map((s) => s.id)` equals `["install", "database", "credentials", "confirm"]`, not the expected 6-item array.

- [ ] **Step 3: Update `WIZARD_STEPS`**

Replace the contents of `apps/web/app/setup/wizard-steps.ts`:

```ts
// apps/web/app/setup/wizard-steps.ts
export const WIZARD_STEPS = [
  { id: "install", title: "Instalación" },
  { id: "usage", title: "Uso" },
  { id: "models", title: "Modelos" },
  { id: "database", title: "Base de datos" },
  { id: "credentials", title: "Credenciales" },
  { id: "confirm", title: "Confirmación" },
] as const;
export type StepId = (typeof WIZARD_STEPS)[number]["id"];
const idx = (id: StepId) => WIZARD_STEPS.findIndex((s) => s.id === id);
export function nextStep(id: StepId): StepId | null {
  const i = idx(id);
  return i >= 0 && i < WIZARD_STEPS.length - 1 ? WIZARD_STEPS[i + 1].id : null;
}
export function prevStep(id: StepId): StepId | null {
  const i = idx(id);
  return i > 0 ? WIZARD_STEPS[i - 1].id : null;
}
export function isComplete(id: StepId): boolean { return id === "confirm"; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run app/setup/wizard-steps.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/setup/wizard-steps.ts apps/web/app/setup/wizard-steps.test.ts
git commit -m "feat(web): extend setup wizard to 6 steps (usage + models)"
```

---

### Task 3: Setup wizard — trim weight downloads out of Instalación

**Files:**
- Modify: `apps/web/app/setup/steps/InstallStep.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ITEMS_BY_RUNTIME.windows`/`.linux` now have exactly 2 items (`inference-venv`, `inference-deps`); `ITEMS_BY_RUNTIME.wsl` now has exactly 3 items (`inference-wsl-prereqs`, `inference-venv-wsl`, `inference-deps-wsl`). Task 6 (`ModelsStep.tsx`) is the only place `weights-retrieval`/`weights-verification`/`verify-services` (and their `-wsl` siblings) still run, via `InstallItem` with those same `stepId`s.

No test exists for `InstallStep.tsx` today (no DOM test infra — see Global Constraints); this task is verified via typecheck + manual dev-server check.

- [ ] **Step 1: Trim `ITEMS_BY_RUNTIME`**

In `apps/web/app/setup/steps/InstallStep.tsx`, replace the `ITEMS_BY_RUNTIME` constant:

```tsx
const ITEMS_BY_RUNTIME = {
  windows: [
    { id: "inference-venv", label: "Entorno Python", engine: "venv" },
    { id: "inference-deps", label: "Dependencias PyTorch + CUDA", engine: "pip install" },
  ],
  // Native Linux (e.g. Pop!_OS) — same steps/ids as "windows", the server
  // resolves venv/bin vs venv/Scripts per host (see run/[step]/route.ts).
  linux: [
    { id: "inference-venv", label: "Entorno Python", engine: "venv" },
    { id: "inference-deps", label: "Dependencias PyTorch + CUDA", engine: "pip install" },
  ],
  wsl: [
    { id: "inference-wsl-prereqs", label: "Dependencias del sistema (WSL2)", engine: "apt install" },
    { id: "inference-venv-wsl", label: "Entorno Python (WSL2)", engine: "venv" },
    { id: "inference-deps-wsl", label: "Dependencias PyTorch + CUDA (WSL2)", engine: "pip install" },
  ],
} as const;
```

- [ ] **Step 2: Update the intro copy**

The pre-install screen currently reads (inside the `if (!started)` block):

```tsx
<p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted">Verificaremos PostgreSQL y descargaremos el entorno de inferencia y los pesos de Lumi Preview y Laila. Ocupan ~2.5 GB y se guardan en tu equipo.</p>
```

Change it to drop the weights clause (weights are now downloaded in the later "Modelos" step, not here):

```tsx
<p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted">Verificaremos PostgreSQL y prepararemos el entorno de inferencia (Python + PyTorch/CUDA).</p>
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `cd apps/web && timeout 20 pnpm dev &` then `sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/setup`
Expected: `200`, no compile errors for `/setup` in the dev server log.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/setup/steps/InstallStep.tsx
git commit -m "feat(web): remove unconditional weight downloads from setup Instalación step"
```

---

### Task 4: Model recommendation lookup (pure function + test)

**Files:**
- Create: `apps/web/app/setup/model-recommendations.ts`
- Test: `apps/web/app/setup/model-recommendations.test.ts`

**Interfaces:**
- Consumes: `MODEL_BUNDLES` and `ModelBundleDefinition` from `@netryx/shared-types` (existing, read-only — `MODEL_BUNDLES: ModelBundleDefinition[]`, currently one entry with `id: "lumi-preview"`).
- Produces: `USE_CASES: readonly { id: UseCaseId; label: string; icon: string; blurb: string }[]`, `type UseCaseId = "image-recognition" | "testing" | "geolocation" | "experimentation"`, `recommendedBundles(selected: UseCaseId[]): ModelBundleDefinition[]`. Task 5 (`UsageStep.tsx`) renders `USE_CASES` and produces `UseCaseId[]` selections; Task 6 (`ModelsStep.tsx`) calls `recommendedBundles()` with those selections.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/setup/model-recommendations.test.ts
import { describe, it, expect } from "vitest";
import { recommendedBundles, USE_CASES } from "./model-recommendations";

describe("recommendedBundles", () => {
  it("recommends lumi-preview for each individual use case", () => {
    for (const useCase of USE_CASES) {
      const bundles = recommendedBundles([useCase.id]);
      expect(bundles.map((b) => b.id)).toEqual(["lumi-preview"]);
    }
  });

  it("dedupes when multiple use cases map to the same bundle", () => {
    const bundles = recommendedBundles(["image-recognition", "geolocation"]);
    expect(bundles.map((b) => b.id)).toEqual(["lumi-preview"]);
  });

  it("returns an empty array for an empty selection", () => {
    expect(recommendedBundles([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run app/setup/model-recommendations.test.ts`
Expected: FAIL with "Cannot find module './model-recommendations'" (file doesn't exist yet).

- [ ] **Step 3: Implement**

```ts
// apps/web/app/setup/model-recommendations.ts
import { MODEL_BUNDLES, type ModelBundleDefinition } from "@netryx/shared-types";

export const USE_CASES = [
  { id: "image-recognition", label: "Reconocimiento de imágenes", icon: "📷", blurb: "identificar lugares a partir de fotos" },
  { id: "testing", label: "Solo testeo", icon: "🧪", blurb: "probar la app, sin uso serio" },
  { id: "geolocation", label: "Geolocalización", icon: "📍", blurb: "ubicar imágenes en el mapa" },
  { id: "experimentation", label: "Experimentación", icon: "🛠", blurb: "probar herramientas y modelos" },
] as const;

export type UseCaseId = (typeof USE_CASES)[number]["id"];

// Every use case maps to the same bundle today — MODEL_BUNDLES has exactly
// one entry (lumi-preview). Adding a second bundle later means adding rows
// here without touching UsageStep/ModelsStep.
const RECOMMENDATIONS_BY_USE_CASE: Record<UseCaseId, string[]> = {
  "image-recognition": ["lumi-preview"],
  testing: ["lumi-preview"],
  geolocation: ["lumi-preview"],
  experimentation: ["lumi-preview"],
};

export function recommendedBundles(selected: UseCaseId[]): ModelBundleDefinition[] {
  const ids = new Set(selected.flatMap((id) => RECOMMENDATIONS_BY_USE_CASE[id] ?? []));
  return MODEL_BUNDLES.filter((b) => ids.has(b.id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run app/setup/model-recommendations.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/setup/model-recommendations.ts apps/web/app/setup/model-recommendations.test.ts
git commit -m "feat(web): add use-case-to-model-bundle recommendation lookup"
```

---

### Task 5: "Uso" step component

**Files:**
- Create: `apps/web/app/setup/steps/UsageStep.tsx`

**Interfaces:**
- Consumes: `USE_CASES`, `type UseCaseId` from `../model-recommendations` (Task 4). `fadeRise` from `../../lib/motion`.
- Produces: `UsageStep({ selected, onSelectedChange, onComplete }: { selected: UseCaseId[]; onSelectedChange: (ids: UseCaseId[]) => void; onComplete: () => void })`. Task 7 (`SetupWizard.tsx`) renders this with wizard-level `useCases` state.

No test — this is a presentational client component with no exported pure logic beyond what Task 4 already tests (no DOM test infra, per Global Constraints).

- [ ] **Step 1: Implement**

```tsx
// apps/web/app/setup/steps/UsageStep.tsx
"use client";
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { fadeRise } from "../../lib/motion";
import { USE_CASES, type UseCaseId } from "../model-recommendations";

export function UsageStep({
  selected,
  onSelectedChange,
  onComplete,
}: {
  selected: UseCaseId[];
  onSelectedChange: (ids: UseCaseId[]) => void;
  onComplete: () => void;
}) {
  // Selecting nothing is a valid choice (ModelsStep falls back to
  // recommending every bundle) — so this step is "done" as soon as it's
  // shown, unlike CredentialsStep which gates on a successful key test.
  const completed = useRef(false);
  useEffect(() => {
    if (!completed.current) { completed.current = true; onComplete(); }
  }, [onComplete]);

  function toggle(id: UseCaseId) {
    onSelectedChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-0.5 text-[15px] font-medium text-fg">¿Para qué vas a usar Lumi?</div>
      <p className="mb-4 text-xs text-muted">Selecciona una o más — te recomendaremos modelos según esto.</p>
      <div className="grid grid-cols-2 gap-2.5">
        {USE_CASES.map((uc) => {
          const isSelected = selected.includes(uc.id);
          return (
            <button
              key={uc.id}
              type="button"
              onClick={() => toggle(uc.id)}
              className={`relative rounded-card border p-3 text-left ${isSelected ? "border-accent bg-white/[.06]" : "border-white/10 bg-white/[.03] hover:bg-white/[.05]"}`}
            >
              {isSelected && (
                <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-black">✓</span>
              )}
              <div className="mb-1.5 text-xl">{uc.icon}</div>
              <div className="text-[12.5px] font-medium text-fg">{uc.label}</div>
              <div className="mt-0.5 text-[10.5px] text-subtle">{uc.blurb}</div>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/setup/steps/UsageStep.tsx
git commit -m "feat(web): add setup wizard Uso step (use-case survey)"
```

---

### Task 6: "Modelos recomendados" step component

**Files:**
- Create: `apps/web/app/setup/steps/ModelsStep.tsx`

**Interfaces:**
- Consumes: `recommendedBundles`, `type UseCaseId` from `../model-recommendations` (Task 4); `MODEL_BUNDLES` from `@netryx/shared-types`; `InstallItem` from `./InstallItem` (existing, unmodified — `{ stepId: string; label: string; engine?: string; active: boolean; onDone: (ok: boolean) => void }`); `fadeRise` from `../../lib/motion`.
- Produces: `ModelsStep({ useCases, onComplete }: { useCases: UseCaseId[]; onComplete: () => void })`. Task 7 (`SetupWizard.tsx`) renders this with the wizard's collected `useCases` state.

No test — presentational client component orchestrating already-tested pure logic (Task 4) and an already-existing, unmodified component (`InstallItem`); no DOM test infra exists (Global Constraints).

- [ ] **Step 1: Implement**

Each recommended bundle installs via the same two weight-download step ids as before, plus `verify-services` once at the very end (not once per bundle — starting the inference service twice would be redundant, and `runVerifyServices` in the backend route is already idempotent about not re-spawning a process that's already running).

```tsx
// apps/web/app/setup/steps/ModelsStep.tsx
"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { fadeRise } from "../../lib/motion";
import { InstallItem } from "./InstallItem";
import { recommendedBundles, USE_CASES, type UseCaseId } from "../model-recommendations";
import { MODEL_BUNDLES } from "@netryx/shared-types";

function labelsFor(useCases: UseCaseId[]): string {
  const labels = useCases.map((id) => USE_CASES.find((uc) => uc.id === id)?.label).filter((l): l is string => Boolean(l));
  return labels.length > 0 ? `Recomendado para: ${labels.join(", ")}` : "Recomendado";
}

export function ModelsStep({ useCases, onComplete }: { useCases: UseCaseId[]; onComplete: () => void }) {
  const recommended = recommendedBundles(useCases);
  const bundles = recommended.length > 0 ? recommended : MODEL_BUNDLES;
  const recommendationBlurb = labelsFor(useCases);

  // Today there's exactly one bundle ("lumi-preview"), so the checklist is
  // always this fixed set of steps. If a second bundle is ever added, its
  // own weight-download step ids would need to be threaded in here —
  // out of scope for now (see model-recommendations.ts comment).
  const items = [
    { id: "weights-retrieval", label: "Modelo de recuperación", engine: "Lumi Preview" },
    { id: "weights-verification", label: "Modelo de verificación", engine: "Laila" },
    { id: "verify-services", label: "Arrancar y verificar servicios", engine: "uvicorn + worker" },
  ];
  const [activeIdx, setActiveIdx] = useState(0);
  const [doneCount, setDoneCount] = useState(0);

  function onDone(ok: boolean) {
    if (!ok) return;
    setDoneCount((d) => d + 1);
    setActiveIdx((x) => {
      const next = x + 1;
      if (next >= items.length) onComplete();
      return next;
    });
  }

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-0.5 text-[15px] font-medium text-fg">Modelos recomendados</div>
      <p className="mb-4 text-xs text-muted">{recommendationBlurb}</p>

      <div className="mb-3 flex flex-col gap-2">
        {bundles.map((b) => (
          <div key={b.id} className="rounded-card border border-white/10 bg-white/[.03] p-3">
            <div className="text-[12.5px] font-medium text-fg">{b.displayName} <span className="font-normal text-subtle">· v{b.version}</span></div>
          </div>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-fg">Instalando…</span>
        <span className="text-xs text-muted">{doneCount} / {items.length} completado</span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <InstallItem key={it.id} stepId={it.id} label={it.label} engine={it.engine} active={i === activeIdx} onDone={onDone} />
        ))}
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/setup/steps/ModelsStep.tsx
git commit -m "feat(web): add setup wizard Modelos recomendados step"
```

---

### Task 7: Wire `UsageStep`/`ModelsStep` into `SetupWizard.tsx`

**Files:**
- Modify: `apps/web/app/setup/SetupWizard.tsx`

**Interfaces:**
- Consumes: `UsageStep` (Task 5), `ModelsStep` (Task 6), `type UseCaseId` from `./model-recommendations` (Task 4), the extended `WIZARD_STEPS`/`StepId` (Task 2).
- Produces: nothing further downstream — this is the final integration point for this plan's Setup wizard changes.

No test — `SetupWizard.tsx` has no existing tests (no DOM test infra, per Global Constraints); verified via typecheck + manual dev-server walkthrough.

- [ ] **Step 1: Add imports and `useCases` state**

In `apps/web/app/setup/SetupWizard.tsx`, add imports next to the existing step imports:

```tsx
import { InstallStep } from "./steps/InstallStep";
import { UsageStep } from "./steps/UsageStep";
import { ModelsStep } from "./steps/ModelsStep";
import { DatabaseStep } from "./steps/DatabaseStep";
import { CredentialsStep } from "./steps/CredentialsStep";
import { ConfirmStep } from "./steps/ConfirmStep";
import { fadeRise } from "../lib/motion";
import type { UseCaseId } from "./model-recommendations";
```

Add `useCases` state next to the existing `collected`/`done` state:

```tsx
export function SetupWizard() {
  const [current, setCurrent] = useState<StepId>("install");
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [collected, setCollected] = useState<Record<string, string>>(DEFAULT_COLLECTED);
  const [useCases, setUseCases] = useState<UseCaseId[]>([]);
  const mark = (id: StepId) => setDone((d) => ({ ...d, [id]: true }));
  const setField = (k: string, v: string) => setCollected((c) => ({ ...c, [k]: v }));
```

- [ ] **Step 2: Extend `SUBTITLE`**

```tsx
const SUBTITLE: Record<StepId, string> = {
  install: "descarga el entorno y los modelos.",
  usage: "para qué vas a usar Lumi.",
  models: "instalando lo recomendado.",
  database: "crea las tablas y extensiones.",
  credentials: "conecta tus llaves de Google y el mapa.",
  confirm: "revisa y termina.",
};
```

Also update the `install` subtitle (it no longer downloads models):

```tsx
const SUBTITLE: Record<StepId, string> = {
  install: "prepara el entorno de inferencia.",
  usage: "para qué vas a usar Lumi.",
  models: "instalando lo recomendado.",
  database: "crea las tablas y extensiones.",
  credentials: "conecta tus llaves de Google y el mapa.",
  confirm: "revisa y termina.",
};
```

- [ ] **Step 3: Extend the `panel` map**

The current `panel` map reads:

```tsx
const panel = {
    install: (
      <InstallStep
        onComplete={() => mark("install")}
        runtime={collected.INFERENCE_RUNTIME === "wsl" || collected.INFERENCE_RUNTIME === "linux" ? collected.INFERENCE_RUNTIME : "windows"}
        onRuntimeChange={(r) => setField("INFERENCE_RUNTIME", r)}
      />
    ),
    database: <DatabaseStep onComplete={() => mark("database")} />,
    credentials: <CredentialsStep values={collected} onChange={setField} onComplete={() => mark("credentials")} />,
    confirm: <ConfirmStep values={collected} />,
  }[current];
```

Add `usage` and `models` entries:

```tsx
const panel = {
    install: (
      <InstallStep
        onComplete={() => mark("install")}
        runtime={collected.INFERENCE_RUNTIME === "wsl" || collected.INFERENCE_RUNTIME === "linux" ? collected.INFERENCE_RUNTIME : "windows"}
        onRuntimeChange={(r) => setField("INFERENCE_RUNTIME", r)}
      />
    ),
    usage: <UsageStep selected={useCases} onSelectedChange={setUseCases} onComplete={() => mark("usage")} />,
    models: <ModelsStep useCases={useCases} onComplete={() => mark("models")} />,
    database: <DatabaseStep onComplete={() => mark("database")} />,
    credentials: <CredentialsStep values={collected} onChange={setField} onComplete={() => mark("credentials")} />,
    confirm: <ConfirmStep values={collected} />,
  }[current];
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Full test suite**

Run: `cd apps/web && pnpm vitest run`
Expected: all tests pass (the pre-existing `app/api/health/logs/route.test.ts` flake, if it occurs, is unrelated to this plan — confirmed multiple times earlier in this project as depending on real on-disk worker log state; rerun once if only that test fails).

- [ ] **Step 6: Manual verification**

Run: `cd apps/web && timeout 25 pnpm dev &` then `sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/setup` and `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/settings`
Expected: both `200`, no compile errors in the dev server log for either route.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/setup/SetupWizard.tsx
git commit -m "feat(web): wire Uso/Modelos steps into the setup wizard"
```

---

## After all tasks: guided operational step (not a task — do not automate)

Once every task above is committed and verified, walk the user through publishing Lumi Preview as the model catalog's first entry:

1. Confirm `GITHUB_TOKEN` and `MODEL_CATALOG_REPO` are set in Settings → Modelos.
2. Confirm the instance has Lumi Preview active and has indexed images (needed for `/api/model-catalog/publish`'s benchmark gate to pass).
3. Call `POST /api/model-catalog/publish` (curl or Postman — no UI trigger exists or is being added, per the spec's explicit decision to keep this out of the UI).
4. Open the Tienda popup's Modelos tab and confirm the new release appears.
