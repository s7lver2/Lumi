# Qdrant Vector Search (replacing pgvector HNSW) — Design

## Goal

Fix the scale problem Lumi 2's own plan ran into: pgvector's HNSW/ivfflat
indexes cap out at 2000 dimensions, and both MegaLoc (8448-d) and Lumi 2
(12288-d) exceed that by a wide margin — confirmed live, the index
creation statements failed outright. Replace the missing ANN index with
Qdrant, embedded directly inside `services/inference` (no new deployed
service, no Docker, no new port) — chosen specifically because this
project already funnels every model-touching operation through
`services/inference`, and (unlike Postgres) nothing else in this stack
runs in Docker.

## Architecture

**Qdrant runs embedded, in-process, inside `services/inference`** via
`qdrant-client`'s local mode (`QdrantClient(path=...)`, backed by a data
directory on disk — no server process, no network port). Two new
endpoints on the existing FastAPI app:

- `POST /vector/upsert` — body `{ collection: string, id: string, vector: number[], payload: object }`. `collection` is one per model (`"lumi-preview"`, `"lumi-2"`) since vectors from different models are never comparable and Qdrant collections have their own fixed dimension, mirroring the per-model-column pattern already established in the Lumi 2 plan.
- `POST /vector/search` — body `{ collection: string, vector: number[], topK: number }`, returns `[{ id: string, score: number }]`.

**Postgres remains the source of truth for everything else** — Qdrant
only ever holds `{id: indexed_image_id or indexed_point_id, vector,
payload: {kind: "image" | "point"}}`. The embedding columns
(`embedding`/`embedding_lumi2` on `indexed_images`/`indexed_points`) stay
exactly as they are: needed for dataset export/import (portable bundles
that don't depend on any particular Qdrant instance existing), and as the
durable backup Qdrant's index can always be rebuilt from if its on-disk
data is ever lost or corrupted — Qdrant is a rebuildable index, not a
second database to keep permanently in sync by hand.

## 1. Write path: keep Qdrant current as embeddings are written

Every place that already writes an embedding (`insertIndexedImages`,
`insertIndexedPoints`, `updateImageEmbeddings` in
`apps/worker/src/db-queries.ts`) also calls the new
`POST /vector/upsert` endpoint right after the Postgres write succeeds,
using the same `retrievalModelId` (already threaded through by the Lumi 2
plan) to pick the right Qdrant `collection`. This is fire-and-forget in
spirit but should log (not silently swallow) a failure — an out-of-sync
Qdrant index is a real (if recoverable) problem, distinct from the
"decorative, never fail the real work" pattern used for things like
time-of-day classification, since a missed upsert means that one image
silently becomes unsearchable until the next full rebuild.

## 2. Read path: `retrieveCandidates` calls Qdrant, then hydrates from Postgres

`apps/web/lib/search/retrieval.ts`'s `retrieveCandidates` changes from a
single SQL query to: call `POST /vector/search` (the collection matching
the active retrieval model) to get a ranked list of
`{id, score}`, then run one `SELECT ... WHERE id = ANY($1)` against
`indexed_images` to hydrate the full candidate rows (lat/lng/pano_id/
heading/provider/attribution/etc.) for just those IDs, in the order
Qdrant returned them. The existing "aggregate recall via nearby
`indexed_points`, expanded to per-heading images" behavior is preserved
by doing a second Qdrant search against the points collection and
expanding those pano_ids to their images from Postgres, same as today's
two-query shape — just swapping which system does the actual similarity
ranking.

## 3. Migrating what's already indexed

A one-time backfill: a new script/job that reads every `indexed_images`/
`indexed_points` row with a non-null `embedding` (and `embedding_lumi2`,
once populated) and calls `/vector/upsert` for each, populating Qdrant
from the existing real data (León, and anything else already indexed)
rather than starting Qdrant empty. This runs once, explicitly, as part of
rolling this feature out — not a background job that runs forever.

## Out of scope

- Any UI change — this is entirely a backend swap; search results look
  and behave identically, just faster at scale.
- Removing the Postgres embedding columns — they stay, deliberately, per
  §"Architecture" above.
- Multi-node/clustered Qdrant, authentication on Qdrant itself, or any
  Qdrant deployment mode other than embedded local mode — out of scope
  until embedded mode's limits (if any are hit at real scale) demand it.
