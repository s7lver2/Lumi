# Search Pass 1 — Retrieval + Lumi Preview + Spatial Clustering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an already-indexed area searchable: upload a query image, get back geographically clustered candidate **regions** ranked by embedding similarity, applying the Lumi Preview retrieval enhancements (multi-heading aggregation, test-time augmentation, query-expansion re-ranking) — spec §9.2, §15.1.

**Architecture:** `apps/web`'s new `POST /api/search` saves the uploaded image, asks `services/inference` for its descriptor **with test-time augmentation on** (`/embed?augment`), runs a cosine top-k over `indexed_images` (per-heading) **and** the new per-pano aggregate descriptors in pgvector (exact/sequential scan — pgvector's `hnsw`/`ivfflat` indexes cap out at 2000 dimensions and MegaLoc's embedding is 8448-d, so no ANN index is possible here; see Task 1), re-ranks the union with query expansion, clusters the survivors into regions with a greedy radius pass (turf.js), and persists `searches`/`search_regions`/`search_candidates`. No geometric verification runs here — that is Pass 2 (`verification_score` stays `NULL`, `status` stays `'unreviewed'`). One already-built piece changes: the worker never stored the per-pano aggregate descriptor Lumi Preview needs — that's added here.

**Tech Stack:** TypeScript (web), Python 3.11 + FastAPI + NumPy + Pillow (inference), Postgres + pgvector + PostGIS, node-pg-migrate, @turf/turf, vitest, pytest.

**Depends on:** Foundation plan (schema, `system_settings`, settings repo) and Indexing Pipeline plan (worker, `indexed_images`, inference `/embed`) — both merged.

**Out of scope for this plan (Pass 2 — see `2026-07-09-search-pass2-refine.md`):** `POST /api/search/:id/refine`, the inference `/verify` endpoint, Laila/RoMa, MAGSAC++, storing Street View image bytes at index time, the `/`, `/areas`, `ResultsPanel`, `ConfidenceCircleLayer`, and map UI (Dashboard & Map UI plan), and `api_usage` bookkeeping (Cost tracking plan).

## Global Constraints

- **Language/strictness:** TypeScript `strict` for web/packages; Python 3.11 for inference. Copy the tsconfig style of existing packages verbatim.
- **Embeddings:** `vector(8448)`, always L2-normalized before storage or comparison (matches `services/inference/main.py` and `indexed_images.embedding`).
- **No fine-tuning:** Lumi Preview is a wrapper around **frozen** MegaLoc — every enhancement here is pre/post-processing or algebra over existing embeddings, never a weight change (spec §2, §15).
- **Product naming:** the model is "Lumi Preview" in any user-facing string; "MegaLoc" only appears internally (spec §15).
- **No auth** (spec §10.3) — routes assume a trusted network.
- **Windows-native, no Docker required** (spec §7.1) — all paths use `node:path`, no shell-specific commands in code.
- **Calibration honesty:** query-expansion and TTA parameters ship as sensible, configurable defaults; the spec (§15.1) says they are "afinado con datos reales" — this plan does not claim they are tuned, only that they are wired correctly.
- **Route-export rule:** Next.js App Router `route.ts` may export only HTTP handlers (`GET`/`POST`/…) and config — put every helper in a sibling module (learned bug, see `app/api/areas/[id]/progress/`).
- **`apps/web` does not read the monorepo root `.env` by default** — Next.js only auto-loads `.env`/`.env.local` from its own app directory. Confirmed by actually running `pnpm dev`: `getPool()`'s `POSTGRES_PASSWORD` came back `undefined` and `pg` failed SASL auth. `apps/web/next.config.js` must load the root `.env` explicitly with `dotenv`, the same way `apps/worker/src/index.ts` already does — add `dotenv` to `apps/web/package.json` and, at the top of `next.config.js`, `require("dotenv").config({ path: require("node:path").resolve(__dirname, "../../.env") })` before `module.exports`. Do this once, before Task 12's manual verification step, not per-task.
- **TDD, DRY, YAGNI, frequent commits.**

---

## File Structure

```
netryx-fork/
├── db/
│   ├── migrations/
│   │   └── 1720500000000_search_retrieval_indexes.js   # Task 1
│   └── test/
│       └── migrations.test.ts                          # Modify (Task 1)
├── packages/
│   └── shared-types/
│       └── src/
│           ├── search.ts                                # Task 2
│           ├── search.test.ts                           # Task 2
│           └── index.ts                                 # Modify (Task 2)
├── services/
│   └── inference/
│       ├── tta.py                                        # Task 3
│       ├── test_tta.py                                   # Task 3
│       ├── main.py                                       # Modify (Task 3)
│       └── test_main.py                                  # Modify (Task 3)
├── apps/
│   ├── worker/
│   │   └── src/
│   │       ├── aggregate.ts                              # Task 4
│   │       ├── aggregate.test.ts                         # Task 4
│   │       ├── jobs/index-area.ts                        # Modify (Task 4)
│   │       ├── jobs/index-area.test.ts                   # Modify (Task 4)
│   │       ├── db-queries.ts                             # Modify (Task 4)
│   │       └── index.ts                                  # Modify (Task 4)
│   └── web/
│       ├── .env.example                                  # Modify (Task 5)
│       └── lib/
│           ├── query-image-store.ts                     # Task 5
│           ├── query-image-store.test.ts                # Task 5
│           ├── inference-client.ts                       # Task 6
│           ├── inference-client.test.ts                  # Task 6
│           └── search/
│               ├── retrieval.ts                          # Task 7
│               ├── retrieval.test.ts                     # Task 7
│               ├── rerank.ts                             # Task 8
│               ├── rerank.test.ts                         # Task 8
│               ├── cluster.ts                             # Task 9
│               ├── cluster.test.ts                        # Task 9
│               ├── persist.ts                             # Task 10
│               ├── persist.test.ts                        # Task 10
│               ├── run-search.ts                          # Task 11
│               └── run-search.test.ts                     # Task 11
│       └── app/api/search/
│           └── route.ts                                   # Task 12
└── docs/
    └── 2026-07-09-search-pass1-retrieval.md              # this file
```

---

### Task 1: Migration — per-pano aggregate table (and why there's no `hnsw` index)

The spec's §11 shows an `hnsw` index on `indexed_images.embedding`, and the init migration never created it. **It cannot be created**: pgvector hard-caps `hnsw`/`ivfflat` indexes at 2000 dimensions (the `vector` type itself stores up to 16000, but neither ANN index type can be built above 2000) — MegaLoc's embedding is 8448-d, so this column is not ANN-indexable as-is. Confirmed by actually running the migration: `error: column cannot have more than 2000 dimensions for hnsw index`. This matches spec §3.3's own original call ("búsqueda por coseno directa, sin FAISS/HNSW... no se necesita ANN aproximado todavía") — exact/sequential cosine scan is intentional at this scale, not an oversight to fix here. Revisit with dimensionality reduction or pgvector's binary-quantization support if the index grows enough for sequential scan to matter. Lumi Preview also needs a per-pano **aggregate** descriptor (mean of a pano's heading embeddings, §15.1) which has nowhere to live today — that's what this task actually adds.

**Files:**
- Create: `db/migrations/1720500000000_search_retrieval_indexes.js`
- Modify: `db/test/migrations.test.ts`

**Interfaces:**
- Produces: table `indexed_points (id uuid pk, area_id uuid fk→areas, pano_id text UNIQUE, location geography(Point,4326), embedding vector(8448), created_at timestamptz)`; index `idx_indexed_points_location` (GIST). No `hnsw` index on either embedding column (see above).

- [ ] **Step 1: Add failing assertions to the migrations test**

```typescript
// db/test/migrations.test.ts — add inside the existing describe("init migration") block
it("does not attempt an hnsw index on indexed_images.embedding (pgvector caps hnsw at 2000 dims, embedding is 8448-d)", async () => {
  const { rows } = await client.query(
    `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_indexed_images_embedding'`
  );
  expect(rows).toHaveLength(0);
});

it("creates indexed_points with a unique pano_id and an aggregate embedding column", async () => {
  const testArea = "00000000-0000-0000-0000-0000000000a1";
  await client.query(`DELETE FROM areas WHERE id = $1`, [testArea]);
  try {
    await client.query(
      `INSERT INTO areas (id, geometry, area_km2)
       VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 1.0)`,
      [testArea]
    );
    await client.query(
      `INSERT INTO indexed_points (area_id, pano_id, location, embedding)
       VALUES ($1, 'pano-agg-1', ST_GeogFromText('POINT(0.5 0.5)'), $2)`,
      [testArea, `[${new Array(8448).fill(0).join(",")}]`]
    );
    // UNIQUE(pano_id) — a second insert of the same pano must conflict
    await expect(
      client.query(
        `INSERT INTO indexed_points (area_id, pano_id, location, embedding)
         VALUES ($1, 'pano-agg-1', ST_GeogFromText('POINT(0.5 0.5)'), $2)`,
        [testArea, `[${new Array(8448).fill(0).join(",")}]`]
      )
    ).rejects.toThrow(/duplicate key|unique/i);
  } finally {
    await client.query(`DELETE FROM areas WHERE id = $1`, [testArea]);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd db && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test`
Expected: FAIL — `relation "indexed_points" does not exist` (the hnsw-absence test passes trivially before the migration since the index never existed; it's there to lock in the decision, not to fail first).

- [ ] **Step 3: Write the migration**

```javascript
// db/migrations/1720500000000_search_retrieval_indexes.js
exports.shorthands = undefined;

// NOTE on why there is no hnsw/ivfflat index here: pgvector hard-caps ANN
// indexes (hnsw and ivfflat) at 2000 dimensions — the vector type itself
// stores up to 16000, but neither index type can be built above 2000
// ("column cannot have more than 2000 dimensions for hnsw index"). MegaLoc's
// embedding is 8448-d, so embedding columns here are NOT ANN-indexable as-is.
// This matches spec §3.3's own original call ("búsqueda por coseno directa,
// sin FAISS/HNSW... no se necesita ANN aproximado todavía") — exact/sequential
// cosine scan is intentional at this scale, not an oversight. Revisit with
// dimensionality reduction or pgvector's binary-quantization support if the
// index grows enough for sequential scan to matter.
exports.up = (pgm) => {
  // Per-pano aggregate descriptor (mean of a pano's heading embeddings),
  // Lumi Preview multi-heading aggregation (spec §15.1). Keyed by pano_id so it
  // dedupes across overlapping areas exactly like indexed_images does.
  pgm.sql(`
    CREATE TABLE indexed_points (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      area_id      uuid NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
      pano_id      text NOT NULL UNIQUE,
      location     geography(Point, 4326) NOT NULL,
      embedding    vector(8448) NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`CREATE INDEX idx_indexed_points_location ON indexed_points USING GIST (location);`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS indexed_points;`);
};
```

- [ ] **Step 4: Apply the migration to the test DB, then the dev DB**

Run: `cd db && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm migrate:up:test && pnpm migrate:up`
Expected: `Migrating files: - 1720500000000_search_retrieval_indexes` then `Migrations complete!` for both.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd db && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test`
Expected: PASS — all migration tests green.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/1720500000000_search_retrieval_indexes.js db/test/migrations.test.ts
git commit -m "feat(db): add indexed_points aggregate table; document why hnsw is impossible on 8448-d embeddings (spec §11, §15.1)"
```

---

### Task 2: Shared types + tuning constants for search

**Files:**
- Create: `packages/shared-types/src/search.ts`
- Create: `packages/shared-types/src/search.test.ts`
- Modify: `packages/shared-types/src/index.ts`

**Interfaces:**
- Produces: `DEFAULT_TOP_K`, `DEFAULT_REGION_RADIUS_M`, `DEFAULT_QUERY_EXPANSION_SIZE`; types `SearchRegion`, `SearchCandidate`, `SearchResponse`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared-types/src/search.test.ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_TOP_K,
  DEFAULT_REGION_RADIUS_M,
  DEFAULT_QUERY_EXPANSION_SIZE,
} from "./search";

describe("search tuning constants", () => {
  it("uses the spec's k=50 top-k default (spec §9.2)", () => {
    expect(DEFAULT_TOP_K).toBe(50);
  });

  it("has a positive region radius and a query-expansion size smaller than top-k", () => {
    expect(DEFAULT_REGION_RADIUS_M).toBeGreaterThan(0);
    expect(DEFAULT_QUERY_EXPANSION_SIZE).toBeGreaterThan(0);
    expect(DEFAULT_QUERY_EXPANSION_SIZE).toBeLessThan(DEFAULT_TOP_K);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared-types && pnpm test search.test.ts`
Expected: FAIL — `Cannot find module './search'`.

- [ ] **Step 3: Implement `search.ts`**

```typescript
// packages/shared-types/src/search.ts

/** Spec §9.2 — top-k candidates pulled by cosine before clustering. */
export const DEFAULT_TOP_K = 50;

/** Radius (metres) within which candidates are grouped into one region (spec §9.2 clustering). */
export const DEFAULT_REGION_RADIUS_M = 150;

/** How many top candidates feed the query-expansion re-ranking (Lumi Preview, spec §15.1). */
export const DEFAULT_QUERY_EXPANSION_SIZE = 5;

/** One clustered region returned by Pass 1 — mirrors the search_regions row (spec §11, §13). */
export interface SearchRegion {
  id: string;
  centroid: { lat: number; lng: number };
  radiusM: number;
  aggregateScore: number;
  candidateCount: number;
}

/** One ranked candidate image within a region (spec §11, §13). verificationScore is null until Pass 2. */
export interface SearchCandidate {
  id: string;
  regionId: string | null;
  indexedImageId: string;
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  similarityScore: number;
  verificationScore: number | null;
  rank: number;
  status: "unreviewed" | "confirmed";
}

/** Response body of POST /api/search (Pass 1). */
export interface SearchResponse {
  searchId: string;
  regions: SearchRegion[];
  candidatesByRegion: Record<string, SearchCandidate[]>;
}
```

- [ ] **Step 4: Add to the barrel export**

```typescript
// packages/shared-types/src/index.ts — add this line
export * from "./search";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/shared-types && pnpm test`
Expected: PASS — new tests plus all existing ones green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/search.ts packages/shared-types/src/search.test.ts packages/shared-types/src/index.ts
git commit -m "feat(shared-types): search region/candidate DTOs and Pass 1 tuning constants (spec §9.2, §13)"
```

---

### Task 3: Inference `/embed` — test-time augmentation for queries (Lumi Preview)

`/embed` currently embeds each image once. Lumi Preview's query TTA (spec §15.1) embeds the query in its original form plus a horizontal flip and a center crop, then averages the L2-normalized descriptors. This must be **opt-in** (`augment`) so the indexing worker keeps embedding index images exactly once, unaugmented.

**Files:**
- Create: `services/inference/tta.py`
- Create: `services/inference/test_tta.py`
- Modify: `services/inference/main.py`
- Modify: `services/inference/test_main.py`

**Interfaces:**
- Consumes: `model(list[np.ndarray]) -> list[vector]` (existing MegaLoc call in `main.py`).
- Produces: `augment_variants(img: np.ndarray) -> list[np.ndarray]`; `mean_normalize(vectors: list[np.ndarray]) -> np.ndarray`; `/embed` accepts `{"images_base64": [...], "augment": bool}` (default `false`).

- [ ] **Step 1: Write the failing test for the pure TTA helpers**

```python
# services/inference/test_tta.py
import numpy as np
from tta import augment_variants, mean_normalize


def test_augment_variants_returns_original_flip_and_crop():
    img = np.arange(4 * 4 * 3, dtype=np.uint8).reshape(4, 4, 3)
    variants = augment_variants(img)
    assert len(variants) == 3
    # variant 0 is the original
    assert np.array_equal(variants[0], img)
    # variant 1 is the horizontal flip (columns reversed)
    assert np.array_equal(variants[1], img[:, ::-1, :])
    # variant 2 (center crop) is smaller than the original in both spatial dims
    assert variants[2].shape[0] < img.shape[0]
    assert variants[2].shape[1] < img.shape[1]


def test_mean_normalize_produces_a_unit_vector():
    vecs = [np.array([3.0, 0.0]), np.array([0.0, 4.0])]
    out = mean_normalize(vecs)
    assert np.isclose(np.linalg.norm(out), 1.0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/inference && ./venv/Scripts/python -m pytest test_tta.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tta'`.

- [ ] **Step 3: Implement `tta.py`**

```python
# services/inference/tta.py
"""
Test-time augmentation for query images (Lumi Preview, spec §15.1). Pure NumPy —
no torch, no model — so it is unit-testable without loading MegaLoc. Applied only
to the user's query image, never to index images (those stay single-pass, spec §4).
"""
import numpy as np


def augment_variants(img: np.ndarray) -> list[np.ndarray]:
    """Original + horizontal flip + center crop (80% of each spatial dim)."""
    h, w = img.shape[0], img.shape[1]
    ch, cw = int(h * 0.8), int(w * 0.8)
    top, left = (h - ch) // 2, (w - cw) // 2
    center_crop = img[top : top + ch, left : left + cw, ...]
    return [img, img[:, ::-1, ...], center_crop]


def mean_normalize(vectors: list[np.ndarray]) -> np.ndarray:
    """Mean of the vectors, L2-normalized (matches how /embed normalizes)."""
    stacked = np.stack([np.asarray(v, dtype=np.float64) for v in vectors], axis=0)
    mean = stacked.mean(axis=0)
    norm = np.linalg.norm(mean)
    return mean / norm if norm > 0 else mean
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/inference && ./venv/Scripts/python -m pytest test_tta.py -v`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Write the failing test for the `augment` flag on `/embed`**

```python
# services/inference/test_main.py — add to the existing test module
def test_embed_with_augment_runs_the_model_on_three_variants_per_image(client, fake_model):
    # fake_model records how many images it was asked to embed in total.
    import base64, io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (120, 30, 200)).save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()

    resp = client.post("/embed", json={"images_base64": [b64], "augment": True})
    assert resp.status_code == 200
    # one query image -> 3 augmented variants passed to the model
    assert fake_model.total_images_seen == 3
    # a single averaged, unit-length descriptor comes back
    out = resp.json()["embeddings"]
    assert len(out) == 1
    import numpy as np
    assert np.isclose(np.linalg.norm(np.array(out[0])), 1.0, atol=1e-6)
```

If `test_main.py` has no `fake_model`/`client` fixtures yet, add them:

```python
# services/inference/test_main.py — fixtures (add near the top if absent)
import numpy as np
import pytest
from fastapi.testclient import TestClient
import main


class _FakeModel:
    def __init__(self):
        self.total_images_seen = 0

    def __call__(self, batch):
        self.total_images_seen += len(batch)
        # deterministic non-zero vector per image so normalization is well-defined
        return [np.ones(8448, dtype=np.float64) * (i + 1) for i in range(len(batch))]


@pytest.fixture
def fake_model():
    return _FakeModel()


@pytest.fixture
def client(fake_model):
    main.app.dependency_overrides[main.get_retrieval_model] = lambda: fake_model
    with TestClient(main.app) as c:
        yield c
    main.app.dependency_overrides.clear()
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd services/inference && ./venv/Scripts/python -m pytest test_main.py -k augment -v`
Expected: FAIL — augment is ignored, `total_images_seen == 1`.

- [ ] **Step 7: Implement the `augment` branch in `main.py` — and convert to the tensor MegaLoc actually needs**

`model(images)` on the **real** MegaLoc model crashes with `AttributeError: 'list' object has no attribute 'shape'` — confirmed by actually running it end-to-end. MegaLoc's `forward(self, images: torch.Tensor)` expects a single `[B, 3, H, W]` float tensor (it resizes internally to a multiple of 14 — a ViT/DINOv2-style patch-14 backbone — but still needs one fixed size per batch to stack), not a Python list of HWC uint8 arrays. `_decode_image` only produces the latter. Add the conversion; it is invisible to the existing fakes in `test_main.py` since they only call `len(batch)`.

```python
# services/inference/main.py — replace the EmbedRequest class and the embed() body
import torch  # add to the imports block, alongside numpy
from tta import augment_variants, mean_normalize  # add to the imports block


class EmbedRequest(BaseModel):
    images_base64: list[str]
    augment: bool = False  # Lumi Preview query TTA (spec §15.1); off for index images


# ImageNet mean/std is the standard normalization for pretrained ViT backbones
# like this one (MegaLoc's hubconf/README document no alternative).
_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
_MODEL_INPUT_SIZE = 224


def _to_model_batch(images: list[np.ndarray]) -> torch.Tensor:
    """Converts decoded HWC uint8 RGB images into MegaLoc's [B, 3, H, W] input tensor."""
    tensors = []
    for img in images:
        resized = Image.fromarray(img).resize((_MODEL_INPUT_SIZE, _MODEL_INPUT_SIZE), Image.BILINEAR)
        arr = np.asarray(resized, dtype=np.float32) / 255.0
        arr = (arr - _IMAGENET_MEAN) / _IMAGENET_STD
        tensors.append(torch.from_numpy(arr.transpose(2, 0, 1)).float())
    return torch.stack(tensors, dim=0)


def _run_model(model, images: list[np.ndarray]) -> np.ndarray:
    """
    Runs the retrieval model and returns a plain float64 numpy array of
    descriptors — works whether `model` is the real torch model (returns a
    Tensor that needs detaching) or a test fake (returns a list/np.ndarray
    already), since both only rely on len(batch) and iteration.
    """
    batch = _to_model_batch(images)
    with torch.no_grad():
        output = model(batch)
    if isinstance(output, torch.Tensor):
        output = output.detach().cpu().numpy()
    return np.asarray(output, dtype=np.float64)


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest, model=Depends(get_retrieval_model)) -> EmbedResponse:
    if len(request.images_base64) == 0:
        raise HTTPException(status_code=400, detail="images_base64 must not be empty")

    images = [_decode_image(img) for img in request.images_base64]

    if request.augment:
        embeddings = []
        for img in images:
            variants = augment_variants(img)
            raw_vectors = _run_model(model, variants)
            embeddings.append(mean_normalize(raw_vectors).tolist())
        return EmbedResponse(embeddings=embeddings)

    raw_vectors = _run_model(model, images)
    embeddings = []
    for vec in raw_vectors:
        vec = np.asarray(vec, dtype=np.float64)
        norm = np.linalg.norm(vec)
        normalized = vec / norm if norm > 0 else vec
        embeddings.append(normalized.tolist())
    return EmbedResponse(embeddings=embeddings)
```

- [ ] **Step 7b: Verify against the real model, not just fakes**

Run: `cd services/inference && ./venv/Scripts/uvicorn main:app --port 8000` (requires Postgres up and `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` resolvable — defaults are fine), then in another shell POST a real image with `augment: true` and confirm a 200 with one 8448-length unit-norm vector back. This step exists because the unit tests in Step 8 only exercise fakes and would not have caught the tensor-shape bug above.

- [ ] **Step 8: Run the full inference test suite**

Run: `cd services/inference && ./venv/Scripts/python -m pytest -v`
Expected: PASS — TTA tests, augment endpoint test, and all pre-existing `/embed` tests green.

- [ ] **Step 9: Commit**

```bash
git add services/inference/tta.py services/inference/test_tta.py services/inference/main.py services/inference/test_main.py
git commit -m "feat(inference): opt-in query-side test-time augmentation on /embed (Lumi Preview, spec §15.1)"
```

---

### Task 4: Worker — persist the per-pano aggregate descriptor (Lumi Preview multi-heading aggregation)

At the end of a job the worker has one embedding per `(pano, heading)`. Lumi Preview also stores one **aggregate** descriptor per pano: the L2-normalized mean of that pano's heading embeddings (spec §15.1). Compute it and write it to `indexed_points`.

**Files:**
- Create: `apps/worker/src/aggregate.ts`
- Create: `apps/worker/src/aggregate.test.ts`
- Modify: `apps/worker/src/jobs/index-area.ts`
- Modify: `apps/worker/src/jobs/index-area.test.ts`
- Modify: `apps/worker/src/db-queries.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: `StreetViewCapture { panoId, heading, lat, lng, ... }`, `embeddings: number[][]` aligned with `captures`.
- Produces: `aggregatePanoDescriptors(captures, embeddings) -> IndexedPointInsert[]` where `IndexedPointInsert = { panoId: string; lat: number; lng: number; embedding: number[] }`; `insertIndexedPoints(pool, areaId, points): Promise<void>`; new dep `insertIndexedPoints` on `IndexAreaJobDeps`.

- [ ] **Step 1: Write the failing test for the aggregation helper**

```typescript
// apps/worker/src/aggregate.test.ts
import { describe, it, expect } from "vitest";
import { aggregatePanoDescriptors } from "./aggregate";
import type { StreetViewCapture } from "@netryx/shared-types";

function capture(panoId: string, heading: number): StreetViewCapture {
  return { panoId, heading, lat: 1, lng: 2, captureDate: null, imageBase64: "" };
}

describe("aggregatePanoDescriptors", () => {
  it("produces one L2-normalized mean descriptor per distinct pano", () => {
    const captures = [capture("pano-a", 0), capture("pano-a", 90), capture("pano-b", 0)];
    const embeddings = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const points = aggregatePanoDescriptors(captures, embeddings);

    expect(points).toHaveLength(2);
    const a = points.find((p) => p.panoId === "pano-a")!;
    // mean of [1,0,0] and [0,1,0] = [0.5,0.5,0], normalized = [~0.707,~0.707,0]
    expect(a.embedding[0]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(a.embedding[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(Math.hypot(...a.embedding)).toBeCloseTo(1, 5);
  });

  it("carries the pano's location through from the first capture of that pano", () => {
    const captures = [{ ...capture("pano-a", 0), lat: 40.1, lng: -3.7 }];
    const points = aggregatePanoDescriptors(captures, [[2, 0]]);
    expect(points[0].lat).toBe(40.1);
    expect(points[0].lng).toBe(-3.7);
    expect(Math.hypot(...points[0].embedding)).toBeCloseTo(1, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && pnpm test aggregate.test.ts`
Expected: FAIL — `Cannot find module './aggregate'`.

- [ ] **Step 3: Implement `aggregate.ts`**

```typescript
// apps/worker/src/aggregate.ts
import type { StreetViewCapture } from "@netryx/shared-types";

export interface IndexedPointInsert {
  panoId: string;
  lat: number;
  lng: number;
  embedding: number[];
}

/**
 * Groups embeddings by pano and returns the L2-normalized mean descriptor per
 * pano — Lumi Preview's multi-heading aggregation (spec §15.1). `embeddings[i]`
 * must correspond to `captures[i]`.
 */
export function aggregatePanoDescriptors(
  captures: StreetViewCapture[],
  embeddings: number[][]
): IndexedPointInsert[] {
  const byPano = new Map<string, { lat: number; lng: number; vectors: number[][] }>();

  captures.forEach((capture, i) => {
    const entry = byPano.get(capture.panoId);
    if (entry) {
      entry.vectors.push(embeddings[i]);
    } else {
      byPano.set(capture.panoId, {
        lat: capture.lat,
        lng: capture.lng,
        vectors: [embeddings[i]],
      });
    }
  });

  const points: IndexedPointInsert[] = [];
  for (const [panoId, { lat, lng, vectors }] of byPano) {
    const dim = vectors[0].length;
    const mean = new Array(dim).fill(0);
    for (const v of vectors) for (let d = 0; d < dim; d++) mean[d] += v[d];
    for (let d = 0; d < dim; d++) mean[d] /= vectors.length;
    const norm = Math.hypot(...mean);
    const embedding = norm > 0 ? mean.map((x) => x / norm) : mean;
    points.push({ panoId, lat, lng, embedding });
  }
  return points;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && pnpm test aggregate.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Add `insertIndexedPoints` to `db-queries.ts`**

```typescript
// apps/worker/src/db-queries.ts — add this export (and import the type)
import type { IndexedPointInsert } from "./aggregate";

export async function insertIndexedPoints(
  pool: Pool,
  areaId: string,
  points: IndexedPointInsert[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const p of points) {
      await client.query(
        `INSERT INTO indexed_points (area_id, pano_id, location, embedding)
         VALUES ($1, $2, ST_GeogFromText($3), $4)
         ON CONFLICT (pano_id) DO NOTHING`,
        [areaId, p.panoId, `POINT(${p.lng} ${p.lat})`, `[${p.embedding.join(",")}]`]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 6: Add a failing test for the job wiring the aggregate insert**

```typescript
// apps/worker/src/jobs/index-area.test.ts — add a test asserting insertIndexedPoints is called
it("computes and persists one aggregate descriptor per pano (spec §15.1)", async () => {
  const insertIndexedPoints = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({
    // two captures share pano-a, one is pano-b -> 2 aggregate points
    captures: [
      { panoId: "pano-a", heading: 0, lat: 1, lng: 2, captureDate: null, imageBase64: "x" },
      { panoId: "pano-a", heading: 90, lat: 1, lng: 2, captureDate: null, imageBase64: "y" },
      { panoId: "pano-b", heading: 0, lat: 3, lng: 4, captureDate: null, imageBase64: "z" },
    ],
    embeddings: [
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    insertIndexedPoints,
  });

  await runIndexAreaJob({ areaId: "area-1" }, deps);

  expect(insertIndexedPoints).toHaveBeenCalledTimes(1);
  const [, points] = insertIndexedPoints.mock.calls[0];
  expect(points).toHaveLength(2);
});
```

> The existing `index-area.test.ts` already builds a `deps` object; extend its `makeDeps` helper (or inline object) to accept `insertIndexedPoints` (default `vi.fn().mockResolvedValue(undefined)`) and to let `captures`/`embeddings` be overridden. If there is no `makeDeps` helper, add one that returns the full `IndexAreaJobDeps` with sensible fakes, since later steps rely on it.

- [ ] **Step 7: Run test to verify it fails**

Run: `cd apps/worker && pnpm test index-area.test.ts -t "aggregate descriptor"`
Expected: FAIL — `insertIndexedPoints` is never called.

- [ ] **Step 8: Wire the aggregate into `runIndexAreaJob`**

```typescript
// apps/worker/src/jobs/index-area.ts
// 1) add the import
import { aggregatePanoDescriptors, type IndexedPointInsert } from "../aggregate";

// 2) extend the deps interface
//    (add this line inside IndexAreaJobDeps)
    insertIndexedPoints: (areaId: string, points: IndexedPointInsert[]) => Promise<void>;

// 3) after `await deps.insertIndexedImages(areaId, inserts);`, insert the aggregates:
    const aggregatePoints = aggregatePanoDescriptors(captures, embeddings);
    await deps.insertIndexedPoints(areaId, aggregatePoints);
```

- [ ] **Step 9: Wire the real query in `apps/worker/src/index.ts`**

```typescript
// apps/worker/src/index.ts
// add insertIndexedPoints to the import from "./db-queries"
import { getArea, getAreaPolygon, insertIndexedImages, insertIndexedPoints } from "./db-queries";

// add to the deps object passed to runIndexAreaJob:
      insertIndexedPoints: (areaId, points) => insertIndexedPoints(pool, areaId, points),
```

- [ ] **Step 10: Run the worker test suite**

Run: `cd apps/worker && pnpm test`
Expected: PASS — aggregate tests + updated index-area tests + all existing worker tests green.

- [ ] **Step 11: Commit**

```bash
git add apps/worker/src/aggregate.ts apps/worker/src/aggregate.test.ts apps/worker/src/jobs/index-area.ts apps/worker/src/jobs/index-area.test.ts apps/worker/src/db-queries.ts apps/worker/src/index.ts
git commit -m "feat(worker): store per-pano aggregate descriptor for Lumi Preview (spec §15.1)"
```

---

### Task 5: Web — query image storage

The uploaded query image must persist on disk so Pass 2 can re-read it for geometric verification; Pass 1 records its path in `searches.query_image_path` (spec §11). Files live under a configurable directory, default `./data/queries` (sibling of the `./data/settings.key` convention, spec §14.4), and are `.gitignore`d.

**Files:**
- Create: `apps/web/lib/query-image-store.ts`
- Create: `apps/web/lib/query-image-store.test.ts`
- Modify: `apps/web/.env.example`

**Interfaces:**
- Produces: `saveQueryImage(searchId: string, bytes: Buffer, ext: string): Promise<string>` returning the absolute path written.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/query-image-store.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveQueryImage } from "./query-image-store";

const DIR = join(tmpdir(), "netryx-query-test");

afterEach(async () => {
  await rm(DIR, { recursive: true, force: true });
});

describe("saveQueryImage", () => {
  it("writes the bytes to <QUERY_IMAGE_DIR>/<searchId>.<ext> and returns that path", async () => {
    process.env.QUERY_IMAGE_DIR = DIR;
    const bytes = Buffer.from([1, 2, 3, 4]);
    const path = await saveQueryImage("search-123", bytes, "jpg");
    expect(path).toBe(join(DIR, "search-123.jpg"));
    expect(await readFile(path)).toEqual(bytes);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test query-image-store.test.ts`
Expected: FAIL — `Cannot find module './query-image-store'`.

- [ ] **Step 3: Implement `query-image-store.ts`**

```typescript
// apps/web/lib/query-image-store.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Directory query images are written to; overridable so tests don't touch ./data. */
function queryImageDir(): string {
  return process.env.QUERY_IMAGE_DIR ?? join(process.cwd(), "data", "queries");
}

/** Persists a query image and returns the absolute path it was written to. */
export async function saveQueryImage(
  searchId: string,
  bytes: Buffer,
  ext: string
): Promise<string> {
  const dir = queryImageDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${searchId}.${ext}`);
  await writeFile(path, bytes);
  return path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test query-image-store.test.ts`
Expected: PASS — 1 test green.

- [ ] **Step 5: Document the env var**

```bash
# apps/web/.env.example — append
# Directory where uploaded query images are stored (Pass 2 re-reads them for
# geometric verification). Defaults to ./data/queries. Keep it out of git.
QUERY_IMAGE_DIR=
# Base URL of the FastAPI inference service (spec §6.2). Defaults to http://localhost:8000.
INFERENCE_SERVICE_URL=
```

Also confirm `data/` is git-ignored (it should be from Foundation's `./data/settings.key` rule); if `apps/web/.gitignore` lacks it, add `data/`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/query-image-store.ts apps/web/lib/query-image-store.test.ts apps/web/.env.example
git commit -m "feat(web): persist uploaded query images to disk for Pass 2 (spec §11)"
```

---

### Task 6: Web — inference client for query embedding (augmented)

The web app needs to call `/embed` with `augment: true` for a single query image and get one descriptor back. This mirrors `apps/worker/src/inference-client.ts` but is query-shaped (one image in, one vector out, augmentation on).

**Files:**
- Create: `apps/web/lib/inference-client.ts`
- Create: `apps/web/lib/inference-client.test.ts`

**Interfaces:**
- Produces: `embedQueryImage(imageBase64: string, inferenceBaseUrl: string): Promise<number[]>`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/inference-client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { embedQueryImage } from "./inference-client";

afterEach(() => vi.unstubAllGlobals());

describe("embedQueryImage", () => {
  it("POSTs one image with augment=true and returns the single descriptor", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const vec = await embedQueryImage("aaaa", "http://localhost:8000");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ images_base64: ["aaaa"], augment: true }),
      })
    );
    expect(vec).toEqual([0.1, 0.2, 0.3]);
  });

  it("throws when the inference service responds non-OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "model not loaded" })
    );
    await expect(embedQueryImage("aaaa", "http://localhost:8000")).rejects.toThrow(
      /Inference service \/embed failed \(503\): model not loaded/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test inference-client.test.ts`
Expected: FAIL — `Cannot find module './inference-client'`.

- [ ] **Step 3: Implement `inference-client.ts`**

```typescript
// apps/web/lib/inference-client.ts

/** Embeds a single query image with Lumi Preview TTA on (spec §15.1). */
export async function embedQueryImage(
  imageBase64: string,
  inferenceBaseUrl: string
): Promise<number[]> {
  const res = await fetch(`${inferenceBaseUrl}/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images_base64: [imageBase64], augment: true }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Inference service /embed failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { embeddings: number[][] };
  return body.embeddings[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test inference-client.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/inference-client.ts apps/web/lib/inference-client.test.ts
git commit -m "feat(web): query-side inference client (augmented /embed)"
```

---

### Task 7: Web — pgvector retrieval (per-heading + aggregate, unioned)

Retrieve the top-k nearest candidates by cosine distance. Primary recall is over `indexed_images` (per-heading, the candidates Pass 2 will verify). To catch points whose per-heading views all missed the query but whose aggregate matches (spec §15.1 "útil cuando la query no tiene un heading dominante"), also search `indexed_points` and expand each aggregate hit to that pano's per-heading images. Union by `indexed_image_id`, keeping the best similarity.

**Files:**
- Create: `apps/web/lib/search/retrieval.ts`
- Create: `apps/web/lib/search/retrieval.test.ts`

**Interfaces:**
- Consumes: `Pool` (from `lib/db`), `queryEmbedding: number[]`, `DEFAULT_TOP_K`.
- Produces: `retrieveCandidates(pool, queryEmbedding, k): Promise<RetrievedCandidate[]>` where `RetrievedCandidate = { indexedImageId: string; panoId: string; heading: number; lat: number; lng: number; similarity: number; embedding: number[] }` (embedding included for Task 8's re-ranking).

- [ ] **Step 1: Write the failing integration test** (gated on `TEST_DATABASE_URL`)

```typescript
// apps/web/lib/search/retrieval.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { retrieveCandidates } from "./retrieval";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip; // skip cleanly when no test DB is configured

d("retrieveCandidates", () => {
  const pool = new Pool({ connectionString: url });
  const areaId = "00000000-0000-0000-0000-0000000000b1";

  function vec(first: number): string {
    const arr = new Array(8448).fill(0);
    arr[0] = first;
    return `[${arr.join(",")}]`;
  }

  beforeAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.query(
      `INSERT INTO areas (id, geometry, area_km2)
       VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))',4326), 1.0)`,
      [areaId]
    );
    // image A points the same way as the query (first dim = 1) -> high similarity
    // image B is orthogonal (first dim = 0, another dim set) -> low similarity
    await pool.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location, embedding, embedded_at)
       VALUES ($1,'pano-a',0, ST_GeogFromText('POINT(0.5 0.5)'), $2, now()),
              ($1,'pano-b',0, ST_GeogFromText('POINT(0.6 0.6)'), $3, now())`,
      [areaId, vec(1), `[${[0, 1, ...new Array(8446).fill(0)].join(",")}]`]
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.end();
  });

  it("returns candidates ordered by cosine similarity, best first", async () => {
    const query = new Array(8448).fill(0);
    query[0] = 1;
    const results = await retrieveCandidates(pool, query, 10);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].panoId).toBe("pano-a");
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    expect(results[0].embedding).toHaveLength(8448);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test retrieval.test.ts`
Expected: FAIL — `Cannot find module './retrieval'`.

- [ ] **Step 3: Implement `retrieval.ts`**

```typescript
// apps/web/lib/search/retrieval.ts
import type { Pool } from "pg";

export interface RetrievedCandidate {
  indexedImageId: string;
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  similarity: number;
  embedding: number[];
}

function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/** Parses pgvector's text output ("[1,2,3]") back into a number[]. */
function parseVector(text: string): number[] {
  return text.slice(1, -1).split(",").map(Number);
}

/**
 * Top-k cosine retrieval over per-heading images, unioned with per-pano
 * aggregate hits expanded to their headings (Lumi Preview, spec §15.1, §9.2).
 * `1 - (embedding <=> q)` converts pgvector cosine distance to similarity.
 */
export async function retrieveCandidates(
  pool: Pool,
  queryEmbedding: number[],
  k: number
): Promise<RetrievedCandidate[]> {
  const q = toVectorLiteral(queryEmbedding);

  const perHeading = await pool.query(
    `SELECT id, pano_id, heading,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            1 - (embedding <=> $1) AS similarity,
            embedding::text AS embedding_text
     FROM indexed_images
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1
     LIMIT $2`,
    [q, k]
  );

  // Aggregate recall: nearest panos, expanded to all their per-heading images.
  const aggregate = await pool.query(
    `SELECT img.id, img.pano_id, img.heading,
            ST_Y(img.location::geometry) AS lat,
            ST_X(img.location::geometry) AS lng,
            1 - (img.embedding <=> $1) AS similarity,
            img.embedding::text AS embedding_text
     FROM (
       SELECT pano_id FROM indexed_points
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1
       LIMIT $2
     ) AS near_panos
     JOIN indexed_images img ON img.pano_id = near_panos.pano_id
     WHERE img.embedding IS NOT NULL`,
    [q, k]
  );

  const byId = new Map<string, RetrievedCandidate>();
  for (const r of [...perHeading.rows, ...aggregate.rows]) {
    const candidate: RetrievedCandidate = {
      indexedImageId: r.id,
      panoId: r.pano_id,
      heading: r.heading,
      lat: Number(r.lat),
      lng: Number(r.lng),
      similarity: Number(r.similarity),
      embedding: parseVector(r.embedding_text),
    };
    const existing = byId.get(candidate.indexedImageId);
    if (!existing || candidate.similarity > existing.similarity) {
      byId.set(candidate.indexedImageId, candidate);
    }
  }

  return [...byId.values()].sort((a, b) => b.similarity - a.similarity);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test retrieval.test.ts`
Expected: PASS — ordered candidates, `pano-a` first.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/retrieval.ts apps/web/lib/search/retrieval.test.ts
git commit -m "feat(web): pgvector top-k retrieval over per-heading + aggregate descriptors (spec §9.2, §15.1)"
```

---

### Task 8: Web — query-expansion re-ranking (Lumi Preview)

Re-rank the retrieved candidates with query expansion (the concrete form of §15.1's "query expansion / k-reciprocal"): build an expanded query = L2-normalized mean of the original query and its top-m candidate embeddings, then re-score every candidate against it. Pure function over vectors already in memory — no extra DB round-trip.

**Files:**
- Create: `apps/web/lib/search/rerank.ts`
- Create: `apps/web/lib/search/rerank.test.ts`

**Interfaces:**
- Consumes: `RetrievedCandidate[]` (from Task 7), `DEFAULT_QUERY_EXPANSION_SIZE`.
- Produces: `queryExpansionRerank(queryEmbedding: number[], candidates: RetrievedCandidate[], expansionSize: number): RetrievedCandidate[]` — same objects, `similarity` overwritten with the re-scored value, sorted best-first.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/search/rerank.test.ts
import { describe, it, expect } from "vitest";
import { queryExpansionRerank } from "./rerank";
import type { RetrievedCandidate } from "./retrieval";

function cand(id: string, embedding: number[], similarity: number): RetrievedCandidate {
  return { indexedImageId: id, panoId: id, heading: 0, lat: 0, lng: 0, similarity, embedding };
}

describe("queryExpansionRerank", () => {
  it("re-scores candidates against the expanded query and sorts best-first", () => {
    const query = [1, 0];
    const candidates = [
      cand("a", [1, 0], 0.9),
      cand("b", [0.8, 0.6], 0.7),
      cand("c", [0, 1], 0.1),
    ];
    const out = queryExpansionRerank(query, candidates, 2);
    expect(out.map((c) => c.indexedImageId)).toEqual(["a", "b", "c"]);
    // scores are cosine similarities in [-1, 1], sorted descending
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].similarity).toBeGreaterThanOrEqual(out[i].similarity);
    }
  });

  it("returns an empty array unchanged", () => {
    expect(queryExpansionRerank([1, 0], [], 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test rerank.test.ts`
Expected: FAIL — `Cannot find module './rerank'`.

- [ ] **Step 3: Implement `rerank.ts`**

```typescript
// apps/web/lib/search/rerank.ts
import type { RetrievedCandidate } from "./retrieval";

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(dot(v, v));
  return norm > 0 ? v.map((x) => x / norm) : v;
}

/**
 * Query expansion (Lumi Preview, spec §15.1): expand the query with the mean of
 * its top-m candidate embeddings, then re-score all candidates against the
 * expanded, re-normalized query. Embeddings are already L2-normalized, so a dot
 * product is cosine similarity.
 */
export function queryExpansionRerank(
  queryEmbedding: number[],
  candidates: RetrievedCandidate[],
  expansionSize: number
): RetrievedCandidate[] {
  if (candidates.length === 0) return [];

  const dim = queryEmbedding.length;
  const topM = candidates.slice(0, Math.min(expansionSize, candidates.length));

  const expanded = queryEmbedding.slice();
  for (const c of topM) for (let d = 0; d < dim; d++) expanded[d] += c.embedding[d];
  for (let d = 0; d < dim; d++) expanded[d] /= topM.length + 1;
  const q = normalize(expanded);

  return candidates
    .map((c) => ({ ...c, similarity: dot(q, c.embedding) }))
    .sort((a, b) => b.similarity - a.similarity);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test rerank.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/rerank.ts apps/web/lib/search/rerank.test.ts
git commit -m "feat(web): query-expansion re-ranking for Lumi Preview (spec §15.1)"
```

---

### Task 9: Web — greedy spatial clustering into regions

Group the re-ranked candidates into regions so the UI can show "4 of 5 results are in this region" (spec §9.2 step 4). Use a greedy radius pass (dependency-light, deterministic): candidates sorted by score seed regions; each subsequent candidate joins the first region whose centroid is within `radiusMeters`, else starts a new one. Distances use turf.js (already a workspace dependency).

**Files:**
- Create: `apps/web/lib/search/cluster.ts`
- Create: `apps/web/lib/search/cluster.test.ts`

**Interfaces:**
- Consumes: `RetrievedCandidate[]`, `DEFAULT_REGION_RADIUS_M`.
- Produces: `clusterCandidates(candidates, radiusMeters): ClusteredRegion[]` where `ClusteredRegion = { centroid: {lat,lng}; radiusM: number; aggregateScore: number; memberIds: string[] }`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/search/cluster.test.ts
import { describe, it, expect } from "vitest";
import { clusterCandidates } from "./cluster";
import type { RetrievedCandidate } from "./retrieval";

function at(id: string, lat: number, lng: number, similarity: number): RetrievedCandidate {
  return { indexedImageId: id, panoId: id, heading: 0, lat, lng, similarity, embedding: [] };
}

describe("clusterCandidates", () => {
  it("groups nearby candidates into one region and distant ones into another", () => {
    const candidates = [
      at("a", 40.4168, -3.7038, 0.95), // Madrid
      at("b", 40.4169, -3.7039, 0.80), // ~15m from a
      at("c", 41.3874, 2.1686, 0.60), // Barcelona, far away
    ];
    const regions = clusterCandidates(candidates, 150);
    expect(regions).toHaveLength(2);
    const madrid = regions.find((r) => r.memberIds.includes("a"))!;
    expect(madrid.memberIds.sort()).toEqual(["a", "b"]);
    // aggregate score is the best member's score
    expect(madrid.aggregateScore).toBeCloseTo(0.95, 5);
  });

  it("returns no regions for no candidates", () => {
    expect(clusterCandidates([], 150)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test cluster.test.ts`
Expected: FAIL — `Cannot find module './cluster'`.

- [ ] **Step 3: Implement `cluster.ts`**

```typescript
// apps/web/lib/search/cluster.ts
import * as turf from "@turf/turf";
import type { RetrievedCandidate } from "./retrieval";

export interface ClusteredRegion {
  centroid: { lat: number; lng: number };
  radiusM: number;
  aggregateScore: number;
  memberIds: string[];
}

/**
 * Greedy radius clustering (spec §9.2). Candidates are processed best-score
 * first; each joins the first existing region within `radiusMeters` of that
 * region's seed, otherwise seeds a new region. aggregateScore is the region's
 * best member score (its seed, since we go best-first).
 */
export function clusterCandidates(
  candidates: RetrievedCandidate[],
  radiusMeters: number
): ClusteredRegion[] {
  const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity);
  const regions: (ClusteredRegion & { seed: [number, number] })[] = [];

  for (const c of sorted) {
    const point: [number, number] = [c.lng, c.lat];
    const region = regions.find(
      (r) => turf.distance(turf.point(r.seed), turf.point(point), { units: "meters" }) <= radiusMeters
    );
    if (region) {
      region.memberIds.push(c.indexedImageId);
    } else {
      regions.push({
        seed: point,
        centroid: { lat: c.lat, lng: c.lng },
        radiusM: radiusMeters,
        aggregateScore: c.similarity,
        memberIds: [c.indexedImageId],
      });
    }
  }

  return regions.map(({ seed: _seed, ...r }) => r);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test cluster.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/cluster.ts apps/web/lib/search/cluster.test.ts
git commit -m "feat(web): greedy radius clustering of candidates into regions (spec §9.2)"
```

---

### Task 10: Web — persist a search and its regions/candidates

Write the `searches`, `search_regions`, and `search_candidates` rows in one transaction and return the assembled `SearchResponse`. Candidate rank is the global re-ranked order; `region_id` links each candidate to its region; `verification_score` is left `NULL` and `status` `'unreviewed'` (Pass 2's job).

**Files:**
- Create: `apps/web/lib/search/persist.ts`
- Create: `apps/web/lib/search/persist.test.ts`

**Interfaces:**
- Consumes: `Pool`, `queryImagePath: string`, `queryEmbedding: number[]`, `RetrievedCandidate[]` (re-ranked), `ClusteredRegion[]`.
- Produces: `persistSearch(pool, args): Promise<SearchResponse>` where `args = { queryImagePath, queryEmbedding, candidates, regions }`.

- [ ] **Step 1: Write the failing integration test** (gated on `TEST_DATABASE_URL`)

```typescript
// apps/web/lib/search/persist.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { persistSearch } from "./persist";
import type { RetrievedCandidate } from "./retrieval";
import type { ClusteredRegion } from "./cluster";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("persistSearch", () => {
  const pool = new Pool({ connectionString: url });
  const areaId = "00000000-0000-0000-0000-0000000000c1";
  let imageId = "";

  beforeAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.query(
      `INSERT INTO areas (id, geometry, area_km2)
       VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))',4326), 1.0)`,
      [areaId]
    );
    const r = await pool.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location, embedding, embedded_at)
       VALUES ($1,'pano-p',0, ST_GeogFromText('POINT(0.5 0.5)'), $2, now()) RETURNING id`,
      [areaId, `[${new Array(8448).fill(0).join(",")}]`]
    );
    imageId = r.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.end();
  });

  it("persists search, regions and candidates and returns them grouped by region", async () => {
    const candidates: RetrievedCandidate[] = [
      { indexedImageId: imageId, panoId: "pano-p", heading: 0, lat: 0.5, lng: 0.5, similarity: 0.88, embedding: [] },
    ];
    const regions: ClusteredRegion[] = [
      { centroid: { lat: 0.5, lng: 0.5 }, radiusM: 150, aggregateScore: 0.88, memberIds: [imageId] },
    ];

    const res = await persistSearch(pool, {
      queryImagePath: "/tmp/q.jpg",
      queryEmbedding: new Array(8448).fill(0),
      candidates,
      regions,
    });

    expect(res.searchId).toBeTruthy();
    expect(res.regions).toHaveLength(1);
    const regionId = res.regions[0].id;
    expect(res.candidatesByRegion[regionId]).toHaveLength(1);
    expect(res.candidatesByRegion[regionId][0].verificationScore).toBeNull();
    expect(res.candidatesByRegion[regionId][0].status).toBe("unreviewed");
    expect(res.candidatesByRegion[regionId][0].rank).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test persist.test.ts`
Expected: FAIL — `Cannot find module './persist'`.

- [ ] **Step 3: Implement `persist.ts`**

```typescript
// apps/web/lib/search/persist.ts
import type { Pool } from "pg";
import type { SearchResponse, SearchRegion, SearchCandidate } from "@netryx/shared-types";
import type { RetrievedCandidate } from "./retrieval";
import type { ClusteredRegion } from "./cluster";

export interface PersistSearchArgs {
  queryImagePath: string;
  queryEmbedding: number[];
  candidates: RetrievedCandidate[]; // already re-ranked, best-first
  regions: ClusteredRegion[];
}

/**
 * Writes searches/search_regions/search_candidates in one transaction and
 * returns the assembled Pass 1 response. Rank is the global re-ranked order
 * (1-based). verification_score/status stay at Pass-1 defaults (spec §9.2).
 */
export async function persistSearch(
  pool: Pool,
  args: PersistSearchArgs
): Promise<SearchResponse> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const search = await client.query(
      `INSERT INTO searches (query_image_path, query_embedding)
       VALUES ($1, $2) RETURNING id`,
      [args.queryImagePath, `[${args.queryEmbedding.join(",")}]`]
    );
    const searchId = search.rows[0].id as string;

    // Insert regions, remembering which memberIds each DB region id owns.
    const regionOut: SearchRegion[] = [];
    const regionIdByMember = new Map<string, string>();
    for (const r of args.regions) {
      const inserted = await client.query(
        `INSERT INTO search_regions (search_id, centroid, radius_m, aggregate_score, candidate_count)
         VALUES ($1, ST_GeogFromText($2), $3, $4, $5) RETURNING id`,
        [searchId, `POINT(${r.centroid.lng} ${r.centroid.lat})`, r.radiusM, r.aggregateScore, r.memberIds.length]
      );
      const regionId = inserted.rows[0].id as string;
      regionOut.push({
        id: regionId,
        centroid: r.centroid,
        radiusM: r.radiusM,
        aggregateScore: r.aggregateScore,
        candidateCount: r.memberIds.length,
      });
      for (const m of r.memberIds) regionIdByMember.set(m, regionId);
    }

    const candidatesByRegion: Record<string, SearchCandidate[]> = {};
    for (let i = 0; i < args.candidates.length; i++) {
      const c = args.candidates[i];
      const regionId = regionIdByMember.get(c.indexedImageId) ?? null;
      const rank = i + 1;
      const inserted = await client.query(
        `INSERT INTO search_candidates
           (search_id, region_id, indexed_image_id, similarity_score, rank, status)
         VALUES ($1, $2, $3, $4, $5, 'unreviewed') RETURNING id`,
        [searchId, regionId, c.indexedImageId, c.similarity, rank]
      );
      const candidate: SearchCandidate = {
        id: inserted.rows[0].id,
        regionId,
        indexedImageId: c.indexedImageId,
        panoId: c.panoId,
        heading: c.heading,
        lat: c.lat,
        lng: c.lng,
        similarityScore: c.similarity,
        verificationScore: null,
        rank,
        status: "unreviewed",
      };
      if (regionId) {
        (candidatesByRegion[regionId] ??= []).push(candidate);
      }
    }

    await client.query("COMMIT");
    return { searchId, regions: regionOut, candidatesByRegion };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test persist.test.ts`
Expected: PASS — search persisted and grouped by region.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/persist.ts apps/web/lib/search/persist.test.ts
git commit -m "feat(web): persist search + regions + candidates in one transaction (spec §9.2, §11)"
```

---

### Task 11: Web — `runSearch` orchestrator (dependency-injected)

Compose the pieces into one testable function, mirroring the worker's `runIndexAreaJob` deps pattern so the HTTP/multipart glue (Task 12) stays thin and the orchestration is unit-testable with fakes.

**Files:**
- Create: `apps/web/lib/search/run-search.ts`
- Create: `apps/web/lib/search/run-search.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `runSearch(deps, input): Promise<SearchResponse>` where
  `input = { imageBase64: string; imageBytes: Buffer; imageExt: string }` and
  `deps = { embedQuery(b64): Promise<number[]>; retrieve(embedding): Promise<RetrievedCandidate[]>; rerank(embedding, candidates): RetrievedCandidate[]; cluster(candidates): ClusteredRegion[]; saveImage(searchId, bytes, ext): Promise<string>; persist(args): Promise<SearchResponse>; newSearchId(): string }`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/search/run-search.test.ts
import { describe, it, expect, vi } from "vitest";
import { runSearch } from "./run-search";
import type { RetrievedCandidate } from "./retrieval";
import type { ClusteredRegion } from "./cluster";

describe("runSearch", () => {
  it("embeds, retrieves, re-ranks, clusters, saves the image, and persists — in order", async () => {
    const embedding = [1, 0];
    const retrieved: RetrievedCandidate[] = [
      { indexedImageId: "img-1", panoId: "p", heading: 0, lat: 1, lng: 2, similarity: 0.5, embedding },
    ];
    const reranked: RetrievedCandidate[] = [{ ...retrieved[0], similarity: 0.9 }];
    const regions: ClusteredRegion[] = [
      { centroid: { lat: 1, lng: 2 }, radiusM: 150, aggregateScore: 0.9, memberIds: ["img-1"] },
    ];

    const deps = {
      newSearchId: () => "search-x",
      embedQuery: vi.fn().mockResolvedValue(embedding),
      retrieve: vi.fn().mockResolvedValue(retrieved),
      rerank: vi.fn().mockReturnValue(reranked),
      cluster: vi.fn().mockReturnValue(regions),
      saveImage: vi.fn().mockResolvedValue("/tmp/search-x.jpg"),
      persist: vi.fn().mockResolvedValue({ searchId: "search-x", regions: [], candidatesByRegion: {} }),
    };

    const res = await runSearch(deps, {
      imageBase64: "aaaa",
      imageBytes: Buffer.from([1]),
      imageExt: "jpg",
    });

    expect(deps.embedQuery).toHaveBeenCalledWith("aaaa");
    expect(deps.retrieve).toHaveBeenCalledWith(embedding);
    expect(deps.rerank).toHaveBeenCalledWith(embedding, retrieved);
    expect(deps.cluster).toHaveBeenCalledWith(reranked);
    expect(deps.saveImage).toHaveBeenCalledWith("search-x", expect.any(Buffer), "jpg");
    expect(deps.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        queryImagePath: "/tmp/search-x.jpg",
        queryEmbedding: embedding,
        candidates: reranked,
        regions,
      })
    );
    expect(res.searchId).toBe("search-x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test run-search.test.ts`
Expected: FAIL — `Cannot find module './run-search'`.

- [ ] **Step 3: Implement `run-search.ts`**

```typescript
// apps/web/lib/search/run-search.ts
import type { SearchResponse } from "@netryx/shared-types";
import type { RetrievedCandidate } from "./retrieval";
import type { ClusteredRegion } from "./cluster";
import type { PersistSearchArgs } from "./persist";

export interface RunSearchInput {
  imageBase64: string;
  imageBytes: Buffer;
  imageExt: string;
}

export interface RunSearchDeps {
  newSearchId: () => string;
  embedQuery: (imageBase64: string) => Promise<number[]>;
  retrieve: (queryEmbedding: number[]) => Promise<RetrievedCandidate[]>;
  rerank: (queryEmbedding: number[], candidates: RetrievedCandidate[]) => RetrievedCandidate[];
  cluster: (candidates: RetrievedCandidate[]) => ClusteredRegion[];
  saveImage: (searchId: string, bytes: Buffer, ext: string) => Promise<string>;
  persist: (args: PersistSearchArgs) => Promise<SearchResponse>;
}

/** Pass 1 orchestration (spec §9.2). Deps are injected so HTTP glue stays thin. */
export async function runSearch(deps: RunSearchDeps, input: RunSearchInput): Promise<SearchResponse> {
  const searchId = deps.newSearchId();
  const queryEmbedding = await deps.embedQuery(input.imageBase64);
  const retrieved = await deps.retrieve(queryEmbedding);
  const reranked = deps.rerank(queryEmbedding, retrieved);
  const regions = deps.cluster(reranked);
  const queryImagePath = await deps.saveImage(searchId, input.imageBytes, input.imageExt);
  return deps.persist({ queryImagePath, queryEmbedding, candidates: reranked, regions });
}
```

> Note: `persist` in Task 10 generates the search id inside its `INSERT ... RETURNING id`, but the image is saved under `newSearchId()` before persisting. Reconcile by having `persist` accept an optional `searchId` and insert it explicitly. Update `PersistSearchArgs` to include `searchId: string`, change the `searches` insert to `INSERT INTO searches (id, query_image_path, query_embedding) VALUES ($1,$2,$3)`, and pass `searchId` from `runSearch`. Add `searchId` to the `deps.persist` call object. (Make this edit as part of Step 3, and extend Task 10's test to pass a `searchId` and assert it round-trips.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test run-search.test.ts`
Expected: PASS — 1 test green, calls happen in order with the right arguments.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/run-search.ts apps/web/lib/search/run-search.test.ts apps/web/lib/search/persist.ts apps/web/lib/search/persist.test.ts
git commit -m "feat(web): runSearch orchestrator wiring Pass 1 end-to-end (spec §9.2)"
```

---

### Task 12: Web — `POST /api/search` route

The thin HTTP layer: read a multipart upload, base64-encode it, build the real deps (inference URL from env, `randomUUID` for the id, the pgvector/cluster/persist functions bound to the pool), call `runSearch`, return `SearchResponse`. Per the route-export rule, the route file imports helpers and exports only `POST`.

**Files:**
- Create: `apps/web/app/api/search/route.ts`

**Interfaces:**
- Consumes: `runSearch`, `RunSearchDeps`, `retrieveCandidates`, `queryExpansionRerank`, `clusterCandidates`, `persistSearch`, `saveQueryImage`, `embedQueryImage`, `getPool`, `DEFAULT_TOP_K`/`DEFAULT_REGION_RADIUS_M`/`DEFAULT_QUERY_EXPANSION_SIZE`.

- [ ] **Step 1: Implement the route** (thin glue — verified manually in Step 2, since multipart + DB + inference is an integration path)

```typescript
// apps/web/app/api/search/route.ts
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  DEFAULT_TOP_K,
  DEFAULT_REGION_RADIUS_M,
  DEFAULT_QUERY_EXPANSION_SIZE,
} from "@netryx/shared-types";
import { getPool } from "../../../lib/db";
import { saveQueryImage } from "../../../lib/query-image-store";
import { embedQueryImage } from "../../../lib/inference-client";
import { retrieveCandidates } from "../../../lib/search/retrieval";
import { queryExpansionRerank } from "../../../lib/search/rerank";
import { clusterCandidates } from "../../../lib/search/cluster";
import { persistSearch } from "../../../lib/search/persist";
import { runSearch, type RunSearchDeps } from "../../../lib/search/run-search";

function extFromType(type: string): string {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  return "jpg";
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Any non-multipart body (JSON, empty, missing boundary) throws inside
    // formData() itself — confirmed by actually sending one — so this must be
    // caught explicitly or it surfaces as an unhandled 500 with a raw stack trace.
    return NextResponse.json(
      { error: "Request must be multipart/form-data with an \"image\" field" },
      { status: 400 }
    );
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "image file is required" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const imageBase64 = bytes.toString("base64");
  const imageExt = extFromType(file.type);

  const pool = getPool();
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

  const deps: RunSearchDeps = {
    newSearchId: () => randomUUID(),
    embedQuery: (b64) => embedQueryImage(b64, inferenceBaseUrl),
    retrieve: (embedding) => retrieveCandidates(pool, embedding, DEFAULT_TOP_K),
    rerank: (embedding, candidates) =>
      queryExpansionRerank(embedding, candidates, DEFAULT_QUERY_EXPANSION_SIZE),
    cluster: (candidates) => clusterCandidates(candidates, DEFAULT_REGION_RADIUS_M),
    saveImage: (searchId, b, ext) => saveQueryImage(searchId, b, ext),
    persist: (args) => persistSearch(pool, args),
  };

  const result = await runSearch(deps, { imageBase64, imageBytes: bytes, imageExt });
  return NextResponse.json(result, { status: 201 });
}
```

> `runSearch` must pass its `searchId` into `persist` (see Task 11 Step 3 note). Ensure `deps.persist` receives `searchId` — either thread it through `RunSearchInput`/`runSearch` or generate the id once in `runSearch` and include it in the `persist` args object.

- [ ] **Step 2: Build the web app to confirm the route type-checks**

Run: `cd apps/web && pnpm build`
Expected: `Compiled successfully`, and `/api/search` appears in the route list as a dynamic (`ƒ`) route.

- [ ] **Step 3: Manual end-to-end verification**

```bash
# 1. Ensure Postgres is up, an area has been indexed (POST /api/areas + worker),
#    and the inference service is running (uvicorn main:app in services/inference).
# 2. Start web: cd apps/web && pnpm dev
# 3. Send a query image:
curl -s -X POST http://localhost:3000/api/search -F "image=@/path/to/query.jpg" | jq
```
Expected: a JSON `SearchResponse` — a non-empty `searchId`, one or more `regions` with `aggregateScore` and `candidateCount`, and `candidatesByRegion` keyed by region id with `verificationScore: null` and `status: "unreviewed"`. A row appears in `searches`, plus `search_regions`/`search_candidates`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/api/search/route.ts"
git commit -m "feat(web): POST /api/search — Pass 1 retrieval → regions (spec §9.2, §9.4)"
```

---

## Self-Review

- **Spec coverage (§9.2):** embedding via `/embed` ✔ (Task 6), cosine top-k over pgvector ✔ (Task 7), spatial clustering → regions ✔ (Task 9), aggregate score per region ✔ (Task 9/10), no verification in Pass 1 ✔ (Task 10 leaves `verification_score` NULL). §15.1 Lumi Preview: multi-heading aggregation ✔ (Task 1 table + Task 4 worker), query TTA ✔ (Task 3), query-expansion re-ranking ✔ (Task 8). §11's `hnsw` index deliberately **not** built — confirmed impossible at 8448 dimensions (pgvector's 2000-dim ANN-index cap), documented in Task 1 rather than silently dropped. §9.4 endpoint table `POST /api/search` ✔ (Task 12).
- **Deferred correctly:** `/refine`, `/verify`, Laila, image-byte storage, UI — all Pass 2 / other plans.
- **Type consistency:** `RetrievedCandidate` (Task 7) is consumed unchanged by Tasks 8/9/10/11; `ClusteredRegion` (Task 9) by Tasks 10/11; `SearchResponse`/`SearchCandidate`/`SearchRegion` (Task 2) by Tasks 10/11/12. `IndexedPointInsert` (Task 4) matches the `indexed_points` columns (Task 1). The Task 11 note reconciles the search-id ownership between `saveImage` and `persist` — implementers must apply it.
- **Open follow-ups for Pass 2:** query image is stored (Task 5) ready for verification; `search_candidates` rows exist ready to gain `verification_score`.

---

## Execution Handoff

**Plan complete and saved to `docs/2026-07-09-search-pass1-retrieval.md`.**
See the second plan, `docs/2026-07-09-search-pass2-refine.md`, for Pass 2. Choose an execution approach when you are ready to build (subagent-driven per-task review recommended).
