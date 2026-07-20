# Setup "Modelo desde el marketplace" step — show recommendations — Design

## Context

`apps/web/app/setup/steps/CatalogModelsStep.tsx` already picks a default retrieval+verification release (`pickDefaultRelease()`, the highest `accuracyWithin50m` code-bundle release across every catalog bundle) and installs it when the operator clicks "Instalar modelo recomendado" — but never shows *which* release that is, or why it was picked, until after installing. The catalog can also carry `generic-classifier` releases (Wanda, Velle, and any future classifier) which this step ignores entirely today — those are only ever installable later, manually, from Ajustes → Modelos.

This design makes both recommendations visible and, for classifiers, directly actionable from this same step.

## What changes

### 1. Show the picked retrieval+verification release before installing

Before the "Instalar modelo recomendado" button, render what `pickDefaultRelease(bundles)` returned (if anything): its version and benchmark, e.g.

> Recomendado: **v1.1** — 89% ≤ 50m (mejor precisión disponible)

This is pure presentation — `pickDefaultRelease`'s selection logic and the install flow (`POST /api/model-catalog/install`, gating `onComplete()`) are unchanged.

### 2. List classifiers as optional, independently-installable rows

Below the retrieval section, a new "Clasificadores disponibles" block. Compute one recommended release per distinct `modelId` across every bundle's `generic-classifier` releases:

```ts
export function pickRecommendedClassifiers(
  bundles: CatalogBundleEntry[]
): { owner: string; repo: string; release: GenericClassifierRelease }[] {
  const seen = new Set<string>();
  const picked: { owner: string; repo: string; release: GenericClassifierRelease }[] = [];
  for (const bundle of bundles) {
    for (const release of bundle.releases) {
      if (release.kind !== "generic-classifier") continue;
      if (seen.has(release.modelId)) continue; // first occurrence = most recent (GitHub's release list is newest-first)
      seen.add(release.modelId);
      picked.push({ owner: bundle.owner, repo: bundle.repo, release });
    }
  }
  return picked;
}
```

"Most recent" is GitHub's own release ordering (`listReleasesForRepo`'s API call returns releases newest-created-first, unchanged by this app) — the first `generic-classifier` release encountered for a given `modelId`, scanning bundles and releases in the order the API already returns them. No benchmark comparison: generic-classifier releases carry `GenericClassifierBenchmark` (sample count + VRAM only), not an accuracy figure to rank by, matching the spec that introduced them.

Each row shows the classifier's `modelId` (e.g. `wanda-v1`), its facets (same `f.facet` list `ModelosSection.tsx` already renders), and its own Instalar/Instalando/Instalado button — calling `POST /api/model-catalog/install` with `{ owner, repo, tag }` exactly like the retrieval bundle's install call, but tracked with its own per-row status state (a `Record<modelId, "idle" | "installing" | "done" | "error">`), independent of the retrieval install's status and of each other. A classifier row's status never calls `onComplete()` — the step's completion gate stays exactly what it is today (the mandatory retrieval+verification install only).

## Types

`CatalogModelsStep.tsx` currently declares its own narrow `CatalogRelease`/`CatalogBundleEntry` interfaces. Replace them with the full shapes already defined in `apps/web/app/lib/catalog-types.ts` (`CodeBundleCatalogRelease`, `GenericClassifierCatalogRelease`, `CatalogRelease`, `CatalogBundle`) — this step needs `facets` for the classifier rows, which the local interface doesn't carry, and reusing the shared types avoids re-declaring benchmark/facet shapes a third time in the codebase.

## UI

```
Modelo desde el marketplace
Instala un modelo de recuperación + verificación publicado en tu catálogo...

Recomendado: v1.1 — 89% ≤ 50m (mejor precisión disponible)
[Instalar modelo recomendado]

Clasificadores disponibles (opcional)
Puedes instalarlos ahora o más tarde desde Ajustes → Modelos.

  wanda-v1 · weather, season          [Instalar]
  velle-v1 · make, model               [Instalado]
```

If `pickDefaultRelease` returns `null` (no code-bundle release at all), the existing "no hay ningún catálogo configurado" warning still applies and the classifiers block is skipped too (nothing to recommend either way — same empty-catalog condition covers both).

If there are no `generic-classifier` releases in the catalog at all, the "Clasificadores disponibles" block doesn't render (no empty section for nothing to show).

## Testing

`CatalogModelsStep.test.tsx` already unit-tests `pickDefaultRelease` as a pure function (this repo's convention: no DOM/component-render tests for setup steps). Add equivalent pure-function tests for `pickRecommendedClassifiers`:

- Picks the first `generic-classifier` release per distinct `modelId`, across multiple bundles.
- Ignores `code-bundle` releases entirely.
- Returns `[]` when there are no classifier releases.
- Doesn't let a later, differently-ordered release for an already-seen `modelId` replace the first one picked.

## Global Constraints

- Classifier "most recent" = first-encountered in the existing bundle/release iteration order (which mirrors GitHub's own newest-first release ordering) — never a benchmark comparison, since `GenericClassifierBenchmark` has no accuracy figure.
- A classifier row's install status is fully independent per `modelId` and never affects `done[current]`/`onComplete()` for this wizard step — only the mandatory retrieval+verification install does.
- Reuse `apps/web/app/lib/catalog-types.ts`'s existing types; do not re-declare local narrower interfaces for releases/bundles in this file.
