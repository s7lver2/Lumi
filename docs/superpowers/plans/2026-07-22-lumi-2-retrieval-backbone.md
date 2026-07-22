# Lumi 2 Retrieval Backbone + HNSW Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Lumi 2" (BoQ on a DINOv2 backbone, `output_dim=12288`) as a second, coexisting retrieval model alongside Lumi Preview (MegaLoc), and add pgvector HNSW indexes so retrieval stops degrading badly past a few thousand rows.

**Architecture:** A per-model embedding column (`embedding_lumi2` / `query_embedding_lumi2`, alongside the existing `embedding` / `query_embedding`) — not a generic table — since pgvector needs one fixed dimension per column and there are only two models. The existing system-wide "active retrieval model" setting (already restart-gated: switching models already requires restarting the inference service, per the existing Settings copy "Cambiar de modelo requiere reiniciar el servicio de inferencia") is what selects Lumi 2 — no new per-search picker. `/embed` itself needs zero changes: `services/inference/main.py`'s `embed()` already dispatches on whatever `retrieval_model_id` is active via the existing `get_retrieval_model()` → `_ensure_active_model("retrieval")` → `load_retrieval_model(...)` chain; only `loader.py` gains a new branch. The write side (worker's `insertIndexedImages`/`insertIndexedPoints`/`updateImageEmbeddings`) becomes model-aware so it writes to the right column; the read side (`retrieveCandidates`) does the same.

**Tech Stack:** FastAPI/Python (services/inference, PyTorch/torch.hub), Postgres + pgvector (HNSW), Next.js/TypeScript (apps/web), Node worker (apps/worker).

## Global Constraints

- No tests in this plan — every task ends with implementation + a typecheck/import-check step + a commit. Do not write Vitest or pytest tests anywhere in this plan.
- Lumi Preview must keep working completely unchanged throughout — every schema/query change is additive (new nullable columns, new `elif` branches), never a rewrite of the existing MegaLoc path.
- BoQ's exact license terms must be checked against `github.com/amaralibey/Bag-of-Queries`'s actual license file before shipping this to any real user-facing release — flag this in Task 3's step but do not block implementation on it (this is a PoC-stage integration).
- Commits use `git add <specific files>`, never `git add -A` or `git add .`.

---

### Task 1: Schema — per-model embedding columns + HNSW indexes

**Files:**
- Create: `db/migrations/1721700000000_lumi2_embeddings.js`

**Interfaces:**
- Produces: `indexed_images.embedding_lumi2 vector(12288)` (nullable), `indexed_points.embedding_lumi2 vector(12288)` (nullable), `searches.query_embedding_lumi2 vector(12288)` (nullable), plus HNSW indexes on all four embedding columns (`embedding`, `embedding_lumi2` on both `indexed_images` and `indexed_points`). Every later task that reads/writes embeddings depends on these exact column names.

- [ ] **Step 1: Write the migration**

```js
// db/migrations/1721700000000_lumi2_embeddings.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE indexed_images ADD COLUMN embedding_lumi2 vector(12288);`);
  pgm.sql(`ALTER TABLE indexed_points ADD COLUMN embedding_lumi2 vector(12288);`);
  pgm.sql(`ALTER TABLE searches ADD COLUMN query_embedding_lumi2 vector(12288);`);

  // HNSW indexes for approximate cosine search — one per (table, model)
  // combination, since two different models' vectors are never compared
  // to each other. Default m/ef_construction (pgvector's own defaults)
  // are fine for tens-of-thousands-of-rows scale.
  pgm.sql(`CREATE INDEX indexed_images_embedding_hnsw_idx ON indexed_images USING hnsw (embedding vector_cosine_ops);`);
  pgm.sql(`CREATE INDEX indexed_images_embedding_lumi2_hnsw_idx ON indexed_images USING hnsw (embedding_lumi2 vector_cosine_ops);`);
  pgm.sql(`CREATE INDEX indexed_points_embedding_hnsw_idx ON indexed_points USING hnsw (embedding vector_cosine_ops);`);
  pgm.sql(`CREATE INDEX indexed_points_embedding_lumi2_hnsw_idx ON indexed_points USING hnsw (embedding_lumi2 vector_cosine_ops);`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX indexed_points_embedding_lumi2_hnsw_idx;`);
  pgm.sql(`DROP INDEX indexed_points_embedding_hnsw_idx;`);
  pgm.sql(`DROP INDEX indexed_images_embedding_lumi2_hnsw_idx;`);
  pgm.sql(`DROP INDEX indexed_images_embedding_hnsw_idx;`);
  pgm.sql(`ALTER TABLE searches DROP COLUMN query_embedding_lumi2;`);
  pgm.sql(`ALTER TABLE indexed_points DROP COLUMN embedding_lumi2;`);
  pgm.sql(`ALTER TABLE indexed_images DROP COLUMN embedding_lumi2;`);
};
```

- [ ] **Step 2: Run the migration**

```bash
cd /home/s7lver/Lumi/db && pnpm run migrate:up
```

Expected: output ends with `### MIGRATION 1721700000000_lumi2_embeddings (UP) ###` and exit code 0.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/1721700000000_lumi2_embeddings.js
git commit -m "feat(db): add embedding_lumi2 columns and HNSW indexes for Lumi 2 + faster retrieval"
```

---

### Task 2: Register Lumi 2 in the model catalog (TS + Python)

**Files:**
- Modify: `packages/shared-types/src/models.ts`
- Modify: `packages/shared-types/src/model-bundles.ts`
- Modify: `services/inference/models/registry.py`

**Interfaces:**
- Produces: `RETRIEVAL_MODELS` (TS) gains a `{ id: "lumi-2", ... }` entry with `embeddingDim: 12288`; `MODEL_BUNDLES` gains a matching `{ id: "lumi-2", retrievalModelId: "lumi-2", ... }` entry so `/settings`'s existing `ModelBundleRow` picker shows it; Python's `RETRIEVAL_MODELS` list gains the mirrored entry. Task 4's `load_retrieval_model` branches on this exact `"lumi-2"` id string.

- [ ] **Step 1: Add the TS retrieval model entry**

```ts
// packages/shared-types/src/models.ts — add to RETRIEVAL_MODELS array, after the lumi-preview entry
  {
    id: "lumi-2",
    displayName: "Lumi 2",
    baseModel: "BoQ + DINOv2 (frozen)",
    status: "preview",
    embeddingDim: 12288,
    version: "1.0",
  },
```

- [ ] **Step 2: Add the matching model bundle**

```ts
// packages/shared-types/src/model-bundles.ts — add to MODEL_BUNDLES array, after the lumi-preview entry
  {
    id: "lumi-2",
    displayName: "Lumi 2",
    retrievalModelId: "lumi-2",
    version: "1.0",
    status: "preview",
  },
```

- [ ] **Step 3: Add the Python registry entry**

```python
# services/inference/models/registry.py — add to RETRIEVAL_MODELS list, after the lumi-preview entry
    {
        "id": "lumi-2",
        "display_name": "Lumi 2",
        "base_model": "BoQ + DINOv2 (frozen)",
        "status": "preview",
        "embedding_dim": 12288,
        "version": "1.0",
    },
```

- [ ] **Step 4: Typecheck**

```bash
cd /home/s7lver/Lumi/packages/shared-types && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/models.ts packages/shared-types/src/model-bundles.ts services/inference/models/registry.py
git commit -m "feat(models): register lumi-2 in the retrieval model catalog and bundle picker"
```

---

### Task 3: Load BoQ+DINOv2 in the inference service

**Files:**
- Modify: `services/inference/loader.py`
- Modify: `services/inference/requirements.txt`

**Interfaces:**
- Consumes: nothing new.
- Produces: `load_retrieval_model("lumi-2")` returns a loaded BoQ model ready for `_run_model` (Task 4 of a future embed-path task, if `_run_model`'s tensor pipeline needs a BoQ-specific preprocessing branch — verify this when implementing, MegaLoc and BoQ may expect different input transforms).

- [ ] **Step 1: Add BoQ's torch.hub entry point to `load_retrieval_model`**

```python
# services/inference/loader.py — inside load_retrieval_model, after the lumi-preview branch
    if model_id == "lumi-2":
        # Confirmed live via the model's own repo (github.com/amaralibey/
        # Bag-of-Queries): the only documented trained checkpoint loadable
        # via torch.hub for the DINOv2 backbone, output_dim=12288 — this
        # is the real released checkpoint, not a placeholder guess.
        return torch.hub.load("amaralibey/bag-of-queries", "get_trained_boq", backbone_name="dinov2", output_dim=12288)

    raise UnknownModelError(f"No loader implemented for retrieval model id: {model_id}")
```

- [ ] **Step 2: Confirm BoQ's own dependencies are covered by requirements.txt**

Read `torch.hub`'s downloaded `hubconf.py` for `amaralibey/bag-of-queries` (fetched automatically on first `torch.hub.load` call) to check for any additional pip dependency beyond `torch`/`torchvision` (already pinned in `requirements.txt`). If one exists, add it as a new line in `services/inference/requirements.txt` with an exact version pin, following the file's existing style (see the CUDA-wheel comment block at the top for the established commenting convention). If none exists, no change needed here — note that finding in the task report instead of editing the file.

- [ ] **Step 3: Verify the file still imports cleanly**

```bash
cd /home/s7lver/Lumi/services/inference && venv/bin/python -c "import loader"
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add services/inference/loader.py services/inference/requirements.txt
git commit -m "feat(inference): load BoQ+DINOv2 (Lumi 2) via torch.hub"
```

---

### Task 4: Make the embedding write path model-aware

**Files:**
- Modify: `apps/worker/src/db-queries.ts`
- Modify: `apps/worker/src/jobs/index-area.ts`
- Modify: `apps/worker/src/jobs/embed-pending-images.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: `getSettingsRepo()` (already used elsewhere in `apps/worker/src/settings.ts`) to read the currently-active `RETRIEVAL_MODEL` setting.
- Produces: `insertIndexedImages(pool, areaId, images, retrievalModelId)`, `insertIndexedPoints(pool, areaId, points, retrievalModelId)`, `updateImageEmbeddings(pool, updates, retrievalModelId)` — each now picks `embedding`/`embedding_lumi2` (or `query_embedding`/`query_embedding_lumi2`, for symmetry in a later task) based on `retrievalModelId === "lumi-2"`. Task 5 (the read side) uses the same convention.

- [ ] **Step 1: Add a shared column-picker helper**

```ts
// apps/worker/src/db-queries.ts — add near the top, after imports
function embeddingColumn(retrievalModelId: string): "embedding" | "embedding_lumi2" {
  return retrievalModelId === "lumi-2" ? "embedding_lumi2" : "embedding";
}
```

- [ ] **Step 2: Thread `retrievalModelId` through the three write functions**

Read the current full bodies of `insertIndexedPoints`, `insertIndexedImages`, and `updateImageEmbeddings` in `apps/worker/src/db-queries.ts` (already confirmed this session: they interpolate a hardcoded `embedding` column name into their `INSERT`/`UPDATE` SQL strings). Add a new trailing `retrievalModelId: string` parameter to each function's signature, and replace the hardcoded `embedding` column name in each function's SQL template string with `${embeddingColumn(retrievalModelId)}` (template-interpolated into the query text — safe here because the value is drawn from the fixed two-branch helper above, never from raw user input).

- [ ] **Step 3: Pass the active retrieval model id through from the job files**

In `apps/worker/src/jobs/index-area.ts`, the `RunIndexAreaJobDeps` interface's `insertIndexedImages`/`insertIndexedPoints` function-type properties each gain a trailing `retrievalModelId: string` parameter (matching Task 4 Step 2's new signatures) — this changes the interface's function-type declarations only, not any call site inside this file (the calls already just forward whatever `deps.insertIndexedImages(...)`/`deps.insertIndexedPoints(...)` receive from their closures, defined in `apps/worker/src/index.ts`).

Similarly, `apps/worker/src/jobs/embed-pending-images.ts`'s `EmbedPendingImagesJobDeps.updateImageEmbeddings` gains a trailing `retrievalModelId: string` parameter in its type signature.

- [ ] **Step 4: Wire the real active-model lookup in `apps/worker/src/index.ts`**

In the `boss.work(INDEX_AREA_JOB_NAME, ...)` handler, before constructing the `deps` object passed to `runIndexAreaJob`, add:

```ts
const retrievalModelId = (await settingsRepo.getSetting("RETRIEVAL_MODEL")) ?? "lumi-preview";
```

Change the two deps entries from:

```ts
      insertIndexedImages: (areaId, images) => insertIndexedImages(pool, areaId, images),
```

and:

```ts
      insertIndexedPoints: (areaId, points) => insertIndexedPoints(pool, areaId, points),
```

to:

```ts
      insertIndexedImages: (areaId, images) => insertIndexedImages(pool, areaId, images, retrievalModelId),
```

and:

```ts
      insertIndexedPoints: (areaId, points) => insertIndexedPoints(pool, areaId, points, retrievalModelId),
```

Do the same in the `boss.work(EMBED_PENDING_IMAGES_JOB_NAME, ...)` handler for `updateImageEmbeddings`: add the same `retrievalModelId` lookup, and change:

```ts
      updateImageEmbeddings: (updates) => updateImageEmbeddings(pool, updates),
```

to:

```ts
      updateImageEmbeddings: (updates) => updateImageEmbeddings(pool, updates, retrievalModelId),
```

- [ ] **Step 5: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
```

Expected: no errors. If any test files in `apps/worker/src/jobs/*.test.ts` fail to typecheck because they call the changed deps functions with the old arity, add the new `retrievalModelId` argument (e.g. `"lumi-preview"`) to those call sites only — do not add new test cases, just fix the existing calls' arity so the suite still compiles.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/db-queries.ts apps/worker/src/jobs/index-area.ts apps/worker/src/jobs/embed-pending-images.ts apps/worker/src/index.ts
git commit -m "feat(worker): write embeddings to the active retrieval model's own column"
```

(If Step 5 required fixing test-file call sites, include those files in this same commit.)

---

### Task 5: Make retrieval read from the active model's column

**Files:**
- Modify: `apps/web/lib/search/retrieval.ts`
- Modify: `apps/web/lib/search/persist.ts`
- Modify: `apps/web/app/api/models/[modelId]/estimate/route.ts`

**Interfaces:**
- Consumes: the `embedding_lumi2`/`query_embedding_lumi2` columns from Task 1.
- Produces: `retrieveCandidates(pool, queryEmbedding, k, retrievalModelId, excludeIndexedImageId?, relativeSimilarityFloor?)` — note `retrievalModelId` moves before the two optional trailing params since it's now required, not optional; `persistSearch`'s args gain the model id so it writes the query embedding to the matching column.

- [ ] **Step 1: Add the same column-picker to retrieval.ts**

```ts
// apps/web/lib/search/retrieval.ts — add near the top, after imports
function embeddingColumn(retrievalModelId: string): "embedding" | "embedding_lumi2" {
  return retrievalModelId === "lumi-2" ? "embedding_lumi2" : "embedding";
}
```

- [ ] **Step 2: Thread it through `retrieveCandidates`'s two queries**

Add a `retrievalModelId: string` parameter to `retrieveCandidates`, positioned right after `k` (before the existing optional `excludeIndexedImageId`/`relativeSimilarityFloor` params — required params can't follow optional ones in TS). Compute `const col = embeddingColumn(retrievalModelId);` at the top of the function body. In both the `perHeading` and `aggregate` SQL template strings, replace every occurrence of the literal `embedding` column name (both the `WHERE embedding IS NOT NULL` clauses, the `1 - (embedding <=> $1)` / `1 - (img.embedding <=> $1)` similarity expressions, the `ORDER BY embedding <=> $1` clauses, and the `embedding::text AS embedding_text` / `img.embedding::text AS embedding_text` selects) with `${col}` template-interpolated in place of the hardcoded name — the aliased output column stays named `embedding_text` regardless (only the source column name changes), so the rest of the function (which reads `r.embedding_text`) needs no further changes. Do the same for `indexed_points.embedding` inside the `near_panos` subquery in the `aggregate` query.

- [ ] **Step 3: Thread the model id through `persistSearch`**

Read the current full body of `persistSearch` in `apps/web/lib/search/persist.ts` (already confirmed this session: its `INSERT INTO searches (query_image_path, query_embedding) ...` hardcodes the `query_embedding` column). Add a `retrievalModelId: string` field to whatever args type `persistSearch` already accepts, and replace the hardcoded `query_embedding` column name in its INSERT statement the same way — using a local `embeddingColumn(args.retrievalModelId)`-style helper (reuse or duplicate the Step 1 helper here; duplicating a 2-line function across `retrieval.ts` and `persist.ts` is simpler than introducing a new shared module for one helper this size).

- [ ] **Step 4: Update the estimate route's call sites**

In `apps/web/app/api/models/[modelId]/estimate/route.ts`, `activeModelId` is already read near the top of the handler. Change:

```ts
      retrieveCandidates(pool, embedding, DEFAULT_TOP_K, undefined, DEFAULT_RELATIVE_SIMILARITY_FLOOR),
```

to:

```ts
      retrieveCandidates(pool, embedding, DEFAULT_TOP_K, activeModelId, undefined, DEFAULT_RELATIVE_SIMILARITY_FLOOR),
```

and pass `retrievalModelId: activeModelId` into whatever args object is already passed to `persist: (args) => persistSearch(pool, args)`'s underlying call (read the current `RunSearchDeps`/`persistSearch` call shape fresh before editing — this plan doesn't have its exact current args-object shape captured, confirm it while implementing this step).

- [ ] **Step 5: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
```

Expected: no errors (beyond any test-file call-site arity fixes, same treatment as Task 4 Step 5 — fix call sites only, no new tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/search/retrieval.ts apps/web/lib/search/persist.ts apps/web/app/api/models/\[modelId\]/estimate/route.ts
git commit -m "feat(web): read/write query embeddings against the active retrieval model's column"
```

---

### Task 6: Final verification pass

**Files:** none (verification only).

- [ ] **Step 1: Typecheck every touched package**

```bash
cd /home/s7lver/Lumi/packages/shared-types && npx tsc --noEmit
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
cd /home/s7lver/Lumi/services/inference && venv/bin/python -c "import loader; import main"
```

Expected: no errors from any of the four commands.

- [ ] **Step 2: Build the web app**

```bash
cd /home/s7lver/Lumi/apps/web && npx next build
```

Expected: build succeeds.

- [ ] **Step 3: Report to the user**

No commit for this task — it's a checkpoint. Summarize: all 5 implementation tasks done, both models coexist, HNSW indexes in place. Remind the user that switching the active model to `lumi-2` in `/settings` still requires restarting the inference service (existing, unchanged behavior), and that on their own 6GB dev GPU, Lumi 2 may be noticeably heavier/slower to load than MegaLoc — expected, not a bug (per the approved design's §5).
