# Qdrant Vector Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the missing pgvector ANN index (HNSW failed — both MegaLoc's 8448-d and Lumi 2's 12288-d exceed pgvector's 2000-dim index cap) with Qdrant running embedded inside `services/inference`, migrate all currently-indexed embeddings into it, and switch the actual search path (`retrieveCandidates`) over to use it — this is a real cutover, not an unused parallel system left dormant alongside the old exact-search path.

**Architecture:** `qdrant-client`'s local mode (`QdrantClient(path=...)`, file-backed, single-process, no server/Docker) lives inside `services/inference`, exposed via two new endpoints (`POST /vector/upsert`, `POST /vector/search`). One Qdrant collection per retrieval model (vectors from different models aren't comparable, mirroring the per-model-column pattern already used for Postgres). Postgres stays the source of truth for all metadata and for the embeddings themselves (portability, rebuildability); Qdrant is purely the fast index. The worker upserts on every embedding write; `retrieveCandidates` calls Qdrant then hydrates full rows from Postgres by id. A one-time backfill script populates Qdrant from whatever's already indexed today.

**Tech Stack:** Python/FastAPI (services/inference), `qdrant-client`, Node/TypeScript (apps/web, apps/worker), Postgres.

## Global Constraints

- No tests in this plan — every task ends with implementation + a typecheck/import-check step + a commit. Do not write Vitest or pytest tests anywhere in this plan.
- Qdrant's local mode is single-process (file-lock based, like SQLite) — only ever accessed from within `services/inference`'s own single uvicorn process, never from a second process pointed at the same storage path. This is already how this project runs (one inference service instance), so no new constraint in practice.
- Other plans (Lumi 2 backbone, free street-imagery providers, dataset-catalog multi-model embeddings) were executed by parallel agents around the same time as this one and may already be merged into `main` by the time you run — if `apps/web/lib/search/retrieval.ts` or `apps/worker/src/db-queries.ts` already look different from what this plan describes (e.g. already have a `retrievalModelId`/`embeddingColumn` parameter from the Lumi 2 plan), adapt this plan's edits to the real current file rather than reverting it to what this plan assumed — the goal (call Qdrant, hydrate from Postgres) stays the same regardless of exactly which column names surround it.
- Commits use `git add <specific files>`, never `git add -A` or `git add .`.

---

### Task 1: Qdrant dependency + embedded vector store module

**Files:**
- Modify: `services/inference/requirements.txt`
- Create: `services/inference/vector_store.py`

**Interfaces:**
- Produces: `ensure_collection(name: str, dim: int) -> None`, `upsert_vector(collection: str, point_id: str, vector: list[float], payload: dict) -> None`, `search_vectors(collection: str, vector: list[float], top_k: int) -> list[dict]` (each result `{"id": str, "score": float, "payload": dict}`) — Task 2's endpoints call these directly.

- [ ] **Step 1: Add the dependency**

```
# services/inference/requirements.txt — add this line (after the existing safetensors/opencv-python-headless lines, alphabetical position doesn't matter, this file isn't alphabetized)
qdrant-client==1.11.2
```

- [ ] **Step 2: Write the vector store module**

```python
# services/inference/vector_store.py
"""
Embedded Qdrant vector index (local mode — file-backed, single-process,
no server/Docker; spec: docs/superpowers/specs/2026-07-23-qdrant-vector-
search-design.md). Postgres stays the source of truth for embeddings and
all metadata; this module is purely a fast, rebuildable similarity index.
"""
import os
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

_STORAGE_DIR = os.environ.get("QDRANT_STORAGE_DIR") or os.path.join(
    os.environ.get("MODELS_CACHE_DIR") or os.path.join(os.path.dirname(__file__), "..", "..", "data"),
    "qdrant",
)

_client: QdrantClient | None = None
_known_collections: set[str] = set()


def _get_client() -> QdrantClient:
    global _client
    if _client is None:
        os.makedirs(_STORAGE_DIR, exist_ok=True)
        _client = QdrantClient(path=_STORAGE_DIR)
    return _client


def ensure_collection(name: str, dim: int) -> None:
    if name in _known_collections:
        return
    client = _get_client()
    if not client.collection_exists(name):
        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
        )
    _known_collections.add(name)


def upsert_vector(collection: str, point_id: str, vector: list[float], payload: dict) -> None:
    ensure_collection(collection, len(vector))
    client = _get_client()
    client.upsert(
        collection_name=collection,
        points=[PointStruct(id=point_id, vector=vector, payload=payload)],
    )


def search_vectors(collection: str, vector: list[float], top_k: int) -> list[dict]:
    client = _get_client()
    if not client.collection_exists(collection):
        return []
    results = client.search(collection_name=collection, query_vector=vector, limit=top_k)
    return [{"id": str(r.id), "score": r.score, "payload": r.payload} for r in results]
```

- [ ] **Step 3: Verify the file imports cleanly**

```bash
cd /home/s7lver/Lumi/services/inference && venv/bin/pip install -r requirements.txt && venv/bin/python -c "import vector_store"
```

Expected: pip install succeeds, import produces no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add services/inference/requirements.txt services/inference/vector_store.py
git commit -m "feat(inference): add embedded Qdrant vector store module"
```

---

### Task 2: `/vector/upsert` and `/vector/search` endpoints

**Files:**
- Modify: `services/inference/main.py`

**Interfaces:**
- Consumes: `vector_store.py` (Task 1).
- Produces: `POST /vector/upsert` (body `{collection, id, vector, payload}` → `{ok: true}`), `POST /vector/search` (body `{collection, vector, topK}` → `{results: [{id, score, payload}]}`) — Task 3 (worker) and Task 4 (web) call these over HTTP.

- [ ] **Step 1: Add the Pydantic request/response models**

```python
# services/inference/main.py — add alongside the other request/response models (near EmbedRequest etc.)
class VectorUpsertRequest(BaseModel):
    collection: str
    id: str
    vector: list[float]
    payload: dict = {}


class VectorSearchRequest(BaseModel):
    collection: str
    vector: list[float]
    topK: int = 50


class VectorSearchResult(BaseModel):
    id: str
    score: float
    payload: dict


class VectorSearchResponse(BaseModel):
    results: list[VectorSearchResult]
```

- [ ] **Step 2: Add the two endpoints**

```python
# services/inference/main.py — add near the other endpoint definitions, and add `from vector_store import ensure_collection, upsert_vector, search_vectors` to the file's imports
@app.post("/vector/upsert")
def vector_upsert(request: VectorUpsertRequest) -> dict:
    upsert_vector(request.collection, request.id, request.vector, request.payload)
    return {"ok": True}


@app.post("/vector/search", response_model=VectorSearchResponse)
def vector_search(request: VectorSearchRequest) -> VectorSearchResponse:
    results = search_vectors(request.collection, request.vector, request.topK)
    return VectorSearchResponse(results=[VectorSearchResult(**r) for r in results])
```

- [ ] **Step 3: Verify the file imports cleanly**

```bash
cd /home/s7lver/Lumi/services/inference && venv/bin/python -c "import main"
```

Expected: no output, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add services/inference/main.py
git commit -m "feat(inference): expose /vector/upsert and /vector/search endpoints"
```

---

### Task 3: Worker — upsert on every embedding write

**Files:**
- Create: `apps/worker/src/vector-client.ts`
- Modify: `apps/worker/src/db-queries.ts`

**Interfaces:**
- Consumes: `POST /vector/upsert` (Task 2).
- Produces: `upsertVector(inferenceBaseUrl, collection, id, vector, payload): Promise<void>` — called from every place `db-queries.ts` writes an embedding.

- [ ] **Step 1: Write the client function**

```ts
// apps/worker/src/vector-client.ts
export async function upsertVector(
  inferenceBaseUrl: string,
  collection: string,
  id: string,
  vector: number[],
  payload: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${inferenceBaseUrl}/vector/upsert`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ collection, id, vector, payload }),
  });
  if (!res.ok) {
    // Not fire-and-forget-and-ignore: an out-of-sync Qdrant index means
    // this one row silently becomes unsearchable until the next backfill,
    // which is a real (if recoverable) problem — log it loudly.
    console.error(`[vector-client] upsert failed for ${collection}/${id}: ${res.status} ${await res.text()}`);
  }
}
```

- [ ] **Step 2: Read `db-queries.ts`'s current three write functions fresh, then call `upsertVector` from each**

Read the current full bodies of `insertIndexedPoints`, `insertIndexedImages`, and `updateImageEmbeddings` (their exact current signatures depend on whether the Lumi 2 plan's `retrievalModelId` parameter has landed in this branch yet — check and adapt, per this plan's Global Constraints). After each successful Postgres write, call `upsertVector(inferenceBaseUrl, collection, id, embeddingVector, payload)` for every row just written, where:
- `collection` is the model id in scope for that write (`"lumi-preview"` by default, or whatever `retrievalModelId` variable is already available if the Lumi 2 plan's threading has landed — if it hasn't landed yet, hardcode `"lumi-preview"` for now, since that's the only model that exists on `main` without it).
- `id` is the Postgres row's own `id` (already returned by the `INSERT ... RETURNING id` if not already selected — add `RETURNING id` to each INSERT if not already present, and thread the returned id back to the caller for this purpose).
- `payload` is `{ kind: "image" }` or `{ kind: "point" }` matching which table the row belongs to.

These three functions will need an `inferenceBaseUrl: string` parameter added (not currently present, since `db-queries.ts` today only talks to Postgres) — thread it through from each function's call site in `apps/worker/src/index.ts`, which already has `inferenceBaseUrl` in scope (used for the existing `embedImages` wiring).

- [ ] **Step 3: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/vector-client.ts apps/worker/src/db-queries.ts apps/worker/src/index.ts
git commit -m "feat(worker): upsert every written embedding into Qdrant alongside Postgres"
```

---

### Task 4: Web — `retrieveCandidates` searches Qdrant, hydrates from Postgres

**Files:**
- Create: `apps/web/lib/vector-client.ts`
- Modify: `apps/web/lib/search/retrieval.ts`

**Interfaces:**
- Consumes: `POST /vector/search` (Task 2).
- Produces: `retrieveCandidates`'s public signature and return type stay unchanged (same `RetrievedCandidate[]`) — only its internals change from a raw SQL similarity query to a Qdrant search + Postgres hydration. No caller of `retrieveCandidates` needs to change.

- [ ] **Step 1: Write the search client**

```ts
// apps/web/lib/vector-client.ts
export interface VectorSearchHit {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

export async function searchVectors(
  inferenceBaseUrl: string,
  collection: string,
  vector: number[],
  topK: number
): Promise<VectorSearchHit[]> {
  const res = await fetch(`${inferenceBaseUrl}/vector/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ collection, vector, topK }),
  });
  if (!res.ok) {
    throw new Error(`Inference service /vector/search failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { results: VectorSearchHit[] };
  return body.results;
}
```

- [ ] **Step 2: Read `retrieval.ts`'s current full body fresh, then rewrite `retrieveCandidates`'s internals**

Read the current file (its exact shape depends on whether the Lumi 2 plan's column-picker changes have landed — adapt per this plan's Global Constraints). Replace the two raw SQL similarity queries (`perHeading` and `aggregate`) with:

1. Call `searchVectors(inferenceBaseUrl, collection, queryEmbedding, k)` against the images collection (`payload.kind === "image"` entries) to get ranked `{id, score}` hits — `inferenceBaseUrl` needs to be threaded into `retrieveCandidates`'s parameters (it isn't there today; every caller of `retrieveCandidates` already has this value in scope, since they already call `embedQueryImage`/`classifyQueryImage` with it — thread it through the same way).
2. Hydrate: `SELECT id, pano_id, heading, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, embedding::text AS embedding_text FROM indexed_images WHERE id = ANY($1)` for exactly the ids Qdrant returned, then map each hydrated row's data together with its Qdrant `score` (matched by `id`) into the existing `RetrievedCandidate` shape — preserving the existing `similarity` field name (assign Qdrant's `score` to it) so nothing downstream needs to change.
3. Do the equivalent for the "aggregate recall via nearby points, expanded to per-heading images" behavior: search the points collection, then for each returned point id, look up its `pano_id` from `indexed_points` and expand to that pano's images from `indexed_images` exactly as the current code already does — only the similarity-ranking source changes (Qdrant instead of `ORDER BY embedding <=> $1`), the dedup-by-pano/relative-similarity-floor logic after that stays as-is.

- [ ] **Step 3: Update `retrieveCandidates`'s call sites to pass `inferenceBaseUrl`**

Every existing call site (`apps/web/app/api/models/[modelId]/estimate/route.ts`, `apps/web/app/api/model-catalog/publish/route.ts`) already has `inferenceBaseUrl` in a variable in scope — add it as an argument to their existing `retrieveCandidates(...)` calls.

- [ ] **Step 4: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/vector-client.ts apps/web/lib/search/retrieval.ts apps/web/app/api/models/\[modelId\]/estimate/route.ts apps/web/app/api/model-catalog/publish/route.ts
git commit -m "feat(web): retrieveCandidates searches Qdrant and hydrates full rows from Postgres"
```

---

### Task 5: Backfill — migrate everything already indexed into Qdrant

**Files:**
- Create: `services/inference/backfill_qdrant.py`

**Interfaces:**
- Consumes: `vector_store.py` (Task 1), Postgres (`indexed_images`, `indexed_points`).
- Produces: a one-time, manually-run script — not a background job, not wired into any job queue.

- [ ] **Step 1: Write the backfill script**

```python
# services/inference/backfill_qdrant.py
"""
One-time migration: populates the embedded Qdrant index from whatever is
already indexed in Postgres today (spec: docs/superpowers/specs/2026-07-
23-qdrant-vector-search-design.md, "Migrating what's already indexed").
Run manually once when rolling this feature out — not a recurring job.

Usage: venv/bin/python backfill_qdrant.py
Reads POSTGRES_HOST/PORT/USER/PASSWORD/DB the same way main.py does.
"""
import os
import psycopg2
from vector_store import upsert_vector

def _connect():
    return psycopg2.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        user=os.environ.get("POSTGRES_USER", "netryx"),
        password=os.environ.get("POSTGRES_PASSWORD", "changeme"),
        dbname=os.environ.get("POSTGRES_DB", "netryx_dev"),
    )

def _backfill_table(cur, table: str, kind: str, embedding_col: str, collection: str) -> int:
    cur.execute(f"SELECT id, {embedding_col}::text FROM {table} WHERE {embedding_col} IS NOT NULL")
    rows = cur.fetchall()
    for row_id, embedding_text in rows:
        vector = [float(x) for x in embedding_text.strip("[]").split(",")]
        upsert_vector(collection, str(row_id), vector, {"kind": kind})
    return len(rows)

def main() -> None:
    conn = _connect()
    try:
        cur = conn.cursor()
        n1 = _backfill_table(cur, "indexed_images", "image", "embedding", "lumi-preview")
        n2 = _backfill_table(cur, "indexed_points", "point", "embedding", "lumi-preview")
        print(f"Backfilled {n1} indexed_images + {n2} indexed_points into the 'lumi-preview' collection.")
        # If embedding_lumi2 columns exist in this branch (Lumi 2 plan landed),
        # also backfill those into the "lumi-2" collection — check the columns
        # exist first (this plan may run before or after that one merges):
        cur.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'indexed_images' AND column_name = 'embedding_lumi2'"
        )
        if cur.fetchone():
            n3 = _backfill_table(cur, "indexed_images", "image", "embedding_lumi2", "lumi-2")
            n4 = _backfill_table(cur, "indexed_points", "point", "embedding_lumi2", "lumi-2")
            print(f"Backfilled {n3} indexed_images + {n4} indexed_points into the 'lumi-2' collection.")
    finally:
        conn.close()

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the backfill against the real database**

```bash
cd /home/s7lver/Lumi/services/inference && venv/bin/python backfill_qdrant.py
```

Expected: prints the counts backfilled (e.g. "Backfilled N indexed_images + M indexed_points into the 'lumi-preview' collection."), exit code 0. This is the step that actually migrates the user's existing real indexed data (León, etc.) — do not skip it.

- [ ] **Step 3: Commit**

```bash
git add services/inference/backfill_qdrant.py
git commit -m "feat(inference): add one-time Qdrant backfill script for already-indexed data"
```

---

### Task 6: Final verification pass

**Files:** none — verification only.

- [ ] **Step 1: Typecheck/import-check every touched package**

```bash
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
cd /home/s7lver/Lumi/services/inference && venv/bin/python -c "import main; import vector_store; import backfill_qdrant"
```

Expected: no errors from any of the three.

- [ ] **Step 2: Build the web app**

```bash
cd /home/s7lver/Lumi/apps/web && npx next build
```

Expected: build succeeds.

- [ ] **Step 3: Report to the user**

No commit for this task. Summarize: all 5 implementation tasks done, the backfill script ran and migrated N existing rows, and the real search path (`retrieveCandidates`) now genuinely goes through Qdrant rather than the old exact pgvector query — confirm this explicitly, since the user asked specifically for a real cutover, not a dormant parallel system.
