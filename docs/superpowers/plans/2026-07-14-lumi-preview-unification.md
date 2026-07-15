# Lumi Preview / Laila Unification (Epic C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Settings' two independent "Retrieval model"/"Verification model" dropdowns with one "Modelo" dropdown backed by a new `MODEL_BUNDLES` registry, so picking "Lumi Preview" writes both underlying settings together — no mismatched pair possible, no change to `services/inference` or the already-planned API-first architecture.

**Architecture:** A new `packages/shared-types` registry (`MODEL_BUNDLES` + `resolveModelBundle`) pairs a retrieval model id with a verification model id under one product-facing id/name. A new `ModelBundleRow` component slots into `SettingsPanel.tsx`'s existing generic per-setting render loop (same pattern as the low-VRAM-mode epic's `LowVramModeRow`), replacing the `RETRIEVAL_MODEL` row and hiding the `VERIFICATION_MODEL` row, but writing to the exact same `dirty`/`PATCH /api/settings` mechanism already there.

**Tech Stack:** TypeScript (`packages/shared-types`), React/Next.js (`apps/web`), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-lumi-preview-unification-design.md` — read it before starting.
- `services/inference` is untouched by this entire plan — it keeps reading `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` independently, exactly as today.
- The already-planned API-first architecture (`docs/superpowers/plans/2026-07-14-api-first-architecture.md`) needs no changes — its `/api/models/{modelId}/...` namespace already uses `"lumi-preview"`, identical to this epic's bundle id.
- All new user-facing copy is in Spanish, matching the rest of the app.
- Follow existing conventions: `packages/shared-types` registries get a matching `.test.ts` in the same style as `models.test.ts`; new Settings-panel row components follow `LowVramModeRow.tsx`'s pattern (a special case inside the generic per-setting loop, not a parallel rendering path).

---

### Task 1: `MODEL_BUNDLES` registry + `resolveModelBundle`

**Files:**
- Create: `packages/shared-types/src/model-bundles.ts`
- Create: `packages/shared-types/src/model-bundles.test.ts`
- Modify: `packages/shared-types/src/index.ts`

**Interfaces:**
- Produces: `ModelBundleDefinition { id, displayName, retrievalModelId, verificationModelId, version, status }`, `MODEL_BUNDLES: ModelBundleDefinition[]`, `resolveModelBundle(retrievalModelId: string, verificationModelId: string): ModelBundleDefinition | null` — Task 2's `ModelBundleRow` imports all three.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared-types/src/model-bundles.test.ts
import { describe, it, expect } from "vitest";
import { MODEL_BUNDLES, resolveModelBundle } from "./model-bundles";

describe("MODEL_BUNDLES", () => {
  it("has at least one entry with the expected shape", () => {
    expect(MODEL_BUNDLES.length).toBeGreaterThan(0);
    const lumiPreview = MODEL_BUNDLES.find((b) => b.id === "lumi-preview")!;
    expect(lumiPreview).toBeDefined();
    expect(lumiPreview.displayName).toBe("Lumi Preview");
    expect(lumiPreview.retrievalModelId).toBe("lumi-preview");
    expect(lumiPreview.verificationModelId).toBe("laila");
    expect(lumiPreview.version).toBe("1.0");
    expect(lumiPreview.status).toBe("preview");
  });
});

describe("resolveModelBundle", () => {
  it("returns the matching bundle for a known pair", () => {
    const bundle = resolveModelBundle("lumi-preview", "laila");
    expect(bundle?.id).toBe("lumi-preview");
  });

  it("returns null for an unknown/mismatched pair", () => {
    expect(resolveModelBundle("lumi-preview", "some-other-verification-model")).toBeNull();
    expect(resolveModelBundle("nonexistent-model", "laila")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/shared-types test model-bundles`
Expected: FAIL — `Cannot find module './model-bundles'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared-types/src/model-bundles.ts

/**
 * Product/catalog-level pairing of a retrieval model + verification model
 * under one user-facing name (spec: docs/superpowers/specs/2026-07-14-
 * lumi-preview-unification-design.md). Deliberately NOT a re-architecture:
 * services/inference still reads RETRIEVAL_MODEL/VERIFICATION_MODEL
 * independently, exactly as before this file existed — this registry only
 * exists so the web app can present ONE selectable thing instead of two
 * independently-mismatchable settings.
 */
export interface ModelBundleDefinition {
  id: string;
  displayName: string;
  retrievalModelId: string;
  verificationModelId: string;
  version: string;
  status: "preview" | "stable" | "deprecated";
}

// id matches RETRIEVAL_MODELS[0].id deliberately — the already-planned
// API-first architecture's /api/models/{modelId}/... namespace needs no
// change, since the bundle id and the id it already uses are identical.
export const MODEL_BUNDLES: ModelBundleDefinition[] = [
  {
    id: "lumi-preview",
    displayName: "Lumi Preview",
    retrievalModelId: "lumi-preview",
    verificationModelId: "laila",
    version: "1.0",
    status: "preview",
  },
];

/** Which bundle (if any) the current pair of active settings corresponds
 * to — used by the Settings UI to render the right selection, or a
 * warning if the two settings were changed independently (outside this
 * UI) into a combination no bundle describes. */
export function resolveModelBundle(
  retrievalModelId: string,
  verificationModelId: string
): ModelBundleDefinition | null {
  return (
    MODEL_BUNDLES.find(
      (b) => b.retrievalModelId === retrievalModelId && b.verificationModelId === verificationModelId
    ) ?? null
  );
}
```

- [ ] **Step 4: Add the new module to the shared-types barrel**

In `packages/shared-types/src/index.ts`, add:

```ts
export * from "./model-bundles";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @netryx/shared-types test model-bundles`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/model-bundles.ts packages/shared-types/src/model-bundles.test.ts packages/shared-types/src/index.ts
git commit -m "feat(shared-types): add MODEL_BUNDLES registry pairing retrieval+verification models"
```

---

### Task 2: `ModelBundleRow` component

**Files:**
- Create: `apps/web/app/components/ModelBundleRow.tsx`

**Interfaces:**
- Consumes: `MODEL_BUNDLES`, `resolveModelBundle`, `ModelBundleDefinition` (Task 1); `Menu` (`./Menu`, unchanged).
- Produces: `ModelBundleRow({ retrievalModelId, verificationModelId, onChange }: { retrievalModelId: string; verificationModelId: string; onChange: (bundle: ModelBundleDefinition) => void })` — Task 3 wires this into `SettingsPanel.tsx`.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/ModelBundleRow.tsx
"use client";
import { MODEL_BUNDLES, resolveModelBundle, type ModelBundleDefinition } from "@netryx/shared-types";
import { Menu } from "./Menu";

export function ModelBundleRow({
  retrievalModelId,
  verificationModelId,
  onChange,
}: {
  retrievalModelId: string;
  verificationModelId: string;
  onChange: (bundle: ModelBundleDefinition) => void;
}) {
  const current = resolveModelBundle(retrievalModelId, verificationModelId);

  if (!current) {
    return (
      <div className="rounded-md border border-dashed border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-fg">
        La combinación actual de modelos no corresponde a ningún paquete conocido.
      </div>
    );
  }

  return (
    <Menu
      value={current.id}
      onChange={(id) => {
        const bundle = MODEL_BUNDLES.find((b) => b.id === id);
        if (bundle) onChange(bundle);
      }}
      options={MODEL_BUNDLES.map((b) => ({ value: b.id, label: b.displayName }))}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/ModelBundleRow.tsx
git commit -m "feat(web): add ModelBundleRow component"
```

---

### Task 3: Wire `ModelBundleRow` into `SettingsPanel.tsx`

**Files:**
- Modify: `apps/web/app/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `ModelBundleRow` (Task 2).

- [ ] **Step 1: Add the import**

In `apps/web/app/components/SettingsPanel.tsx`, add to the imports (alongside `SliderRow`/`CalibrationGrid`):

```ts
import { ModelBundleRow } from "./ModelBundleRow";
```

- [ ] **Step 2: Hide the `VERIFICATION_MODEL` row from the generic loop**

Change:

```tsx
                  {activeGroup.defs
                    .filter((def) => !SLIDER_KEYS.has(def.key) && !CALIBRATION_KEYS.includes(def.key))
                    .map((def) => (
```

to:

```tsx
                  {activeGroup.defs
                    .filter((def) => !SLIDER_KEYS.has(def.key) && !CALIBRATION_KEYS.includes(def.key) && def.key !== "VERIFICATION_MODEL")
                    .map((def) => (
```

- [ ] **Step 3: Special-case `RETRIEVAL_MODEL` to render `ModelBundleRow`**

Change:

```tsx
                      <div key={def.key}>
                        <span className="mb-1 block text-xs text-muted">{def.label}</span>
                        {def.isSecret ? (
                          <SecretRow display={values[def.key]} onEdit={() => setEditing(def)} />
                        ) : def.type === "enum" ? (
                          <Menu value={current(def)} onChange={(v) => set(def.key, v)}
                            options={(def.options ?? []).map((o) => ({ value: o, label: o }))} />
                        ) : (
```

to:

```tsx
                      <div key={def.key}>
                        <span className="mb-1 block text-xs text-muted">
                          {def.key === "RETRIEVAL_MODEL" ? "Modelo" : def.label}
                        </span>
                        {def.isSecret ? (
                          <SecretRow display={values[def.key]} onEdit={() => setEditing(def)} />
                        ) : def.key === "RETRIEVAL_MODEL" ? (
                          <ModelBundleRow
                            retrievalModelId={current(def)}
                            verificationModelId={dirty["VERIFICATION_MODEL"] ?? values["VERIFICATION_MODEL"] ?? ""}
                            onChange={(bundle) => {
                              set("RETRIEVAL_MODEL", bundle.retrievalModelId);
                              set("VERIFICATION_MODEL", bundle.verificationModelId);
                            }}
                          />
                        ) : def.type === "enum" ? (
                          <Menu value={current(def)} onChange={(v) => set(def.key, v)}
                            options={(def.options ?? []).map((o) => ({ value: o, label: o }))} />
                        ) : (
```

(The closing `)}` and `<input .../>` branch after it are unchanged — only the new `def.key === "RETRIEVAL_MODEL"` branch is inserted between the existing `isSecret` and `type === "enum"` branches.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run the dev stack, open `/settings` → "Modelos". Confirm: one "Modelo" dropdown showing "Lumi Preview" appears where the two separate "Retrieval model"/"Verification model" dropdowns used to be. Change it (once a second bundle exists this is testable end-to-end; with only one bundle today, confirm at least that selecting the same "Lumi Preview" option and saving writes both `RETRIEVAL_MODEL=lumi-preview` and `VERIFICATION_MODEL=laila` — check via `docker exec netryx-db psql -U netryx -d netryx_dev -c "SELECT key, value FROM system_settings WHERE key IN ('RETRIEVAL_MODEL','VERIFICATION_MODEL');"`). Confirm the restart-required warning line still appears below it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/SettingsPanel.tsx
git commit -m "feat(web): replace the two model dropdowns with one ModelBundleRow"
```

---

## Self-Review Notes

- **Spec coverage:** `MODEL_BUNDLES`/`resolveModelBundle` (Task 1); the interim Settings UI replacing both dropdowns with one, writing both settings together, and the "no matching bundle" warning state (Tasks 2-3). All spec sections covered — this is an intentionally small, additive epic per its own non-goals (no `services/inference` changes, no Epic B features).
- **Placeholder scan:** none — every step has complete, runnable code and exact commands/expected output.
- **Type consistency:** `ModelBundleDefinition`'s fields (Task 1) are used identically in Task 2's `ModelBundleRow` props and Task 3's `onChange` callback (`bundle.retrievalModelId`, `bundle.verificationModelId`) — no renamed fields anywhere.
