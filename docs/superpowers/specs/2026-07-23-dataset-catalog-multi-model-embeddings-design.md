# Dataset Catalog Multi-Model Embedding Tags — Design

## Goal

Let a published dataset carry embeddings for more than one retrieval model
(starting with Lumi Preview + Lumi 2), tag it in the catalog with every
model it's compatible with, and let the publish/export flow optionally
generate the second model's embeddings at publish time — all without
requiring a manifest-format migration every time a future Lumi model is
added.

## Current state (confirmed by reading the code)

`apps/web/lib/datasets/manifest.ts`'s `DatasetManifest` has a single
`model: ModelTag` field, and every `DatasetManifestImage`/
`DatasetManifestPoint` has one `embedding: number[] | null`, validated
against that one model's `embeddingDim`. `compatibility.ts` checks an
exact `{id, version}` match against the currently active model. This is a
single-model design — extending it to N models needs a real schema
change, not just an added optional field.

## 1. Manifest format: generic, multi-model, no future migration needed

Change `DatasetManifest.model: ModelTag` (singular) to
`DatasetManifest.models: ModelTag[]` (plural — every model this dataset
includes embeddings for). Change each image/point's single `embedding`
field to `embeddings: Record<string, number[] | null>`, keyed by model
id (e.g. `{"lumi-preview": [...], "lumi-2": [...]}`). Adding a future
Lumi 3 is then just another entry in `models[]` and another key in each
`embeddings` map — the manifest format itself needs no version bump or
migration for that.

`validateDatasetManifest` validates each model tag in `models[]` against
`knownModelIds` (same check as today, just looped), and validates each
image/point's `embeddings` map has, for every key present, an array whose
length matches that model's declared `embeddingDim` — a dataset is free
to have `null` (or an absent key) for a model it doesn't include.

`compatibility.ts`'s check becomes: a dataset is compatible with the
currently active model if `models[]` contains a tag matching that model's
`{id, version}` exactly (same exactness rule as today, just checking
membership in a list instead of equality with a single value). The
catalog UI shows one badge/tag per entry in `models[]` (e.g. "Lumi
Preview", "Lumi 2") instead of the current single-model line.

## 2. Postgres storage stays per-model-column (pgvector's real constraint)

This is a hard technical limit, not a design choice avoided here: a
`vector(N)` column has one fixed dimension. There is no generic column
that holds embeddings for arbitrary future dimensions without dropping
pgvector's type entirely (and with it, the HNSW index and fast similarity
search — not worth it just for schema flexibility). So every new model
still needs its own `embedding_<modelid>` column + HNSW index migration,
exactly like Lumi 2's own plan already does for `embedding_lumi2`. This
project does not remove that need — it makes adding one **fast and
mechanical** instead of scattered:

A new small module, `packages/shared-types/src/embedding-columns.ts`,
exports a single registry:

```ts
export const EMBEDDING_COLUMN_BY_MODEL: Record<string, string> = {
  "lumi-preview": "embedding",
  "lumi-2": "embedding_lumi2",
  // future model: "lumi-3": "embedding_lumi3",
};
```

Every place that currently picks a column by checking
`retrievalModelId === "lumi-2"` (the Lumi 2 plan's `db-queries.ts` and
`retrieval.ts` helpers) is rewritten to look up
`EMBEDDING_COLUMN_BY_MODEL[retrievalModelId]` instead — adding model N+1
becomes: one migration (new column + index) + one new line in this
registry, not a hunt through multiple `if`/`elif` branches across the
codebase. This is worth doing now, alongside this project, since the
Lumi 2 plan is what introduces the first `if` branches this registry
would replace.

## 3. Publish flow: optional "also generate Lumi 2 embeddings"

The dataset export/publish flow gains a checkbox (or similar toggle) per
non-active model available in `RETRIEVAL_MODELS` beyond the currently
active one — concretely, today that's just "Lumi 2" when Lumi Preview is
active, or vice versa. When checked, before building the manifest, the
publish route re-embeds that area's already-downloaded images (same cheap
"images already on disk, just re-run the embed step" pattern already
established for `embed-pending-images.ts`) using the checked model, and
includes the result under that model's key in each image/point's
`embeddings` map. Unchecked models are simply absent from the map — no
placeholder nulls needed for models never requested at publish time
(distinct from "requested but the image had no coverage," which isn't a
real case here since embedding always succeeds for an existing image).

## 4. Backward compatibility

Datasets already published under the old single-`model`/single-`embedding`
format must still install correctly. The import/parse path
(`parse-manifest-buffer.ts`, `validate-bundle.ts`) gains a compatibility
step: if a manifest's raw JSON has the old singular `model`/`embedding`
shape (detected by the field's presence/absence, not a version number
bump — the dataset format's own `version` field can stay as-is since nothing
about the *file structure* changes catastrophically, only these two
fields' shape), it's normalized in memory to the new `models: [that one
tag]` / `embeddings: {[that model id]: that embedding}` shape before the
rest of the pipeline (which only ever sees the new shape) runs. No
re-publishing of old datasets is required.

## Out of scope

- Changing the Postgres per-model-column pattern to anything else (JSONB,
  a generic table) — rejected per §2's pgvector constraint.
- Building the actual Lumi 3 (or any model beyond Lumi 2) — this project
  only makes the next one mechanical to add, it doesn't add one.
- Any UI beyond the publish-flow checkbox and the catalog's multi-badge
  display — no new dedicated "manage dataset model coverage" screen.
