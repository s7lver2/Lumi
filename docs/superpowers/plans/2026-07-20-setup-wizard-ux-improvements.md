# Setup Wizard UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two independent `/setup` wizard UX improvements: (1) `CatalogModelsStep.tsx` shows which retrieval+verification release it picked and lets the operator install recommended classifiers (Wanda/Velle) directly from the same step; (2) `CredentialsStep.tsx` makes the Google Maps key fully optional, gated behind a new "I have a Google Cloud Console account" checkbox instead of blocking the wizard on a validated key.

**Architecture:** Both changes are self-contained rewrites of a single existing step component each — no new routes, no new API contracts, no shared state between the two. Task 1 adds a pure `pickRecommendedClassifiers` function (TDD, mirroring the existing `pickDefaultRelease` pattern) and switches the step's local types to the shared `apps/web/app/lib/catalog-types.ts` shapes. Task 2 rewrites `CredentialsStep.tsx`'s completion logic to be reactive instead of test-callback-only. Task 3 is a combined manual browser verification pass for both steps, since neither has (or needs) DOM-level tests per this codebase's convention.

## Global Constraints

- Classifier "most recent" = first-encountered per `modelId` in the existing bundle/release iteration order (mirrors GitHub's own newest-first release ordering) — never a benchmark comparison (`GenericClassifierBenchmark` has no accuracy figure).
- A classifier row's install status is fully independent per `modelId` and never calls `onComplete()` for the `models` wizard step — only the mandatory retrieval+verification install does, unchanged from today.
- `CatalogModelsStep.tsx` must use the shared types from `apps/web/app/lib/catalog-types.ts` (`CodeBundleCatalogRelease`, `GenericClassifierCatalogRelease`, `CatalogRelease`, `CatalogBundle`) instead of its own local narrower interfaces.
- In `CredentialsStep.tsx`, the only blocking condition is "non-empty key text that hasn't passed validation" — never "checkbox is checked" by itself, and never "key is empty" by itself. `MAPBOX_TOKEN` and the `LIMITS` grid keep their current behavior untouched.

---

### Task 1: `CatalogModelsStep.tsx` — show the recommended release, add classifier rows

**Files:**
- Modify: `apps/web/app/setup/steps/CatalogModelsStep.tsx`
- Modify: `apps/web/app/setup/steps/CatalogModelsStep.test.tsx`

**Interfaces:**
- Consumes: `CodeBundleCatalogRelease`, `GenericClassifierCatalogRelease`, `CatalogRelease`, `CatalogBundle` from `../../lib/catalog-types` (note the relative path — this file lives at `apps/web/app/setup/steps/`, two levels up from `apps/web/app/lib/`).
- Produces: `export function pickRecommendedClassifiers(bundles: CatalogBundle[]): { owner: string; repo: string; release: GenericClassifierCatalogRelease }[]` — a pure function, exported alongside the existing `pickDefaultRelease`, for the test file to import directly.

The current file declares its own local `CatalogRelease`/`CatalogBundleEntry` interfaces (lines 7-17) that only cover the `code-bundle` shape (`kind`, `tag`, `version`, `benchmark: { accuracyWithin50m }`) — this task deletes those and imports the full shared types instead, since classifier rows need `facets`, which the local interface never had.

- [ ] **Step 1: Write the failing test for `pickRecommendedClassifiers`**

Replace the full contents of `apps/web/app/setup/steps/CatalogModelsStep.test.tsx`:

```tsx
// apps/web/app/setup/steps/CatalogModelsStep.test.tsx
import { describe, it, expect } from "vitest";
import { pickDefaultRelease, pickRecommendedClassifiers } from "./CatalogModelsStep";

describe("pickDefaultRelease", () => {
  it("picks the highest-benchmark release across all bundles", () => {
    const bundles = [
      { owner: "a", repo: "r1", releases: [{ kind: "code-bundle", tag: "t1", version: "1.0", benchmark: { accuracyWithin50m: 0.7 } }] },
      { owner: "a", repo: "r2", releases: [{ kind: "code-bundle", tag: "t2", version: "1.0", benchmark: { accuracyWithin50m: 0.9 } }] },
    ];
    const picked = pickDefaultRelease(bundles as any);
    expect(picked?.repo).toBe("r2");
  });

  it("returns null when there are no releases at all", () => {
    expect(pickDefaultRelease([])).toBeNull();
  });
});

describe("pickRecommendedClassifiers", () => {
  function classifierRelease(modelId: string, tag: string) {
    return { kind: "generic-classifier", tag, modelId, version: "1.0", facets: [{ facet: "weather", hfModelId: "x", strategy: "pipeline" }], benchmark: { sampleCount: 0, ranAt: "x", vramEstimateBytes: null }, description: "", isActive: false };
  }

  it("picks the first generic-classifier release per distinct modelId, across multiple bundles", () => {
    const bundles = [
      { owner: "a", repo: "r1", releases: [classifierRelease("wanda-v1", "wanda-v1.1"), classifierRelease("wanda-v1", "wanda-v1.0")] },
      { owner: "a", repo: "r2", releases: [classifierRelease("velle-v1", "velle-v1.0")] },
    ];
    const picked = pickRecommendedClassifiers(bundles as any);
    expect(picked).toHaveLength(2);
    expect(picked.find((p) => p.release.modelId === "wanda-v1")?.release.tag).toBe("wanda-v1.1");
    expect(picked.find((p) => p.release.modelId === "velle-v1")?.release.tag).toBe("velle-v1.0");
  });

  it("ignores code-bundle releases entirely", () => {
    const bundles = [
      { owner: "a", repo: "r1", releases: [{ kind: "code-bundle", tag: "t1", version: "1.0", benchmark: { accuracyWithin50m: 0.9 } }, classifierRelease("wanda-v1", "wanda-v1.0")] },
    ];
    const picked = pickRecommendedClassifiers(bundles as any);
    expect(picked).toHaveLength(1);
    expect(picked[0].release.modelId).toBe("wanda-v1");
  });

  it("returns [] when there are no classifier releases", () => {
    const bundles = [{ owner: "a", repo: "r1", releases: [{ kind: "code-bundle", tag: "t1", version: "1.0", benchmark: { accuracyWithin50m: 0.9 } }] }];
    expect(pickRecommendedClassifiers(bundles as any)).toEqual([]);
  });

  it("never lets a later release for an already-seen modelId replace the first one picked", () => {
    const bundles = [
      { owner: "a", repo: "r1", releases: [classifierRelease("wanda-v1", "wanda-v1.5")] },
      { owner: "a", repo: "r2", releases: [classifierRelease("wanda-v1", "wanda-v1.9")] },
    ];
    const picked = pickRecommendedClassifiers(bundles as any);
    expect(picked).toHaveLength(1);
    expect(picked[0].release.tag).toBe("wanda-v1.5");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/setup/steps/CatalogModelsStep.test.tsx`
Expected: FAIL — `pickRecommendedClassifiers is not exported` (or similar), since `CatalogModelsStep.tsx` doesn't define it yet.

- [ ] **Step 3: Rewrite `CatalogModelsStep.tsx`**

Replace the full contents of `apps/web/app/setup/steps/CatalogModelsStep.tsx`:

```tsx
// apps/web/app/setup/steps/CatalogModelsStep.tsx
"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { fadeRise } from "../../lib/motion";
import { fetchJson } from "../../lib/fetch-json";
import type { CatalogBundle, CodeBundleCatalogRelease, GenericClassifierCatalogRelease } from "../../lib/catalog-types";

/** Auto-selects the release with the highest accuracyWithin50m across every
 * bundle the marketplace currently offers — used so setup can install
 * something sensible by default without making the operator pick, while
 * still showing what was picked and why. Pure function so it's unit
 * testable without rendering anything (this repo's convention: no
 * DOM/component-render tests). */
export function pickDefaultRelease(
  bundles: CatalogBundle[]
): { owner: string; repo: string; release: CodeBundleCatalogRelease } | null {
  let best: { owner: string; repo: string; release: CodeBundleCatalogRelease } | null = null;
  for (const bundle of bundles) {
    for (const release of bundle.releases) {
      // Setup only ever auto-installs the mandatory retrieval/verification
      // model — a generic-classifier release (Wanda/Velle) is always an
      // optional, later Ajustes → Modelos install (spec: docs/superpowers/
      // specs/2026-07-20-unified-model-catalog-design.md, "Setup wizard"),
      // regardless of what number its own benchmark shape happens to carry.
      if (release.kind !== "code-bundle") continue;
      if (!best || release.benchmark.accuracyWithin50m > best.release.benchmark.accuracyWithin50m) {
        best = { owner: bundle.owner, repo: bundle.repo, release };
      }
    }
  }
  return best;
}

/** One recommended release per distinct classifier modelId (Wanda, Velle,
 * any future one) across every bundle — the first generic-classifier
 * release encountered for that modelId, since listReleasesForRepo's
 * GitHub API call already returns releases newest-first (spec: docs/
 * superpowers/specs/2026-07-20-setup-recommended-models-design.md). No
 * benchmark comparison: GenericClassifierBenchmark has no accuracy figure
 * to rank by. These are always optional — never gate onComplete(). */
export function pickRecommendedClassifiers(
  bundles: CatalogBundle[]
): { owner: string; repo: string; release: GenericClassifierCatalogRelease }[] {
  const seen = new Set<string>();
  const picked: { owner: string; repo: string; release: GenericClassifierCatalogRelease }[] = [];
  for (const bundle of bundles) {
    for (const release of bundle.releases) {
      if (release.kind !== "generic-classifier") continue;
      if (seen.has(release.modelId)) continue;
      seen.add(release.modelId);
      picked.push({ owner: bundle.owner, repo: bundle.repo, release });
    }
  }
  return picked;
}

type ClassifierStatus = "idle" | "installing" | "done" | "error";

export function CatalogModelsStep({ onComplete }: { onComplete: () => void }) {
  const [bundles, setBundles] = useState<CatalogBundle[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "installing" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [classifierStatus, setClassifierStatus] = useState<Record<string, ClassifierStatus>>({});

  useEffect(() => {
    fetchJson<{ bundles: CatalogBundle[] }>("/api/model-catalog").then((r) => {
      setBundles(r.data?.bundles ?? []);
      setStatus("idle");
    });
  }, []);

  const picked = pickDefaultRelease(bundles);
  const recommendedClassifiers = pickRecommendedClassifiers(bundles);

  async function install() {
    if (!picked) {
      setError("No hay ninguna versión disponible en el marketplace todavía.");
      setStatus("error");
      return;
    }
    setStatus("installing");
    const { ok, data } = await fetchJson<{ error?: string }>("/api/model-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: picked.owner, repo: picked.repo, tag: picked.release.tag }),
    });
    if (!ok) {
      setError(data?.error ?? "No se pudo instalar el modelo");
      setStatus("error");
      return;
    }
    setStatus("done");
    onComplete();
  }

  async function installClassifier(item: { owner: string; repo: string; release: GenericClassifierCatalogRelease }) {
    setClassifierStatus((s) => ({ ...s, [item.release.modelId]: "installing" }));
    const { ok } = await fetchJson<{ error?: string }>("/api/model-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: item.owner, repo: item.repo, tag: item.release.tag }),
    });
    setClassifierStatus((s) => ({ ...s, [item.release.modelId]: ok ? "done" : "error" }));
  }

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-0.5 text-[15px] font-medium text-fg">Modelo desde el marketplace</div>
      <p className="mb-4 text-xs text-muted">
        Instala un modelo de recuperación + verificación publicado en tu catálogo. Podrás desinstalarlo o cambiarlo
        más tarde desde Ajustes → Modelos.
      </p>

      {status === "loading" && <p className="text-xs text-muted">Consultando el marketplace…</p>}

      {status !== "loading" && bundles.length === 0 && (
        <p className="text-xs text-warning-fg">
          No hay ningún catálogo configurado todavía (falta GITHUB_TOKEN/MODEL_CATALOG_REPO en Ajustes) — puedes
          completar la instalación más tarde desde Ajustes → Modelos.
        </p>
      )}

      {picked && status !== "done" && (
        <p className="mb-2 text-xs text-muted">
          Recomendado: <b className="text-fg">v{picked.release.version}</b> —{" "}
          {Math.round(picked.release.benchmark.accuracyWithin50m * 100)}% ≤ 50m (mejor precisión disponible)
        </p>
      )}

      {picked && status !== "done" && (
        <button
          onClick={install}
          disabled={status === "installing"}
          className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
        >
          {status === "installing" ? "Instalando…" : "Instalar modelo recomendado"}
        </button>
      )}

      {status === "done" && <p className="text-xs text-fg">Modelo instalado.</p>}
      {error && <p className="mt-2 text-xs text-danger-fg">{error}</p>}

      {picked && recommendedClassifiers.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="mb-0.5 text-xs font-medium text-fg">Clasificadores disponibles (opcional)</div>
          <p className="mb-2 text-[11px] text-muted">Puedes instalarlos ahora o más tarde desde Ajustes → Modelos.</p>
          <div className="space-y-1.5">
            {recommendedClassifiers.map((item) => {
              const st = classifierStatus[item.release.modelId] ?? "idle";
              return (
                <div key={item.release.modelId} className="flex items-center justify-between text-xs text-muted">
                  <span>
                    <b className="text-fg">{item.release.modelId}</b> · {item.release.facets.map((f) => f.facet).join(", ")}
                  </span>
                  <button
                    onClick={() => installClassifier(item)}
                    disabled={st === "installing" || st === "done"}
                    className="rounded-md border border-white/20 bg-white/[.06] px-3 py-1 text-[11px] text-fg hover:bg-white/10 disabled:opacity-50"
                  >
                    {st === "installing" ? "Instalando…" : st === "done" ? "Instalado" : st === "error" ? "Reintentar" : "Instalar"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/setup/steps/CatalogModelsStep.test.tsx`
Expected: PASS (7 tests: 2 existing `pickDefaultRelease` + 5 new `pickRecommendedClassifiers`)

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors. This step's rewrite switched from local narrow interfaces to the shared `catalog-types.ts` shapes — confirm nothing else in the file (or any caller) still assumes the old narrower shape.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/setup/steps/CatalogModelsStep.tsx apps/web/app/setup/steps/CatalogModelsStep.test.tsx
git commit -m "feat(web): show recommended release + installable classifiers in setup's models step"
```

---

### Task 2: `CredentialsStep.tsx` — make the Google Maps key optional

**Files:**
- Modify: `apps/web/app/setup/steps/CredentialsStep.tsx`

**Interfaces:**
- Consumes: unchanged props `{ values: Record<string, string>; onChange: (k: string, v: string) => void; onComplete: () => void }`, and the existing `POST /api/setup/test-key` contract (`{ key: string }` → `{ ok: boolean; error?: string }`).
- Produces: no change to this component's exported signature — `SetupWizard.tsx`'s existing `<CredentialsStep values={collected} onChange={setField} onComplete={() => mark("credentials")} />` call site (line 55) needs no changes.

This task has no test file — matches this codebase's convention (no DOM/component-render tests for setup steps with only UI/interaction logic, same as today's `CredentialsStep.tsx`, `SystemPanel.tsx`, `ModelosSection.tsx`). Verification is manual (Step 3 below).

- [ ] **Step 1: Rewrite `CredentialsStep.tsx`**

Replace the full contents of `apps/web/app/setup/steps/CredentialsStep.tsx`:

```tsx
// apps/web/app/setup/steps/CredentialsStep.tsx
"use client";
import { useEffect, useState } from "react";
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
  const [showGoogleKey, setShowGoogleKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const google = values.GOOGLE_MAPS_API_KEY ?? "";

  useEffect(() => {
    // The only real gate is "non-empty key text that hasn't passed
    // validation yet" — an empty key (hidden or revealed-but-empty) is
    // always fine, since Street View capture is optional (spec: docs/
    // superpowers/specs/2026-07-20-setup-credentials-step-google-optional-
    // design.md). Typing invalidates `result` via onChange below, which
    // correctly un-completes the step until it's cleared again or retested.
    if (google === "" || result?.ok === true) onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [google, result]);

  async function test() {
    setTesting(true); setResult(null);
    const { data } = await fetchJson<{ ok: boolean; error?: string }>("/api/setup/test-key", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: google }),
    });
    setTesting(false);
    if (data?.ok) setResult({ ok: true, msg: "Clave válida · Street View respondió OK" });
    else setResult({ ok: false, msg: data?.error ?? "La clave no es válida" });
  }

  const field = "h-[38px] w-full rounded-lg border border-white/12 bg-white/5 px-3 text-sm text-fg outline-none focus:border-white/30";

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show">
      <div className="mb-0.5 text-[15px] font-medium text-fg">Credenciales</div>
      <p className="mb-4 text-xs text-muted">Se guardan cifradas y se aplican al terminar. Nada se escribe hasta confirmar.</p>

      <label className="mb-1.5 flex items-start gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={showGoogleKey}
          onChange={(e) => setShowGoogleKey(e.target.checked)}
          className="mt-0.5"
        />
        <span>Tengo cuenta en Google Cloud Console y quiero configurarla ahora</span>
      </label>

      {!showGoogleKey && (
        <p className="mb-5 text-xs text-muted">
          La clave de Google Street View Static API solo hace falta si vas a capturar tus propias áreas — no es
          necesaria para instalar datasets ya publicados. Podrás añadirla más tarde desde Ajustes si cambias de idea.
        </p>
      )}

      {showGoogleKey && (
        <>
          <label className="mb-1.5 block text-xs text-muted">Google Street View Static API key</label>
          <div className="mb-1.5 flex items-center gap-2">
            <input value={google} onChange={(e) => { onChange("GOOGLE_MAPS_API_KEY", e.target.value); setResult(null); }} className={field} placeholder="AIza…" />
            <button onClick={test} disabled={!google || testing} className="h-[38px] flex-none rounded-lg border border-white/20 bg-white/[.06] px-3.5 text-xs text-fg hover:bg-white/10 disabled:opacity-50">{testing ? "Probando…" : "Probar"}</button>
          </div>
          {result && <p className={`mb-5 flex items-center gap-1.5 text-xs ${result.ok ? "text-fg" : "text-danger-fg"}`}>{result.ok ? "✓" : "✕"} {result.msg}</p>}
        </>
      )}

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
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/setup/steps/CredentialsStep.tsx
git commit -m "feat(web): make Google Maps key optional in setup, gated behind a checkbox"
```

---

### Task 3: Manual verification of both steps

**Files:** none (verification only).

**Interfaces:** none — this task exercises Task 1 and Task 2's UI end to end in a real browser.

- [ ] **Step 1: Start the dev server**

Run: `cd apps/web && npm run dev` (or this repo's existing dev command) and open `/setup`.

- [ ] **Step 2: Verify the models step (Task 1)**

1. Advance to the "Modelo desde el marketplace" step.
2. Confirm the "Recomendado: vX.Y — Z% ≤ 50m" line appears above the install button, matching whatever `pickDefaultRelease` actually picks.
3. If the catalog has any `generic-classifier` releases (Wanda/Velle), confirm a "Clasificadores disponibles (opcional)" section appears below, one row per distinct `modelId`, each with its own Instalar button.
4. Click Instalar on a classifier row — confirm it goes Instalando… → Instalado, independently of the retrieval install's own state, and does **not** enable "Siguiente" by itself.
5. Confirm installing the retrieval+verification bundle still enables "Siguiente" exactly as before.
6. If no classifiers exist in the catalog, confirm the classifiers section doesn't render at all (no empty box).

- [ ] **Step 3: Verify the credentials step (Task 2)**

1. Advance to the "Credenciales" step — confirm the checkbox is unchecked, the API key input is hidden, and "Siguiente" is already enabled.
2. Check the box — input appears; "Siguiente" stays enabled (still empty).
3. Type an invalid key and click "Probar" — fails; "Siguiente" becomes disabled.
4. Type a valid key (or use a known-good test key) and click "Probar" — passes; "Siguiente" re-enables.
5. Clear the field entirely after a passing test — "Siguiente" stays enabled.
6. Uncheck the box after entering a key — confirm the typed value isn't lost (unchecking only hides the input) and "Siguiente" is still enabled either way.
7. Confirm `MAPBOX_TOKEN` and the `LIMITS` grid still behave exactly as before.

- [ ] **Step 4: Commit** (only if Step 2/3 uncovered fixes; otherwise nothing to commit — this task is verification-only)

If manual verification passes cleanly with no code changes needed, there is nothing to commit for this task.
