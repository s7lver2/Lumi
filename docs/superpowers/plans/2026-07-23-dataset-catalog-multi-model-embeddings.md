# Dataset Catalog Multi-Model Embeddings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Datasets carry embeddings for multiple retrieval models (a generic `models[]`/`embeddings{}` manifest shape, not one hardcoded field per model), tag the catalog UI with every model a dataset supports, and let the publish flow optionally generate a second model's embeddings before bundling.

**Architecture:** `DatasetManifest.model: ModelTag` becomes `models: ModelTag[]`; each image/point's `embedding: number[] | null` becomes `embeddings: Record<string, number[] | null>` keyed by model id. A new `packages/shared-types/src/embedding-columns.ts` registry (`EMBEDDING_COLUMN_BY_MODEL`) centralizes which Postgres column holds which model's vectors — replacing scattered `if (modelId === "lumi-2")` branches with one lookup table, so a future model needs one migration + one registry line, not a hunt through files. Old single-model manifests are normalized to the new shape on import for backward compatibility.

**Tech Stack:** TypeScript (apps/web, packages/shared-types), Postgres/pgvector.

## Global Constraints

- No tests in this plan — every task ends with implementation + a typecheck step + a commit. Do not write Vitest tests anywhere in this plan.
- **Dependency on the Lumi 2 plan:** Tasks 5-6 of this plan need `indexed_images.embedding_lumi2`/`indexed_points.embedding_lumi2` (added by `docs/superpowers/plans/2026-07-22-lumi-2-retrieval-backbone.md`'s Task 1 migration) and that plan's `db-queries.ts`/`retrieval.ts` changes to exist first. If that work hasn't landed in this branch yet when you reach Task 5, merge/rebase it in before continuing (do not reimplement the migration or duplicate its columns) — Tasks 1-4 have no such dependency and can proceed regardless.
- Commits use `git add <specific files>`, never `git add -A` or `git add .`.

---

### Task 1: Generic manifest types + validation

**Files:**
- Modify: `packages/shared-types/src/models.ts` (no change expected — read-only dependency, listed for context)
- Modify: `apps/web/lib/datasets/manifest.ts`

**Interfaces:**
- Produces: `DatasetManifest.models: ModelTag[]`, `DatasetManifestImage.embeddings: Record<string, number[] | null>`, `DatasetManifestPoint.embeddings: Record<string, number[] | null>` — every later task in this plan depends on these exact field names and shapes.

- [ ] **Step 1: Change the manifest interfaces**

In `apps/web/lib/datasets/manifest.ts`, change:

```ts
export interface DatasetManifestImage {
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  streetViewDate: string | null;
  embedding: number[] | null;
  hasFile: boolean;
}
```

to:

```ts
export interface DatasetManifestImage {
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  streetViewDate: string | null;
  /** Keyed by model id (e.g. "lumi-preview", "lumi-2") — absent or null
   * means this dataset doesn't include that model's embedding. */
  embeddings: Record<string, number[] | null>;
  hasFile: boolean;
}
```

Apply the identical change to `DatasetManifestPoint` (drop its `embedding: number[] | null` field, add the same `embeddings: Record<string, number[] | null>`).

Change:

```ts
export interface DatasetManifest {
  version: number;
  exportedAt: string;
  model: ModelTag;
  areas: DatasetManifestArea[];
}
```

to:

```ts
export interface DatasetManifest {
  version: number;
  exportedAt: string;
  models: ModelTag[];
  areas: DatasetManifestArea[];
}
```

- [ ] **Step 2: Update `validateImage`/`validatePoint`/`validateArea`/`validateDatasetManifest`**

Change `validateImage`'s signature from `(imgData, areaIndex, imgIndex, embeddingDim: number)` to `(imgData, areaIndex, imgIndex, modelTags: ModelTag[])`. Replace its embedding validation block:

```ts
  if (img.embedding !== null && !Array.isArray(img.embedding)) {
    throw new Error(`manifest.areas[${areaIndex}].images[${imgIndex}].embedding must be an array or null`);
  }
  if (Array.isArray(img.embedding) && img.embedding.length !== embeddingDim) {
    throw new Error(
      `manifest.areas[${areaIndex}].images[${imgIndex}].embedding has length ${img.embedding.length}, expected ${embeddingDim}`
    );
  }
```

with:

```ts
  const rawEmbeddings = (img.embeddings ?? {}) as Record<string, unknown>;
  if (typeof rawEmbeddings !== "object" || rawEmbeddings === null || Array.isArray(rawEmbeddings)) {
    throw new Error(`manifest.areas[${areaIndex}].images[${imgIndex}].embeddings must be an object`);
  }
  const embeddings: Record<string, number[] | null> = {};
  for (const [modelId, value] of Object.entries(rawEmbeddings)) {
    const tag = modelTags.find((t) => t.id === modelId);
    if (!tag) {
      throw new Error(`manifest.areas[${areaIndex}].images[${imgIndex}].embeddings has an entry for unknown model id ${JSON.stringify(modelId)}`);
    }
    if (value !== null && !Array.isArray(value)) {
      throw new Error(`manifest.areas[${areaIndex}].images[${imgIndex}].embeddings[${modelId}] must be an array or null`);
    }
    if (Array.isArray(value) && value.length !== tag.embeddingDim) {
      throw new Error(`manifest.areas[${areaIndex}].images[${imgIndex}].embeddings[${modelId}] has length ${value.length}, expected ${tag.embeddingDim}`);
    }
    embeddings[modelId] = (value as number[] | null) ?? null;
  }
```

and change the function's final return to use `embeddings` (the built object above) instead of the old single `embedding: (img.embedding as number[] | null) ?? null` line.

Apply the identical transformation to `validatePoint`.

In `validateArea`, change its signature from `(areaData, areaIndex, embeddingDim: number)` to `(areaData, areaIndex, modelTags: ModelTag[])`, and update its two calls (`validateImage(img, areaIndex, i, embeddingDim)` → `validateImage(img, areaIndex, i, modelTags)`, same for `validatePoint`).

In `validateDatasetManifest`, replace the single-`model` validation block (`if (typeof raw.model !== "object" ...) ... const modelTag: ModelTag = {...}`) with a loop validating `raw.models` as a non-empty array, each entry validated the same way the old single `model` was (same three field checks: `id` in `knownModelIds`, non-empty string `version`, positive-integer `embeddingDim`), collecting them into `modelTags: ModelTag[]`. Change the final return's `model: modelTag` to `models: modelTags`, and its `areas: raw.areas.map((area, i) => validateArea(area, i, modelTags.embeddingDim))` to `areas: raw.areas.map((area, i) => validateArea(area, i, modelTags))`.

- [ ] **Step 3: Update `DatasetMetadata`/`buildDatasetMetadata`**

Change `DatasetMetadata.model: ModelTag` to `models: ModelTag[]`, and `buildDatasetMetadata`'s `model: ModelTag` parameter to `models: ModelTag[]`, updating its body to store `models` instead of `model`.

- [ ] **Step 4: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit 2>&1 | head -60
```

Expected: errors at every OTHER file in `apps/web/lib/datasets/` and its callers that still reference the old singular `model`/`embedding` fields — this is expected at this point in the plan; Tasks 2-4 fix them. Confirm the errors are confined to `apps/web/lib/datasets/*` and its direct callers (`apps/web/app/api/datasets/*`, `apps/web/app/api/model-catalog/publish/route.ts` if it touches this path) before proceeding, not unrelated files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/datasets/manifest.ts
git commit -m "feat(datasets): generalize manifest to models[]/embeddings{} for multi-model support"
```

---

### Task 2: Compatibility check + active-model tagging

**Files:**
- Modify: `apps/web/lib/datasets/compatibility.ts`
- Modify: `apps/web/lib/datasets/active-model.ts`

**Interfaces:**
- Consumes: `ModelTag`, `DatasetManifest.models[]` (Task 1).
- Produces: `isCompatible(datasetModels: ModelTag[], activeModel: ModelTag): boolean`; `getActiveModelTags(modelIds: string[]): Promise<ModelTag[]>` (renamed/pluralized — Task 4's publish route calls this with whichever models the user checked).

- [ ] **Step 1: Update `isCompatible`**

```ts
// apps/web/lib/datasets/compatibility.ts
import type { ModelTag } from "./manifest";

/**
 * A dataset release is only safe to import with its embeddings intact when
 * BOTH the model id and its version match exactly for at least one of the
 * dataset's tagged models — embeddingDim is never compared on its own,
 * because two unrelated models can share a dimension while producing
 * totally incompatible embedding spaces (spec's Security section).
 */
export function isCompatible(datasetModels: ModelTag[], activeModel: ModelTag): boolean {
  return datasetModels.some((m) => m.id === activeModel.id && m.version === activeModel.version);
}
```

- [ ] **Step 2: Add a plural model-tag resolver**

```ts
// apps/web/lib/datasets/active-model.ts — add alongside the existing getActiveModelTag
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { getSettingsRepo } from "../settings-repo";
import type { ModelTag } from "./manifest";

export async function getActiveModelTag(): Promise<ModelTag> {
  const modelId = (await getSettingsRepo().getSetting("RETRIEVAL_MODEL")) ?? "lumi-preview";
  const entry = RETRIEVAL_MODELS.find((m) => m.id === modelId);
  if (!entry) {
    throw new Error(`Active RETRIEVAL_MODEL "${modelId}" is not in the local model registry`);
  }
  return { id: entry.id, version: entry.version, embeddingDim: entry.embeddingDim };
}

/** Resolves a list of model ids (e.g. ["lumi-preview", "lumi-2"] from a
 * publish-flow checkbox selection) to their full {id, version, embeddingDim}
 * tags, for stamping into a manifest's `models[]`. */
export function resolveModelTags(modelIds: string[]): ModelTag[] {
  return modelIds.map((id) => {
    const entry = RETRIEVAL_MODELS.find((m) => m.id === id);
    if (!entry) throw new Error(`Model id "${id}" is not in the local model registry`);
    return { id: entry.id, version: entry.version, embeddingDim: entry.embeddingDim };
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit 2>&1 | head -60
```

Expected: fewer errors than Task 1 Step 4 — the remaining ones are in `export-bundle.ts`, its callers, and the install/parse path, fixed in Tasks 3-4.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/datasets/compatibility.ts apps/web/lib/datasets/active-model.ts
git commit -m "feat(datasets): support multi-model compatibility checks and tag resolution"
```

---

### Task 3: Backward-compatible import of old single-model manifests

**Files:**
- Modify: `apps/web/lib/datasets/parse-manifest-buffer.ts`
- Modify: `apps/web/lib/datasets/validate-bundle.ts`

**Interfaces:**
- Consumes: Task 1's new `DatasetManifest` shape.
- Produces: any manifest JSON (old singular `model`/`embedding` shape or new plural shape) normalizes to the new shape before `validateDatasetManifest` runs.

- [ ] **Step 1: Read both files' current full content fresh**

This plan's earlier research read `manifest.ts` in full but not `parse-manifest-buffer.ts`/`validate-bundle.ts` — read both now to find exactly where raw parsed JSON first reaches `validateDatasetManifest`, since that's the single choke point where old-shape normalization must happen.

- [ ] **Step 2: Add the normalization step**

At that choke point, before calling `validateDatasetManifest`, add a small normalization: if the raw parsed object has a `model` key (singular, old shape) and no `models` key, rewrite it in place to `{ ...raw, models: [raw.model] }` and delete `raw.model`; for each area's each image/point, if it has an `embedding` key (singular) and no `embeddings` key, rewrite it to `{ ...entry, embeddings: { [raw.model.id]: entry.embedding } }` (using the old manifest's single model id as the one key) and delete `entry.embedding`. Write this as a small exported function (e.g. `normalizeLegacyManifest(raw: unknown): unknown`) in `manifest.ts` itself (co-located with the types it normalizes toward), called from wherever Step 1 found the choke point, immediately before `validateDatasetManifest`.

- [ ] **Step 3: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit 2>&1 | head -60
```

Expected: remaining errors confined to `export-bundle.ts` and its callers (Task 4).

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/datasets/manifest.ts apps/web/lib/datasets/parse-manifest-buffer.ts apps/web/lib/datasets/validate-bundle.ts
git commit -m "feat(datasets): normalize legacy single-model manifests on import"
```

---

### Task 4: Export/publish flow — multi-model bundling

**Files:**
- Modify: `apps/web/lib/datasets/export-bundle.ts`
- Modify: whatever route calls `buildAreasZip` (read `apps/web/app/api/areas/export/route.ts` and the dataset-catalog publish route fresh to find both call sites before editing)

**Interfaces:**
- Consumes: Task 1's manifest shape, Task 2's `resolveModelTags`.
- Produces: `buildAreasZip(pool, areaIds, modelIds: string[])` (was `model: ModelTag` singular) — queries every requested model's embedding column per area and builds the new `embeddings{}` shape per entry.

- [ ] **Step 1: Update `serializeManifest`'s type and `models` field**

Change its `payload` parameter type's `model: ModelTag` to `models: ModelTag[]`, and its manifest-header string-building line from `"model":${JSON.stringify(payload.model)}` to `"models":${JSON.stringify(payload.models)}`.

- [ ] **Step 2: Update `buildAreasZip`'s signature and embedding query**

Change the signature from `buildAreasZip(pool: Pool, areaIds: string[], model: ModelTag): Promise<Uint8Array>` to `buildAreasZip(pool: Pool, areaIds: string[], modelIds: string[]): Promise<Uint8Array>`. At the top of the function, resolve `const modelTags = resolveModelTags(modelIds);` (import from `./active-model`). For each `modelId` in `modelIds`, look up its Postgres column via `EMBEDDING_COLUMN_BY_MODEL[modelId]` (Task 5 introduces this registry — if Task 5 hasn't run yet in your execution order, inline a local two-branch equivalent here temporarily and note it needs replacing once Task 5's registry exists; do not block this task on Task 5).

Change the images/points SQL to select every requested model's column as its own aliased text column, e.g. for `modelIds = ["lumi-preview", "lumi-2"]`:

```sql
SELECT pano_id, heading, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
       street_view_date, embedding::text AS embedding_lumi_preview_text,
       embedding_lumi2::text AS embedding_lumi2_text, image_path
FROM indexed_images WHERE area_id = $1
```

(built dynamically from `modelIds`, not hardcoded to exactly these two — construct the `SELECT` column list by mapping each `modelId` to `` `${column}::text AS ${modelId.replace(/-/g, "_")}_text` `` and joining with commas, then read back each row's corresponding aliased field per model when building `imageEntries`/`pointEntries`). Build each entry's `embeddings` object as `Object.fromEntries(modelIds.map(id => [id, parseVector(row[`${id.replace(/-/g,"_")}_text`])]))`.

- [ ] **Step 3: Update the calling routes**

At both call sites found in this task's setup step, change whatever single `model: ModelTag` value they currently pass to `buildAreasZip` into a `modelIds: string[]` — for the plain personal-backup export route, this is just `[activeModel.id]` (unchanged behavior, one model); for the dataset-catalog publish route, this becomes `checkedModelIds` from a new request body field (e.g. `body.includeModelIds: string[]`, defaulting to `[activeModelId]` if the field is absent, so existing publish requests without this new field behave exactly as before).

- [ ] **Step 4: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/datasets/export-bundle.ts apps/web/app/api/areas/export/route.ts
git commit -m "feat(datasets): bundle embeddings for every requested model at export/publish time"
```

(Add the dataset-catalog publish route file to this same commit if it's a separate file from `areas/export/route.ts`.)

---

### Task 5: Central embedding-column registry (replaces scattered ifs)

**Files:**
- Create: `packages/shared-types/src/embedding-columns.ts`
- Modify: `packages/shared-types/src/index.ts`
- Modify: `apps/worker/src/db-queries.ts` (from the Lumi 2 plan — see this plan's Global Constraints dependency note)
- Modify: `apps/web/lib/search/retrieval.ts` (same dependency)
- Modify: `apps/web/lib/search/persist.ts` (same dependency)

**Interfaces:**
- Produces: `EMBEDDING_COLUMN_BY_MODEL: Record<string, string>`, `embeddingColumnFor(modelId: string): string` — Task 4's temporary inline branch (if used) gets replaced by this; the Lumi 2 plan's local `embeddingColumn()` helpers in `db-queries.ts`/`retrieval.ts` get replaced by this shared one.

- [ ] **Step 1: Confirm the Lumi 2 plan's work has landed**

Check `apps/worker/src/db-queries.ts` and `apps/web/lib/search/retrieval.ts` for a local `embeddingColumn(retrievalModelId)` function (added by `docs/superpowers/plans/2026-07-22-lumi-2-retrieval-backbone.md`'s Task 4/5). If absent, merge/rebase that plan's branch in first (per this plan's Global Constraints) — do not proceed with Steps 2-4 until those functions exist to replace.

- [ ] **Step 2: Write the shared registry**

```ts
// packages/shared-types/src/embedding-columns.ts
/** Central map of retrieval model id -> the Postgres column that holds its
 * embeddings (on indexed_images/indexed_points; searches uses the "query_"
 * prefixed sibling of the same name). pgvector requires one fixed
 * dimension per column, so a new model always needs its own column added
 * via migration — this registry is what makes wiring that new column into
 * the rest of the codebase a one-line change instead of a hunt through
 * scattered `if (modelId === "...")` branches. */
export const EMBEDDING_COLUMN_BY_MODEL: Record<string, string> = {
  "lumi-preview": "embedding",
  "lumi-2": "embedding_lumi2",
};

export function embeddingColumnFor(modelId: string): string {
  const column = EMBEDDING_COLUMN_BY_MODEL[modelId];
  if (!column) throw new Error(`No embedding column registered for model id "${modelId}"`);
  return column;
}
```

- [ ] **Step 3: Export it from the package barrel**

Add `export * from "./embedding-columns";` to `packages/shared-types/src/index.ts` (alongside its existing exports).

- [ ] **Step 4: Replace the two local helpers with this shared one**

In `apps/worker/src/db-queries.ts`, delete the local `embeddingColumn(retrievalModelId)` function and its `"embedding" | "embedding_lumi2"` return type; replace its call sites with `embeddingColumnFor(retrievalModelId)` imported from `@netryx/shared-types`. Do the identical replacement in `apps/web/lib/search/retrieval.ts` and (if Task 5's own Step 3 of the Lumi 2 plan added one there too) `apps/web/lib/search/persist.ts`.

- [ ] **Step 5: Typecheck**

```bash
cd /home/s7lver/Lumi/packages/shared-types && npx tsc --noEmit
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
```

Expected: no errors in any of the three.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/embedding-columns.ts packages/shared-types/src/index.ts apps/worker/src/db-queries.ts apps/web/lib/search/retrieval.ts apps/web/lib/search/persist.ts
git commit -m "refactor(models): centralize model-id-to-embedding-column mapping in one registry"
```

---

### Task 6: Publish-flow checkbox + catalog multi-model badges

**Files:**
- Modify: the dataset publish UI component (read `apps/web/app/components/DatasetsSection.tsx` or wherever the publish form currently lives fresh — this plan hasn't read that file yet)
- Modify: the catalog listing component that shows a dataset's compatibility (same read-fresh caveat)

**Interfaces:**
- Consumes: `RETRIEVAL_MODELS` (`@netryx/shared-types`), Task 4's `includeModelIds` publish request field, Task 2's `isCompatible`.

- [ ] **Step 1: Read the current publish form and catalog listing components fresh**

Identify exactly where the publish request body is built client-side (to add the new model-selection checkboxes) and where a dataset's single-model compatibility badge is currently rendered (to render one badge per `models[]` entry instead).

- [ ] **Step 2: Add the "also generate for" checkboxes**

For every entry in `RETRIEVAL_MODELS` other than the currently-active one, render a checkbox labeled with that model's `displayName` (e.g. "También generar para Lumi 2"), defaulting unchecked. On submit, include `includeModelIds: [activeModelId, ...checkedModelIds]` in the publish request body (matching Task 4 Step 3's expected field).

- [ ] **Step 3: Render one badge per compatible model**

Wherever the catalog currently renders a single "Compatible con Lumi Preview"-style line from a dataset's `model` field, change it to map over `models[]` and render one small badge per entry (e.g. "Lumi Preview", "Lumi 2"), reusing whatever badge/pill component this codebase already has (check for an existing `Badge` component, already used elsewhere this session, before introducing a new one).

- [ ] **Step 4: Typecheck and build**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit && npx next build
```

Expected: no errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -- <the specific files Steps 2-3 touched>
git commit -m "feat(web): publish-flow model checkboxes and multi-model catalog badges"
```
