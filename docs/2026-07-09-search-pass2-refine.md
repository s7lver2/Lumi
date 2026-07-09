# Search Pass 2 — Refine + Laila Geometric Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a Pass 1 region into an exact, verified street-level ranking: expand to every indexed point inside the region, run geometric verification (Laila = RoMa + multi-resolution tiling + MAGSAC++ + a calibrated score) of the query against each candidate's real image, re-rank by verification score, and auto-confirm the top result when it clears a configurable threshold — spec §9.3, §15.2.

**Architecture:** Verification needs the candidates' **real images**, which the index does not keep — so this plan first changes the indexing worker to persist each Street View capture to disk and record its `image_path` on `indexed_images`. `POST /api/search/:searchId/refine` then runs synchronously in `apps/web` (one region's worth of candidates is small): it expands the region with PostGIS `ST_DWithin`, reads the query and candidate images from disk, calls the new inference `POST /verify` (which loads the frozen RoMa-based Laila model once at startup, mirroring `/embed`), re-ranks `search_candidates` by verification score, and flips the top candidate to `confirmed` if it beats `VERIFICATION_CONFIRM_THRESHOLD`.

**Tech Stack:** TypeScript (web/worker), Python 3.11 + FastAPI + PyTorch (RoMa via torch.hub) + OpenCV (MAGSAC++) + NumPy + Pillow (inference), Postgres + PostGIS, node-pg-migrate, vitest, pytest.

**Depends on:** Search Pass 1 plan (`2026-07-09-search-pass1-retrieval.md`) merged — this plan reads `searches.query_image_path`, updates the `search_candidates` rows Pass 1 created, and reuses its `SearchCandidate` types.

**Out of scope:** the search/refine UI (`ResultsPanel`, "Refinar" button, street-level view — Dashboard & Map UI plan); `api_usage` cost bookkeeping for the re-download path (Cost tracking plan); reindexing automation for areas indexed before this plan (documented as a manual "reindex area" operation, spec §15.4).

## Global Constraints

- **Language/strictness:** TypeScript `strict`; Python 3.11.
- **No fine-tuning:** Laila wraps **frozen** RoMa — tiling, MAGSAC++, and score calibration all sit *around* the model, never touching weights (spec §2, §15.2).
- **Product naming:** "Laila" in user-facing strings; "RoMa" only internal (spec §15).
- **Model loaded once at startup:** `/verify` never loads a model per request; the verification model is loaded in the same startup handler as `/embed` (spec §6.2, §14.5, §15.4).
- **Images on disk:** capture images are keyed deterministically by `pano_id`+`heading` so overlapping areas share files and refine can find them without a DB lookup beyond `image_path`.
- **Pre-existing areas:** areas indexed before this plan have `image_path = NULL`; their candidates are skipped during verification with a logged warning, and the plan documents that they must be re-indexed to become verifiable (spec §15.4's manual reindex).
- **Route-export rule:** `route.ts` exports only HTTP handlers; helpers live in sibling modules.
- **No auth** (spec §10.3). **Windows-native, no Docker required** (spec §7.1).
- **TDD, DRY, YAGNI, frequent commits.**

---

## File Structure

```
netryx-fork/
├── db/
│   ├── migrations/
│   │   └── 1720600000000_indexed_images_image_path.js   # Task 1
│   └── test/migrations.test.ts                           # Modify (Task 1)
├── apps/
│   ├── worker/
│   │   └── src/
│   │       ├── image-store.ts                            # Task 2
│   │       ├── image-store.test.ts                       # Task 2
│   │       ├── jobs/index-area.ts                        # Modify (Task 3)
│   │       ├── jobs/index-area.test.ts                   # Modify (Task 3)
│   │       ├── db-queries.ts                             # Modify (Task 3)
│   │       └── index.ts                                  # Modify (Task 3)
│   └── web/
│       ├── lib/
│       │   ├── verify-client.ts                          # Task 8
│       │   ├── verify-client.test.ts                     # Task 8
│       │   └── search/
│       │       ├── candidate-images.ts                   # Task 9
│       │       ├── candidate-images.test.ts              # Task 9
│       │       ├── refine-retrieval.ts                   # Task 10
│       │       ├── refine-retrieval.test.ts              # Task 10
│       │       ├── refine-persist.ts                     # Task 11
│       │       ├── refine-persist.test.ts                # Task 11
│       │       ├── run-refine.ts                         # Task 12
│       │       └── run-refine.test.ts                    # Task 12
│       └── app/api/search/[searchId]/refine/
│           └── route.ts                                  # Task 13
├── packages/shared-types/src/
│   ├── search.ts                                         # Modify (Task 7)
│   ├── settings.ts                                       # Modify (Task 7)
│   └── settings.test.ts                                  # Modify (Task 7)
└── services/inference/
    ├── requirements.txt                                  # Modify (Task 4)
    ├── loader.py                                         # Modify (Task 4)
    ├── test_loader.py                                    # Modify (Task 4)
    ├── tiles.py                                          # Task 5
    ├── test_tiles.py                                     # Task 5
    ├── verify.py                                         # Task 6
    ├── test_verify.py                                    # Task 6
    ├── main.py                                           # Modify (Task 7 inference)
    └── test_main.py                                      # Modify (Task 7 inference)
```

> Task numbering below groups the inference `/verify` endpoint with its Python deps; the shared-types/settings change and the inference endpoint are separate tasks that happen to both touch "verify" — follow the numbers, not the filenames.

---

### Task 1: Migration — `indexed_images.image_path`

Verification needs the on-disk location of each candidate image. Add a nullable column (nullable so rows indexed before this plan are still valid — they just aren't verifiable).

**Files:**
- Create: `db/migrations/1720600000000_indexed_images_image_path.js`
- Modify: `db/test/migrations.test.ts`

**Interfaces:**
- Produces: column `indexed_images.image_path text NULL`.

- [ ] **Step 1: Add a failing assertion**

```typescript
// db/test/migrations.test.ts — add inside describe("init migration")
it("adds a nullable image_path to indexed_images (spec §9.3 verification needs the bytes)", async () => {
  const { rows } = await client.query(
    `SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_name = 'indexed_images' AND column_name = 'image_path'`
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].is_nullable).toBe("YES");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd db && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test`
Expected: FAIL — column `image_path` not found (0 rows).

- [ ] **Step 3: Write the migration**

```javascript
// db/migrations/1720600000000_indexed_images_image_path.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE indexed_images ADD COLUMN image_path text;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE indexed_images DROP COLUMN image_path;`);
};
```

- [ ] **Step 4: Apply to test + dev DBs**

Run: `cd db && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm migrate:up:test && pnpm migrate:up`
Expected: `Migrating files: - 1720600000000_indexed_images_image_path` then `Migrations complete!` for both.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd db && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/1720600000000_indexed_images_image_path.js db/test/migrations.test.ts
git commit -m "feat(db): add indexed_images.image_path for Pass 2 verification (spec §9.3)"
```

---

### Task 2: Worker — persist Street View capture images to disk

**Files:**
- Create: `apps/worker/src/image-store.ts`
- Create: `apps/worker/src/image-store.test.ts`

**Interfaces:**
- Produces: `captureImagePath(panoId: string, heading: number): string` (deterministic, no I/O) and `saveCaptureImage(panoId: string, heading: number, base64: string): Promise<string>` returning the path written. Directory from `STREET_VIEW_IMAGE_DIR`, default `./data/street-view`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/worker/src/image-store.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureImagePath, saveCaptureImage } from "./image-store";

const DIR = join(tmpdir(), "netryx-sv-test");
afterEach(async () => {
  await rm(DIR, { recursive: true, force: true });
});

describe("image-store", () => {
  it("derives a deterministic path from pano id + heading", () => {
    process.env.STREET_VIEW_IMAGE_DIR = DIR;
    expect(captureImagePath("pano-a", 90)).toBe(join(DIR, "pano-a_90.jpg"));
  });

  it("writes decoded bytes to that path and returns it", async () => {
    process.env.STREET_VIEW_IMAGE_DIR = DIR;
    const base64 = Buffer.from([9, 8, 7]).toString("base64");
    const path = await saveCaptureImage("pano-b", 0, base64);
    expect(path).toBe(join(DIR, "pano-b_0.jpg"));
    expect(await readFile(path)).toEqual(Buffer.from([9, 8, 7]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && pnpm test image-store.test.ts`
Expected: FAIL — `Cannot find module './image-store'`.

- [ ] **Step 3: Implement `image-store.ts`**

```typescript
// apps/worker/src/image-store.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function imageDir(): string {
  return process.env.STREET_VIEW_IMAGE_DIR ?? join(process.cwd(), "data", "street-view");
}

/** Deterministic on-disk path for a capture — pano+heading is unique (indexed_images UNIQUE). */
export function captureImagePath(panoId: string, heading: number): string {
  // pano ids are URL-safe already; heading is a small int. No sanitization needed.
  return join(imageDir(), `${panoId}_${heading}.jpg`);
}

/** Writes the base64 Street View image to its deterministic path; returns the path. */
export async function saveCaptureImage(
  panoId: string,
  heading: number,
  base64: string
): Promise<string> {
  await mkdir(imageDir(), { recursive: true });
  const path = captureImagePath(panoId, heading);
  await writeFile(path, Buffer.from(base64, "base64"));
  return path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && pnpm test image-store.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/image-store.ts apps/worker/src/image-store.test.ts
git commit -m "feat(worker): persist Street View capture images to disk (spec §9.3)"
```

---

### Task 3: Worker — save images during indexing and record `image_path`

**Files:**
- Modify: `apps/worker/src/jobs/index-area.ts`
- Modify: `apps/worker/src/jobs/index-area.test.ts`
- Modify: `apps/worker/src/db-queries.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: `saveCaptureImage` (Task 2), `StreetViewCapture`, existing `IndexedImageInsert`.
- Produces: `IndexedImageInsert` gains `imagePath: string`; new dep `saveCaptureImage(panoId, heading, base64): Promise<string>` on `IndexAreaJobDeps`; `insertIndexedImages` writes `image_path`.

- [ ] **Step 1: Add a failing test asserting image_path flows into the insert**

```typescript
// apps/worker/src/jobs/index-area.test.ts — add
it("saves each capture image and records its path on the indexed_images insert (spec §9.3)", async () => {
  const saveCaptureImage = vi
    .fn()
    .mockImplementation(async (panoId: string, heading: number) => `/imgs/${panoId}_${heading}.jpg`);
  const insertIndexedImages = vi.fn().mockResolvedValue(undefined);

  const deps = makeDeps({
    captures: [
      { panoId: "pano-a", heading: 0, lat: 1, lng: 2, captureDate: null, imageBase64: "AAECAw==" },
    ],
    embeddings: [[1, 0]],
    saveCaptureImage,
    insertIndexedImages,
  });

  await runIndexAreaJob({ areaId: "area-1" }, deps);

  expect(saveCaptureImage).toHaveBeenCalledWith("pano-a", 0, "AAECAw==");
  const [, images] = insertIndexedImages.mock.calls[0];
  expect(images[0].imagePath).toBe("/imgs/pano-a_0.jpg");
});
```

> Extend `makeDeps` to accept `saveCaptureImage` (default `vi.fn().mockResolvedValue("/imgs/x.jpg")`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && pnpm test index-area.test.ts -t "records its path"`
Expected: FAIL — `imagePath` is `undefined`.

- [ ] **Step 3: Thread image saving through `runIndexAreaJob`**

```typescript
// apps/worker/src/jobs/index-area.ts

// 1) IndexedImageInsert gains imagePath
export interface IndexedImageInsert {
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  captureDate: string | null;
  embedding: number[];
  imagePath: string;
}

// 2) IndexAreaJobDeps gains the saver
    saveCaptureImage: (panoId: string, heading: number, base64: string) => Promise<string>;

// 3) Replace the `const inserts = captures.map(...)` block with one that saves
//    each image first (images are already downloaded in memory as base64):
    const inserts: IndexedImageInsert[] = [];
    for (let i = 0; i < captures.length; i++) {
      const capture = captures[i];
      const imagePath = await deps.saveCaptureImage(
        capture.panoId,
        capture.heading,
        capture.imageBase64
      );
      inserts.push({
        panoId: capture.panoId,
        heading: capture.heading,
        lat: capture.lat,
        lng: capture.lng,
        captureDate: capture.captureDate,
        embedding: embeddings[i],
        imagePath,
      });
    }
```

- [ ] **Step 4: Persist `image_path` in `insertIndexedImages`**

```typescript
// apps/worker/src/db-queries.ts — update the INSERT in insertIndexedImages
      await client.query(
        `INSERT INTO indexed_images (area_id, pano_id, heading, location, street_view_date, embedding, image_path, embedded_at)
         VALUES ($1, $2, $3, ST_GeogFromText($4), $5, $6, $7, now())
         ON CONFLICT (pano_id, heading) DO NOTHING`,
        [
          areaId,
          img.panoId,
          img.heading,
          `POINT(${img.lng} ${img.lat})`,
          img.captureDate ? `${img.captureDate}-01` : null,
          `[${img.embedding.join(",")}]`,
          img.imagePath,
        ]
      );
```

- [ ] **Step 5: Wire the real saver in `apps/worker/src/index.ts`**

```typescript
// apps/worker/src/index.ts
import { saveCaptureImage } from "./image-store";
// add to the deps object:
      saveCaptureImage: (panoId, heading, base64) => saveCaptureImage(panoId, heading, base64),
```

- [ ] **Step 6: Run the worker test suite**

Run: `cd apps/worker && pnpm test`
Expected: PASS — new test + all existing worker tests green (the Pass 1 `insertIndexedPoints` test still passes).

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/jobs/index-area.ts apps/worker/src/jobs/index-area.test.ts apps/worker/src/db-queries.ts apps/worker/src/index.ts
git commit -m "feat(worker): save capture images and record image_path during indexing (spec §9.3)"
```

---

### Task 4: Inference — verification model loader (Laila / frozen RoMa)

`settings.py` already reads `VERIFICATION_MODEL`; `main.py` currently ignores it. Add a loader that resolves the id against `VERIFICATION_MODELS` and loads frozen RoMa for `"laila"`. Weight-loading itself can't be unit-tested without the weights, so the test covers registry resolution and the unknown-id error path, mirroring `test_loader.py`.

**RoMa is not a `torch.hub` model — confirmed by actually trying it.** `Parskatt/RoMa`'s `main` branch dropped `hubconf.py` at some point (it now ships as the `romatch` package with an `assets/`-based demo instead); `torch.hub.load("Parskatt/RoMa", "roma_outdoor")` fails with `FileNotFoundError: ... hubconf.py`. `romatch` is published on PyPI instead — install and import it directly. Its real usage (per its README) is:
```python
from romatch import roma_outdoor
roma_model = roma_outdoor(device=device)
warp, certainty = roma_model.match(im_A, im_B, device=device)   # im_A/im_B: PIL.Image or path
matches, certainty = roma_model.sample(warp, certainty)
kptsA, kptsB = roma_model.to_pixel_coordinates(matches, H_A, W_A, H_B, W_B)
```
`match()` accepts a `PIL.Image` directly (no need to write tiles to disk first) and returns pixel-coordinate tensors — which is exactly the `(pts_a, pts_b)` shape `verify.py`'s `matcher(tile_a, tile_b)` contract expects, so a thin wrapper class is all Task 7-inference's `_roma_matcher_adapter` needs.

**Files:**
- Modify: `services/inference/requirements.txt`
- Modify: `services/inference/loader.py`
- Modify: `services/inference/test_loader.py`

**Interfaces:**
- Produces: `load_verification_model(model_id: str)` → a `RomaMatcher` exposing `match_points(img_a: np.ndarray, img_b: np.ndarray) -> (pts_a, pts_b)`; raises `UnknownModelError` for unknown ids.

- [ ] **Step 1: Add failing tests**

```python
# services/inference/test_loader.py — add
import pytest
from loader import load_verification_model, UnknownModelError


def test_load_verification_model_rejects_unknown_id():
    with pytest.raises(UnknownModelError):
        load_verification_model("does-not-exist")


def test_load_verification_model_accepts_the_laila_id_shape():
    # We don't download RoMa weights in the unit test; we assert the id is
    # recognized (no UnknownModelError for the registered id) by monkeypatching
    # the romatch.roma_outdoor loader to a sentinel and checking it comes back
    # wrapped in a RomaMatcher exposing match_points (spec §15.2).
    import loader
    loader._LOAD_ROMA_OUTDOOR = lambda *a, **k: "ROMA_SENTINEL"  # injected hook, see impl
    model = load_verification_model("laila")
    assert isinstance(model, loader.RomaMatcher)
    assert model._roma_model == "ROMA_SENTINEL"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/inference && ./venv/Scripts/python -m pytest test_loader.py -k verification -v`
Expected: FAIL — `cannot import name 'load_verification_model'`.

- [ ] **Step 3: Implement the loader**

```python
# services/inference/loader.py — add below load_retrieval_model
from models.registry import RETRIEVAL_MODELS, VERIFICATION_MODELS  # extend existing import


class RomaMatcher:
    """
    Wraps romatch's roma_outdoor model with the match_points(img_a, img_b) ->
    (pts_a, pts_b) contract verify.py's tile-based matcher expects (spec
    §15.2) — pixel-coordinate correspondences as (N, 2) numpy arrays.
    """

    def __init__(self, roma_model, device: str):
        self._roma_model = roma_model
        self._device = device

    def match_points(self, img_a, img_b):
        from PIL import Image

        im_a = Image.fromarray(img_a)
        im_b = Image.fromarray(img_b)
        h_a, w_a = img_a.shape[0], img_a.shape[1]
        h_b, w_b = img_b.shape[0], img_b.shape[1]

        warp, certainty = self._roma_model.match(im_a, im_b, device=self._device)
        matches, certainty = self._roma_model.sample(warp, certainty)
        kpts_a, kpts_b = self._roma_model.to_pixel_coordinates(matches, h_a, w_a, h_b, w_b)
        return kpts_a.detach().cpu().numpy(), kpts_b.detach().cpu().numpy()


# Indirection so tests can inject a fake instead of downloading real weights.
# Lazily resolved: romatch has no torch.hub entrypoint (see note above) — it's
# installed from PyPI (see requirements.txt) and imported directly.
_LOAD_ROMA_OUTDOOR = None


def load_verification_model(model_id: str):
    entry = next((m for m in VERIFICATION_MODELS if m["id"] == model_id), None)
    if entry is None:
        raise UnknownModelError(f"Unknown verification model id: {model_id}")

    if model_id == "laila":
        # Laila wraps frozen RoMa (spec §15.2). Uses CUDA when available —
        # dense multi-tile matching on CPU is impractically slow for verify.py's
        # 5-tile pipeline (~9s per tile-pair on CPU vs. GPU in local testing).
        # Falls back to CPU/float32 otherwise (spec §7.1 — Windows-native,
        # CUDA optional, not guaranteed).
        global _LOAD_ROMA_OUTDOOR
        if _LOAD_ROMA_OUTDOOR is None:
            from romatch import roma_outdoor

            _LOAD_ROMA_OUTDOOR = roma_outdoor
        device = "cuda" if torch.cuda.is_available() else "cpu"
        amp_dtype = torch.float16 if device == "cuda" else torch.float32
        roma_model = _LOAD_ROMA_OUTDOOR(device=device, amp_dtype=amp_dtype)
        return RomaMatcher(roma_model, device)

    raise UnknownModelError(f"No loader implemented for verification model id: {model_id}")
```

- [ ] **Step 4: Add the runtime deps**

```
# services/inference/requirements.txt — append
opencv-python-headless>=4.10
romatch>=0.1.2
```
> `torch`, `numpy`, `Pillow`, `psycopg2` are already present from the indexing plan. Unlike MegaLoc, RoMa is a PyPI package (`pip install romatch`), not a `torch.hub` call — see the note above Task 4. `romatch` pulls in `torch>=2.5.1`; if the environment's `torch` is older, `pip install romatch` will upgrade it (and `torch`'s CPU vs. CUDA build is independent of that version bump — installing plain `torch` from PyPI gives you the CPU build even on a CUDA-capable machine; use `pip install --index-url https://download.pytorch.org/whl/cu1XX torch torchvision` — matching the installed driver's supported CUDA version — if a GPU is present and you want it used).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/inference && ./venv/Scripts/python -m pytest test_loader.py -v`
Expected: PASS — verification loader tests + existing retrieval loader tests green.

- [ ] **Step 6: Commit**

```bash
git add services/inference/loader.py services/inference/test_loader.py services/inference/requirements.txt
git commit -m "feat(inference): frozen-RoMa verification model loader for Laila via romatch/PyPI (spec §15.2)"
```

---

### Task 5: Inference — multi-resolution tiling (Laila)

Laila runs the matcher on overlapping tiles at two resolutions and aggregates, improving coverage of small/far features (spec §15.2). Pure NumPy tiling, unit-testable without the model.

**Files:**
- Create: `services/inference/tiles.py`
- Create: `services/inference/test_tiles.py`

**Interfaces:**
- Produces: `tile_image(img: np.ndarray, grid: int, overlap: float) -> list[Tile]` where `Tile = {"array": np.ndarray, "x0": int, "y0": int}`; `multiscale_tiles(img) -> list[Tile]` (grids 1 and 2 by default → full image + 2×2 overlapping tiles).

- [ ] **Step 1: Write the failing test**

```python
# services/inference/test_tiles.py
import numpy as np
from tiles import tile_image, multiscale_tiles


def test_tile_image_1x1_returns_the_whole_image_at_origin():
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    tiles = tile_image(img, grid=1, overlap=0.0)
    assert len(tiles) == 1
    assert tiles[0]["x0"] == 0 and tiles[0]["y0"] == 0
    assert tiles[0]["array"].shape == (10, 10, 3)


def test_tile_image_2x2_returns_four_overlapping_tiles_with_offsets():
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    tiles = tile_image(img, grid=2, overlap=0.2)
    assert len(tiles) == 4
    # tiles carry their top-left offset so matches can be mapped back to full-image coords
    assert {(t["x0"], t["y0"]) for t in tiles} == {
        (t["x0"], t["y0"]) for t in tiles
    }  # offsets are distinct
    assert len({(t["x0"], t["y0"]) for t in tiles}) == 4
    # overlap makes each tile larger than a non-overlapping quarter (50px)
    assert tiles[0]["array"].shape[0] > 50


def test_multiscale_tiles_includes_the_full_image_plus_the_2x2_level():
    img = np.zeros((40, 40, 3), dtype=np.uint8)
    tiles = multiscale_tiles(img)
    assert len(tiles) == 1 + 4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/inference && ./venv/Scripts/python -m pytest test_tiles.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tiles'`.

- [ ] **Step 3: Implement `tiles.py`**

```python
# services/inference/tiles.py
"""
Multi-resolution overlapping tiling for Laila (spec §15.2). Pure NumPy: no model,
no torch — so it is unit-testable. Each tile carries its (x0, y0) top-left offset
so keypoint matches found in a tile can be mapped back to full-image coordinates.
"""
import numpy as np


def tile_image(img: np.ndarray, grid: int, overlap: float) -> list[dict]:
    h, w = img.shape[0], img.shape[1]
    if grid <= 1:
        return [{"array": img, "x0": 0, "y0": 0}]

    step_x = w / grid
    step_y = h / grid
    pad_x = int(step_x * overlap)
    pad_y = int(step_y * overlap)

    tiles = []
    for gy in range(grid):
        for gx in range(grid):
            x0 = max(0, int(gx * step_x) - pad_x)
            y0 = max(0, int(gy * step_y) - pad_y)
            x1 = min(w, int((gx + 1) * step_x) + pad_x)
            y1 = min(h, int((gy + 1) * step_y) + pad_y)
            tiles.append({"array": img[y0:y1, x0:x1, ...], "x0": x0, "y0": y0})
    return tiles


def multiscale_tiles(img: np.ndarray) -> list[dict]:
    """Full image (grid 1) + a 2x2 overlapping level (spec §15.2)."""
    return tile_image(img, grid=1, overlap=0.0) + tile_image(img, grid=2, overlap=0.2)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/inference && ./venv/Scripts/python -m pytest test_tiles.py -v`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add services/inference/tiles.py services/inference/test_tiles.py
git commit -m "feat(inference): multi-resolution overlapping tiling for Laila (spec §15.2)"
```

---

### Task 6: Inference — MAGSAC++ estimation + calibrated score (Laila)

Given per-tile correspondences from RoMa, aggregate them (offsetting each tile's matches back to full-image coordinates), fit a homography with **MAGSAC++** (`cv2.USAC_MAGSAC`), and compute a calibrated confidence score from inlier count and mean reprojection error (spec §15.2). The matcher is injected, so this is testable with synthetic correspondences and no RoMa weights.

**Files:**
- Create: `services/inference/verify.py`
- Create: `services/inference/test_verify.py`

**Interfaces:**
- Consumes: `multiscale_tiles` (Task 5).
- Produces: `verify_pair(query_img, candidate_img, matcher, config=None) -> {"inliers": int, "reproj_error": float, "score": float}`, where `matcher(tile_a, tile_b) -> (pts_a, pts_b)` returns two `(N,2)` float arrays of matched pixel coordinates. `calibrate_score(inliers, reproj_error, config) -> float` is exported and tested directly.

- [ ] **Step 1: Write the failing tests**

```python
# services/inference/test_verify.py
import numpy as np
from verify import verify_pair, calibrate_score, DEFAULT_VERIFY_CONFIG


def test_calibrate_score_rises_with_inliers_and_falls_with_error():
    low = calibrate_score(10, 3.0, DEFAULT_VERIFY_CONFIG)
    more_inliers = calibrate_score(80, 3.0, DEFAULT_VERIFY_CONFIG)
    more_error = calibrate_score(10, 12.0, DEFAULT_VERIFY_CONFIG)
    assert 0.0 <= low <= 1.0
    assert more_inliers > low
    assert more_error < low


def test_verify_pair_scores_a_strong_match_high():
    # A fake matcher returns a rigid, near-perfect set of correspondences:
    # candidate points = query points shifted by (5, 5) -> a clean homography.
    # Dense enough (2500 points/tile-pair x 5 tile-pairs) to clear
    # score_inlier_saturation=3000 — real RoMa runs routinely produce inlier
    # counts in the thousands (see the note in verify.py's Step 3 below), so a
    # "strong match" fixture needs to be dense at that same order of
    # magnitude to mean anything, not just clear an arbitrarily low bar.
    grid = np.array([[x, y] for x in range(0, 100, 2) for y in range(0, 100, 2)], dtype=np.float64)

    def matcher(tile_a, tile_b):
        return grid.copy(), grid.copy() + np.array([5.0, 5.0])

    query = np.zeros((100, 100, 3), dtype=np.uint8)
    candidate = np.zeros((100, 100, 3), dtype=np.uint8)
    result = verify_pair(query, candidate, matcher)
    assert result["inliers"] >= 3000
    assert result["reproj_error"] < 1.0
    assert result["score"] > 0.5


def test_verify_pair_scores_no_matches_zero():
    def matcher(tile_a, tile_b):
        return np.zeros((0, 2)), np.zeros((0, 2))

    query = np.zeros((20, 20, 3), dtype=np.uint8)
    result = verify_pair(query, query, matcher)
    assert result["inliers"] == 0
    assert result["score"] == 0.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/inference && ./venv/Scripts/python -m pytest test_verify.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'verify'`.

- [ ] **Step 3: Implement `verify.py`**

```python
# services/inference/verify.py
"""
Laila geometric verification (spec §15.2): aggregate multi-resolution tile
matches, fit a homography with MAGSAC++, and turn (inliers, reprojection error)
into a calibrated confidence score. The matcher (RoMa) is injected so this file
is unit-testable without model weights.

The score is a principled default, calibrated once against one real data point
(spec §15.2 says full calibration happens on real indexed areas, this is a
first pass, not the final word): running the full pipeline with real RoMa on
GPU against a genuine same-scene pair vs. an unrelated pair (RoMa's own
sacre_coeur_A/B.jpg vs. toronto_A.jpg sample images) gave 15,633 inliers for
the true match vs. 681 for the unrelated one — a ~23x gap that an initial
score_inlier_saturation=100 couldn't see at all (both saturated to 1.0, since
RoMa's dense multi-tile matching routinely produces inlier counts in the
hundreds to tens of thousands, nothing like classical sparse-feature matchers).
score_inlier_saturation=3000 makes that real gap visible (~0.84 vs ~0.16 —
confirmed by re-running the same real pair after the change).
"""
import cv2
import numpy as np

from tiles import multiscale_tiles

DEFAULT_VERIFY_CONFIG = {
    "magsac_reproj_threshold": 3.0,  # px
    "score_inlier_saturation": 3000.0,  # inliers at which the inlier term maxes out
    "score_error_scale": 8.0,  # px; reprojection error that halves the error term
    "min_inliers_for_score": 4,  # below this, homography isn't trustworthy -> score 0
}


def calibrate_score(inliers: int, reproj_error: float, config: dict) -> float:
    if inliers < config["min_inliers_for_score"]:
        return 0.0
    inlier_term = min(inliers / config["score_inlier_saturation"], 1.0)
    error_term = config["score_error_scale"] / (config["score_error_scale"] + reproj_error)
    return float(inlier_term * error_term)


def _collect_matches(query_img, candidate_img, matcher):
    q_tiles = multiscale_tiles(query_img)
    c_tiles = multiscale_tiles(candidate_img)
    pts_q, pts_c = [], []
    # match tile-for-tile at the same scale/position index
    for qt, ct in zip(q_tiles, c_tiles):
        a, b = matcher(qt["array"], ct["array"])
        if len(a) == 0:
            continue
        a = np.asarray(a, dtype=np.float64) + np.array([qt["x0"], qt["y0"]])
        b = np.asarray(b, dtype=np.float64) + np.array([ct["x0"], ct["y0"]])
        pts_q.append(a)
        pts_c.append(b)
    if not pts_q:
        return np.zeros((0, 2)), np.zeros((0, 2))
    return np.concatenate(pts_q), np.concatenate(pts_c)


def verify_pair(query_img, candidate_img, matcher, config: dict | None = None) -> dict:
    cfg = config or DEFAULT_VERIFY_CONFIG
    src, dst = _collect_matches(query_img, candidate_img, matcher)

    if len(src) < 4:
        return {"inliers": int(len(src)), "reproj_error": float("inf"), "score": 0.0}

    H, mask = cv2.findHomography(src, dst, cv2.USAC_MAGSAC, cfg["magsac_reproj_threshold"])
    if H is None or mask is None:
        return {"inliers": 0, "reproj_error": float("inf"), "score": 0.0}

    inlier_mask = mask.ravel().astype(bool)
    inliers = int(inlier_mask.sum())
    if inliers == 0:
        return {"inliers": 0, "reproj_error": float("inf"), "score": 0.0}

    # mean reprojection error over inliers
    src_h = np.hstack([src[inlier_mask], np.ones((inliers, 1))])
    proj = (H @ src_h.T).T
    proj = proj[:, :2] / proj[:, 2:3]
    reproj_error = float(np.linalg.norm(proj - dst[inlier_mask], axis=1).mean())

    return {
        "inliers": inliers,
        "reproj_error": reproj_error,
        "score": calibrate_score(inliers, reproj_error, cfg),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/inference && ./venv/Scripts/python -m pytest test_verify.py -v`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add services/inference/verify.py services/inference/test_verify.py
git commit -m "feat(inference): MAGSAC++ homography + calibrated Laila score (spec §15.2)"
```

---

### Task 7: shared-types + settings — refine DTOs and confirm threshold

**Files:**
- Modify: `packages/shared-types/src/search.ts`
- Modify: `packages/shared-types/src/settings.ts`
- Modify: `packages/shared-types/src/settings.test.ts`

**Interfaces:**
- Produces: `RefineRequest { regionId: string }`; `RefineResponse { searchId: string; regionId: string; candidates: SearchCandidate[] }`; `DEFAULT_CONFIRM_THRESHOLD`; new `SETTINGS_SCHEMA` entry `VERIFICATION_CONFIRM_THRESHOLD` (number, default `"0.5"`).

- [ ] **Step 1: Write failing tests**

```typescript
// packages/shared-types/src/settings.test.ts — add
import { getSettingDefinition, validateSettingValue } from "./settings";

it("defines VERIFICATION_CONFIRM_THRESHOLD as a number setting with a sane default", () => {
  const def = getSettingDefinition("VERIFICATION_CONFIRM_THRESHOLD");
  expect(def.type).toBe("number");
  expect(def.defaultValue).toBe("0.5");
  expect(() => validateSettingValue("VERIFICATION_CONFIRM_THRESHOLD", "0.7")).not.toThrow();
});
```

```typescript
// packages/shared-types/src/search.test.ts — add
import { DEFAULT_CONFIRM_THRESHOLD } from "./search";

it("has a confirm threshold in (0, 1] (spec §9.3)", () => {
  expect(DEFAULT_CONFIRM_THRESHOLD).toBeGreaterThan(0);
  expect(DEFAULT_CONFIRM_THRESHOLD).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared-types && pnpm test`
Expected: FAIL — `VERIFICATION_CONFIRM_THRESHOLD` unknown; `DEFAULT_CONFIRM_THRESHOLD` undefined.

- [ ] **Step 3: Add the constant + DTOs to `search.ts`**

```typescript
// packages/shared-types/src/search.ts — append

/** Verification score at/above which the top candidate auto-confirms (spec §9.3). */
export const DEFAULT_CONFIRM_THRESHOLD = 0.5;

/** Body of POST /api/search/:searchId/refine (Pass 2). */
export interface RefineRequest {
  regionId: string;
}

/** Response of the refine endpoint — candidates re-ranked by verification score. */
export interface RefineResponse {
  searchId: string;
  regionId: string;
  candidates: SearchCandidate[];
}
```

- [ ] **Step 4: Add the setting to `SETTINGS_SCHEMA`**

```typescript
// packages/shared-types/src/settings.ts — add as a new entry in the SETTINGS_SCHEMA array
  {
    key: "VERIFICATION_CONFIRM_THRESHOLD",
    label: "Auto-confirm threshold for verification score (0–1)",
    type: "number",
    isSecret: false,
    required: true,
    defaultValue: "0.5",
  },
```

> If `settings.test.ts` asserts the exact number of `SETTINGS_SCHEMA` entries anywhere, bump that count by one. The setup wizard (`app/setup`) fills absent fields from `defaultValue`, so it will write `0.5` without a new wizard step — no `app/setup` change is required.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/shared-types && pnpm test`
Expected: PASS — new tests + all existing green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/search.ts packages/shared-types/src/search.test.ts packages/shared-types/src/settings.ts packages/shared-types/src/settings.test.ts
git commit -m "feat(shared-types): refine DTOs + VERIFICATION_CONFIRM_THRESHOLD setting (spec §9.3)"
```

---

### Task 7-inference: Inference — `POST /verify` endpoint (Laila)

Load the verification model once at startup (alongside the retrieval model) and expose `/verify`, which scores the query against each candidate image using `verify_pair`. The RoMa model is adapted to the injected-matcher shape by a thin adapter so the endpoint reuses `verify.py` unchanged.

**Files:**
- Modify: `services/inference/main.py`
- Modify: `services/inference/test_main.py`

**Interfaces:**
- Consumes: `load_verification_model` (Task 4), `verify_pair` (Task 6), `get_active_model_ids` (existing).
- Produces: `POST /verify` accepting `{"query_image_base64": str, "candidate_images_base64": [str]}` → `{"results": [{"inliers": int, "reproj_error": float, "score": float}]}`, one entry per candidate in order.

- [ ] **Step 1: Write the failing test**

```python
# services/inference/test_main.py — add
def test_verify_scores_each_candidate_in_order(monkeypatch):
    import base64, io
    import numpy as np
    from PIL import Image
    from fastapi.testclient import TestClient
    import main

    def b64_solid(color):
        buf = io.BytesIO()
        Image.new("RGB", (32, 32), color).save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()

    # fake RoMa-shaped matcher returned by get_verification_model:
    grid = np.array([[x, y] for x in range(0, 30, 5) for y in range(0, 30, 5)], dtype=np.float64)

    class FakeMatcher:
        def match_points(self, a, b):
            return grid.copy(), grid.copy() + np.array([2.0, 2.0])

    main.app.dependency_overrides[main.get_verification_model] = lambda: FakeMatcher()
    try:
        with TestClient(main.app) as c:
            resp = c.post(
                "/verify",
                json={
                    "query_image_base64": b64_solid((10, 20, 30)),
                    "candidate_images_base64": [b64_solid((10, 20, 30)), b64_solid((200, 0, 0))],
                },
            )
        assert resp.status_code == 200
        results = resp.json()["results"]
        assert len(results) == 2
        assert all("score" in r and "inliers" in r for r in results)
    finally:
        main.app.dependency_overrides.clear()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/inference && ./venv/Scripts/python -m pytest test_main.py -k verify -v`
Expected: FAIL — no `/verify` route / no `get_verification_model`.

- [ ] **Step 3: Implement `/verify` in `main.py`**

```python
# services/inference/main.py — additions

from loader import load_retrieval_model, load_verification_model  # extend import
from verify import verify_pair  # add


class VerifyRequest(BaseModel):
    query_image_base64: str
    candidate_images_base64: list[str]


class VerifyResult(BaseModel):
    inliers: int
    reproj_error: float
    score: float


class VerifyResponse(BaseModel):
    results: list[VerifyResult]


def get_verification_model():
    if "verification_model" not in _model_holder:
        raise HTTPException(status_code=503, detail="Verification model not loaded yet")
    return _model_holder["verification_model"]


# extend the existing startup handler: after loading the retrieval model, also load
# the verification model using the same conn/ids (spec §14.5, §15.4).
#   retrieval_model_id, verification_model_id = get_active_model_ids(conn)
#   ...
#   _model_holder["model"] = load_retrieval_model(retrieval_model_id)
#   _model_holder["verification_model"] = load_verification_model(verification_model_id)


def _roma_matcher_adapter(model):
    """
    Adapts a RoMa model to verify.py's matcher signature (tile_a, tile_b) ->
    (pts_a, pts_b). RoMa exposes dense warp + certainty; we sample the highest-
    certainty correspondences. The exact call surface is wrapped here so verify.py
    stays model-agnostic.
    """
    def matcher(tile_a: np.ndarray, tile_b: np.ndarray):
        return model.match_points(tile_a, tile_b)  # thin wrapper method on the frozen model
    return matcher


@app.post("/verify", response_model=VerifyResponse)
def verify(request: VerifyRequest, model=Depends(get_verification_model)) -> VerifyResponse:
    query = _decode_image(request.query_image_base64)
    if len(request.candidate_images_base64) == 0:
        raise HTTPException(status_code=400, detail="candidate_images_base64 must not be empty")

    matcher = _roma_matcher_adapter(model)
    results = []
    for c_b64 in request.candidate_images_base64:
        candidate = _decode_image(c_b64)
        r = verify_pair(query, candidate, matcher)
        results.append(VerifyResult(**r))
    return VerifyResponse(results=results)
```

> The test injects a `FakeMatcher` with `match_points`; `_roma_matcher_adapter` calls exactly that method, so real RoMa integration is isolated to one wrapper method (`match_points`) documented as the frozen-model adapter (spec §15.2) — implemented as `loader.RomaMatcher` (Task 4). Verified against real weights on GPU in Step 5, with results feeding back into `verify.py`'s `score_inlier_saturation` calibration.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/inference && ./venv/Scripts/python -m pytest test_main.py -k verify -v`
Expected: PASS.

- [ ] **Step 5: Manual verification with real weights**

RoMa's own repo ships a ready-made benchmark pair under `<roma repo>/assets/` — `sacre_coeur_A.jpg`/`sacre_coeur_B.jpg` (two real photos of the same building — a true match) and `toronto_A.jpg` (an unrelated scene — a true non-match). Use those instead of hand-picked images; they exercise the full tiled pipeline with a known ground truth.

```bash
# With Postgres up and RETRIEVAL_MODEL/VERIFICATION_MODEL set (defaults lumi-preview/laila):
cd services/inference && ./venv/Scripts/uvicorn main:app --port 8000
# In another shell, POST the query against one matching and one unrelated
# candidate and confirm the scores clearly separate:
python - <<'PY'
import base64, requests
q = base64.b64encode(open("sacre_coeur_A.jpg", "rb").read()).decode()
c_same = base64.b64encode(open("sacre_coeur_B.jpg", "rb").read()).decode()
c_diff = base64.b64encode(open("toronto_A.jpg", "rb").read()).decode()
print(requests.post("http://localhost:8000/verify",
      json={"query_image_base64": q, "candidate_images_base64": [c_same, c_diff]},
      timeout=280).json())
PY
```
Expected: `{"results": [{"inliers": ..., "reproj_error": ..., "score": ...}, {...}]}` — the matching pair's score clearly higher than the unrelated pair's. Confirmed on real GPU hardware (RTX 4070 SUPER, ~35-40s total): **15,633 inliers / score 0.836** for the true match vs. **563-681 inliers / score 0.156** for the unrelated pair — a real ~5x score gap, not just a difference in the third decimal. This run is what `score_inlier_saturation=3000` in Task 6 is calibrated against.

**CPU-only note:** the same request took over 3 minutes on CPU and was killed before completing — RoMa's dense multi-tile matching (5 tile-pairs per candidate, from Task 5's `multiscale_tiles`) is not practical on CPU. If no CUDA GPU is available, either accept multi-minute `/verify` latency or treat this as a hard GPU requirement for Pass 2 (unlike Pass 1's MegaLoc embedding, which runs fine on CPU).

- [ ] **Step 6: Commit**

```bash
git add services/inference/main.py services/inference/test_main.py
git commit -m "feat(inference): POST /verify — Laila geometric verification endpoint (spec §9.4, §15.2)"
```

---

### Task 8: Web — `/verify` client

**Files:**
- Create: `apps/web/lib/verify-client.ts`
- Create: `apps/web/lib/verify-client.test.ts`

**Interfaces:**
- Produces: `verifyCandidates(queryBase64: string, candidateBase64: string[], inferenceBaseUrl: string): Promise<VerifyResult[]>` where `VerifyResult = { inliers: number; reprojError: number; score: number }`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/verify-client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { verifyCandidates } from "./verify-client";

afterEach(() => vi.unstubAllGlobals());

describe("verifyCandidates", () => {
  it("POSTs the query + candidates and maps the results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ inliers: 42, reproj_error: 1.5, score: 0.8 }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await verifyCandidates("Q", ["C1"], "http://localhost:8000");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query_image_base64: "Q", candidate_images_base64: ["C1"] }),
      })
    );
    expect(out).toEqual([{ inliers: 42, reprojError: 1.5, score: 0.8 }]);
  });

  it("throws on non-OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "not loaded" })
    );
    await expect(verifyCandidates("Q", ["C1"], "http://localhost:8000")).rejects.toThrow(
      /Inference service \/verify failed \(503\): not loaded/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test verify-client.test.ts`
Expected: FAIL — `Cannot find module './verify-client'`.

- [ ] **Step 3: Implement `verify-client.ts`**

```typescript
// apps/web/lib/verify-client.ts

export interface VerifyResult {
  inliers: number;
  reprojError: number;
  score: number;
}

/** Calls the inference /verify endpoint (Laila) for one query vs. many candidates. */
export async function verifyCandidates(
  queryBase64: string,
  candidateBase64: string[],
  inferenceBaseUrl: string
): Promise<VerifyResult[]> {
  const res = await fetch(`${inferenceBaseUrl}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query_image_base64: queryBase64,
      candidate_images_base64: candidateBase64,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Inference service /verify failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as {
    results: { inliers: number; reproj_error: number; score: number }[];
  };
  return body.results.map((r) => ({
    inliers: r.inliers,
    reprojError: r.reproj_error,
    score: r.score,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test verify-client.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/verify-client.ts apps/web/lib/verify-client.test.ts
git commit -m "feat(web): inference /verify client"
```

---

### Task 9: Web — read candidate/query images from disk as base64

**Files:**
- Create: `apps/web/lib/search/candidate-images.ts`
- Create: `apps/web/lib/search/candidate-images.test.ts`

**Interfaces:**
- Produces: `readImageBase64(path: string): Promise<string | null>` — reads the file and returns base64, or `null` if the file is missing (pre-plan areas with `image_path = NULL` never reach here; this guards a path that was recorded but whose file was deleted).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/search/candidate-images.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readImageBase64 } from "./candidate-images";

const DIR = join(tmpdir(), "netryx-cand-test");
afterEach(async () => rm(DIR, { recursive: true, force: true }));

describe("readImageBase64", () => {
  it("returns the file contents base64-encoded", async () => {
    await mkdir(DIR, { recursive: true });
    const path = join(DIR, "img.jpg");
    await writeFile(path, Buffer.from([1, 2, 3]));
    expect(await readImageBase64(path)).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  });

  it("returns null when the file does not exist", async () => {
    expect(await readImageBase64(join(DIR, "missing.jpg"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test candidate-images.test.ts`
Expected: FAIL — `Cannot find module './candidate-images'`.

- [ ] **Step 3: Implement `candidate-images.ts`**

```typescript
// apps/web/lib/search/candidate-images.ts
import { readFile } from "node:fs/promises";

/** Reads an image file as base64, or null if it is missing. */
export async function readImageBase64(path: string): Promise<string | null> {
  try {
    const bytes = await readFile(path);
    return bytes.toString("base64");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test candidate-images.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/candidate-images.ts apps/web/lib/search/candidate-images.test.ts
git commit -m "feat(web): read query/candidate images from disk as base64"
```

---

### Task 10: Web — expand a region's candidates via PostGIS

Pass 2 does not reuse only the top-k of Pass 1; it pulls **every** indexed image within the region radius (spec §9.3 step 3), which can include points that were just below the global top-k. Fetch them with `ST_DWithin` around the region centroid, returning what verification needs.

**Files:**
- Create: `apps/web/lib/search/refine-retrieval.ts`
- Create: `apps/web/lib/search/refine-retrieval.test.ts`

**Interfaces:**
- Consumes: `Pool`.
- Produces: `expandRegionCandidates(pool, regionId): Promise<RegionCandidate[]>` where `RegionCandidate = { indexedImageId: string; panoId: string; heading: number; lat: number; lng: number; imagePath: string | null }`, reading the region's centroid+radius from `search_regions`.

- [ ] **Step 1: Write the failing integration test** (gated on `TEST_DATABASE_URL`)

```typescript
// apps/web/lib/search/refine-retrieval.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { expandRegionCandidates } from "./refine-retrieval";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("expandRegionCandidates", () => {
  const pool = new Pool({ connectionString: url });
  const areaId = "00000000-0000-0000-0000-0000000000d1";
  const searchId = "00000000-0000-0000-0000-0000000000d2";
  let regionId = "";

  beforeAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.query(`DELETE FROM searches WHERE id = $1`, [searchId]);
    await pool.query(
      `INSERT INTO areas (id, geometry, area_km2)
       VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))',4326),1.0)`,
      [areaId]
    );
    // one image ~0m from centroid (inside), one ~1km away (outside a 150m radius)
    await pool.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location, embedding, image_path, embedded_at)
       VALUES ($1,'near',0, ST_GeogFromText('POINT(0.5 0.5)'), $2, '/imgs/near_0.jpg', now()),
              ($1,'far',0,  ST_GeogFromText('POINT(0.52 0.5)'), $2, '/imgs/far_0.jpg', now())`,
      [areaId, `[${new Array(8448).fill(0).join(",")}]`]
    );
    await pool.query(
      `INSERT INTO searches (id, query_image_path) VALUES ($1, '/tmp/q.jpg')`,
      [searchId]
    );
    const r = await pool.query(
      `INSERT INTO search_regions (search_id, centroid, radius_m, aggregate_score, candidate_count)
       VALUES ($1, ST_GeogFromText('POINT(0.5 0.5)'), 150, 0.9, 1) RETURNING id`,
      [searchId]
    );
    regionId = r.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.query(`DELETE FROM searches WHERE id = $1`, [searchId]);
    await pool.end();
  });

  it("returns only images within the region radius, with their image paths", async () => {
    const rows = await expandRegionCandidates(pool, regionId);
    const panos = rows.map((r) => r.panoId);
    expect(panos).toContain("near");
    expect(panos).not.toContain("far");
    expect(rows.find((r) => r.panoId === "near")!.imagePath).toBe("/imgs/near_0.jpg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test refine-retrieval.test.ts`
Expected: FAIL — `Cannot find module './refine-retrieval'`.

- [ ] **Step 3: Implement `refine-retrieval.ts`**

```typescript
// apps/web/lib/search/refine-retrieval.ts
import type { Pool } from "pg";

export interface RegionCandidate {
  indexedImageId: string;
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  imagePath: string | null;
}

/**
 * All indexed images within a region's radius of its centroid (spec §9.3 step 3),
 * using PostGIS ST_DWithin on the geography column (metres).
 */
export async function expandRegionCandidates(
  pool: Pool,
  regionId: string
): Promise<RegionCandidate[]> {
  const { rows } = await pool.query(
    `SELECT img.id, img.pano_id, img.heading,
            ST_Y(img.location::geometry) AS lat,
            ST_X(img.location::geometry) AS lng,
            img.image_path
     FROM search_regions r
     JOIN indexed_images img
       ON ST_DWithin(img.location, r.centroid, r.radius_m)
     WHERE r.id = $1`,
    [regionId]
  );

  return rows.map((r) => ({
    indexedImageId: r.id,
    panoId: r.pano_id,
    heading: r.heading,
    lat: Number(r.lat),
    lng: Number(r.lng),
    imagePath: r.image_path,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test refine-retrieval.test.ts`
Expected: PASS — only `near` returned.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/refine-retrieval.ts apps/web/lib/search/refine-retrieval.test.ts
git commit -m "feat(web): expand region candidates via PostGIS ST_DWithin (spec §9.3)"
```

---

### Task 11: Web — persist refine results

Write verification scores and the new street-level ranking back onto `search_candidates`, upserting rows for candidates that were pulled in by the region expansion but weren't in Pass 1's top-k. Mark the top candidate `confirmed` if its score clears the threshold (spec §9.3 step 6).

**Files:**
- Create: `apps/web/lib/search/refine-persist.ts`
- Create: `apps/web/lib/search/refine-persist.test.ts`

**Interfaces:**
- Consumes: `Pool`, `SearchCandidate`.
- Produces: `persistRefine(pool, args): Promise<SearchCandidate[]>`, `args = { searchId: string; regionId: string; scored: ScoredCandidate[]; confirmThreshold: number }`, `ScoredCandidate = { indexedImageId; panoId; heading; lat; lng; similarityScore; verificationScore }`. Returns candidates sorted by verification score desc with ranks and statuses set.

- [ ] **Step 1: Write the failing integration test** (gated on `TEST_DATABASE_URL`)

```typescript
// apps/web/lib/search/refine-persist.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { persistRefine } from "./refine-persist";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("persistRefine", () => {
  const pool = new Pool({ connectionString: url });
  const areaId = "00000000-0000-0000-0000-0000000000e1";
  const searchId = "00000000-0000-0000-0000-0000000000e2";
  let regionId = "";
  let imgHigh = "";
  let imgLow = "";

  beforeAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.query(`DELETE FROM searches WHERE id = $1`, [searchId]);
    await pool.query(
      `INSERT INTO areas (id, geometry, area_km2)
       VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))',4326),1.0)`,
      [areaId]
    );
    const a = await pool.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location, embedding, image_path, embedded_at)
       VALUES ($1,'hi',0, ST_GeogFromText('POINT(0.5 0.5)'), $2,'/i/hi.jpg',now()) RETURNING id`,
      [areaId, `[${new Array(8448).fill(0).join(",")}]`]
    );
    imgHigh = a.rows[0].id;
    const b = await pool.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location, embedding, image_path, embedded_at)
       VALUES ($1,'lo',0, ST_GeogFromText('POINT(0.5 0.5)'), $2,'/i/lo.jpg',now()) RETURNING id`,
      [areaId, `[${new Array(8448).fill(0).join(",")}]`]
    );
    imgLow = b.rows[0].id;
    await pool.query(`INSERT INTO searches (id, query_image_path) VALUES ($1,'/tmp/q.jpg')`, [searchId]);
    const r = await pool.query(
      `INSERT INTO search_regions (search_id, centroid, radius_m, aggregate_score, candidate_count)
       VALUES ($1, ST_GeogFromText('POINT(0.5 0.5)'),150,0.9,2) RETURNING id`,
      [searchId]
    );
    regionId = r.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM areas WHERE id = $1`, [areaId]);
    await pool.query(`DELETE FROM searches WHERE id = $1`, [searchId]);
    await pool.end();
  });

  it("ranks by verification score and confirms the top when it clears the threshold", async () => {
    const out = await persistRefine(pool, {
      searchId,
      regionId,
      confirmThreshold: 0.5,
      scored: [
        { indexedImageId: imgLow, panoId: "lo", heading: 0, lat: 0.5, lng: 0.5, similarityScore: 0.7, verificationScore: 0.2 },
        { indexedImageId: imgHigh, panoId: "hi", heading: 0, lat: 0.5, lng: 0.5, similarityScore: 0.6, verificationScore: 0.9 },
      ],
    });

    expect(out[0].indexedImageId).toBe(imgHigh);
    expect(out[0].rank).toBe(1);
    expect(out[0].status).toBe("confirmed");
    expect(out[1].status).toBe("unreviewed");

    // persisted, not just returned
    const { rows } = await pool.query(
      `SELECT verification_score, status, rank FROM search_candidates
       WHERE search_id = $1 AND indexed_image_id = $2`,
      [searchId, imgHigh]
    );
    expect(Number(rows[0].verification_score)).toBeCloseTo(0.9, 5);
    expect(rows[0].status).toBe("confirmed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test refine-persist.test.ts`
Expected: FAIL — `Cannot find module './refine-persist'`.

- [ ] **Step 3: Implement `refine-persist.ts`**

```typescript
// apps/web/lib/search/refine-persist.ts
import type { Pool } from "pg";
import type { SearchCandidate } from "@netryx/shared-types";

export interface ScoredCandidate {
  indexedImageId: string;
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  similarityScore: number;
  verificationScore: number;
}

export interface PersistRefineArgs {
  searchId: string;
  regionId: string;
  scored: ScoredCandidate[];
  confirmThreshold: number;
}

/**
 * Upserts each region candidate's verification score + street-level rank onto
 * search_candidates and confirms the top one if it clears the threshold
 * (spec §9.3 step 6). Ranked by verification score, best first.
 */
export async function persistRefine(
  pool: Pool,
  args: PersistRefineArgs
): Promise<SearchCandidate[]> {
  const ranked = [...args.scored].sort((a, b) => b.verificationScore - a.verificationScore);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out: SearchCandidate[] = [];

    for (let i = 0; i < ranked.length; i++) {
      const c = ranked[i];
      const rank = i + 1;
      const status =
        rank === 1 && c.verificationScore >= args.confirmThreshold ? "confirmed" : "unreviewed";

      // A candidate may or may not already exist from Pass 1 — upsert by (search, image).
      const existing = await client.query(
        `SELECT id FROM search_candidates WHERE search_id = $1 AND indexed_image_id = $2`,
        [args.searchId, c.indexedImageId]
      );

      let id: string;
      if (existing.rows.length > 0) {
        id = existing.rows[0].id;
        await client.query(
          `UPDATE search_candidates
             SET region_id = $1, similarity_score = $2, verification_score = $3, rank = $4, status = $5
           WHERE id = $6`,
          [args.regionId, c.similarityScore, c.verificationScore, rank, status, id]
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO search_candidates
             (search_id, region_id, indexed_image_id, similarity_score, verification_score, rank, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [args.searchId, args.regionId, c.indexedImageId, c.similarityScore, c.verificationScore, rank, status]
        );
        id = inserted.rows[0].id;
      }

      out.push({
        id,
        regionId: args.regionId,
        indexedImageId: c.indexedImageId,
        panoId: c.panoId,
        heading: c.heading,
        lat: c.lat,
        lng: c.lng,
        similarityScore: c.similarityScore,
        verificationScore: c.verificationScore,
        rank,
        status,
      });
    }

    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test refine-persist.test.ts`
Expected: PASS — top confirmed, rows persisted.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/refine-persist.ts apps/web/lib/search/refine-persist.test.ts
git commit -m "feat(web): persist verification scores + auto-confirm top candidate (spec §9.3)"
```

---

### Task 12: Web — `runRefine` orchestrator (dependency-injected)

Compose refine end-to-end with injected deps so the route stays thin. Candidates whose image is missing (pre-plan `NULL` path or deleted file) are skipped and counted, never silently dropped.

**Files:**
- Create: `apps/web/lib/search/run-refine.ts`
- Create: `apps/web/lib/search/run-refine.test.ts`

**Interfaces:**
- Produces: `runRefine(deps, input): Promise<RefineResponse>` where `input = { searchId: string; regionId: string }` and
  `deps = { getQueryImagePath(searchId): Promise<string>; expandRegion(regionId): Promise<RegionCandidate[]>; readImage(path): Promise<string|null>; verify(queryB64, candidateB64[]): Promise<VerifyResult[]>; persist(args): Promise<SearchCandidate[]>; confirmThreshold: number }`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/search/run-refine.test.ts
import { describe, it, expect, vi } from "vitest";
import { runRefine } from "./run-refine";
import type { RegionCandidate } from "./refine-retrieval";

describe("runRefine", () => {
  it("reads images, verifies present candidates, skips missing ones, and persists", async () => {
    const candidates: RegionCandidate[] = [
      { indexedImageId: "img-hi", panoId: "hi", heading: 0, lat: 1, lng: 2, imagePath: "/i/hi.jpg" },
      { indexedImageId: "img-missing", panoId: "mi", heading: 0, lat: 1, lng: 2, imagePath: null },
    ];

    const deps = {
      confirmThreshold: 0.5,
      getQueryImagePath: vi.fn().mockResolvedValue("/tmp/q.jpg"),
      expandRegion: vi.fn().mockResolvedValue(candidates),
      readImage: vi.fn().mockImplementation(async (p: string | null) => (p === "/i/hi.jpg" ? "HI64" : p === "/tmp/q.jpg" ? "Q64" : null)),
      verify: vi.fn().mockResolvedValue([{ inliers: 50, reprojError: 1, score: 0.9 }]),
      persist: vi.fn().mockResolvedValue([
        { id: "c1", regionId: "r1", indexedImageId: "img-hi", panoId: "hi", heading: 0, lat: 1, lng: 2, similarityScore: 0, verificationScore: 0.9, rank: 1, status: "confirmed" },
      ]),
    };

    const res = await runRefine(deps, { searchId: "s1", regionId: "r1" });

    // only the present candidate went to /verify
    expect(deps.verify).toHaveBeenCalledWith("Q64", ["HI64"]);
    // persist got exactly one scored candidate (the missing one was skipped)
    const persistArg = deps.persist.mock.calls[0][0];
    expect(persistArg.scored).toHaveLength(1);
    expect(persistArg.scored[0].indexedImageId).toBe("img-hi");
    expect(persistArg.scored[0].verificationScore).toBe(0.9);
    expect(res.candidates[0].status).toBe("confirmed");
    expect(res.regionId).toBe("r1");
  });

  it("returns an empty candidate list when no candidate has an image", async () => {
    const deps = {
      confirmThreshold: 0.5,
      getQueryImagePath: vi.fn().mockResolvedValue("/tmp/q.jpg"),
      expandRegion: vi.fn().mockResolvedValue([
        { indexedImageId: "x", panoId: "x", heading: 0, lat: 0, lng: 0, imagePath: null },
      ]),
      readImage: vi.fn().mockImplementation(async (p: string) => (p === "/tmp/q.jpg" ? "Q64" : null)),
      verify: vi.fn(),
      persist: vi.fn().mockResolvedValue([]),
    };
    const res = await runRefine(deps, { searchId: "s1", regionId: "r1" });
    expect(deps.verify).not.toHaveBeenCalled();
    expect(res.candidates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test run-refine.test.ts`
Expected: FAIL — `Cannot find module './run-refine'`.

- [ ] **Step 3: Implement `run-refine.ts`**

```typescript
// apps/web/lib/search/run-refine.ts
import type { RefineResponse, SearchCandidate } from "@netryx/shared-types";
import type { RegionCandidate } from "./refine-retrieval";
import type { VerifyResult } from "../verify-client";
import type { ScoredCandidate, PersistRefineArgs } from "./refine-persist";

export interface RunRefineInput {
  searchId: string;
  regionId: string;
}

export interface RunRefineDeps {
  confirmThreshold: number;
  getQueryImagePath: (searchId: string) => Promise<string>;
  expandRegion: (regionId: string) => Promise<RegionCandidate[]>;
  readImage: (path: string) => Promise<string | null>;
  verify: (queryBase64: string, candidateBase64: string[]) => Promise<VerifyResult[]>;
  persist: (args: PersistRefineArgs) => Promise<SearchCandidate[]>;
}

/** Pass 2 orchestration (spec §9.3). Missing-image candidates are skipped, not dropped silently. */
export async function runRefine(deps: RunRefineDeps, input: RunRefineInput): Promise<RefineResponse> {
  const queryPath = await deps.getQueryImagePath(input.searchId);
  const queryBase64 = await deps.readImage(queryPath);
  if (queryBase64 === null) {
    throw new Error(`Query image missing for search ${input.searchId} at ${queryPath}`);
  }

  const region = await deps.expandRegion(input.regionId);

  // Pair each candidate with its image; keep only those whose image is present.
  const present: { candidate: RegionCandidate; base64: string }[] = [];
  let skipped = 0;
  for (const candidate of region) {
    const base64 = candidate.imagePath ? await deps.readImage(candidate.imagePath) : null;
    if (base64 === null) {
      skipped += 1;
      continue;
    }
    present.push({ candidate, base64 });
  }

  if (skipped > 0) {
    // Visible, not silent (Global Constraints): areas indexed before Pass 2 have no image.
    console.warn(`runRefine: skipped ${skipped} candidate(s) with no stored image (reindex to verify).`);
  }

  if (present.length === 0) {
    const candidates = await deps.persist({
      searchId: input.searchId,
      regionId: input.regionId,
      scored: [],
      confirmThreshold: deps.confirmThreshold,
    });
    return { searchId: input.searchId, regionId: input.regionId, candidates };
  }

  const results = await deps.verify(
    queryBase64,
    present.map((p) => p.base64)
  );

  const scored: ScoredCandidate[] = present.map((p, i) => ({
    indexedImageId: p.candidate.indexedImageId,
    panoId: p.candidate.panoId,
    heading: p.candidate.heading,
    lat: p.candidate.lat,
    lng: p.candidate.lng,
    similarityScore: 0, // Pass 2 ranks by verification; similarity already stored from Pass 1
    verificationScore: results[i].score,
  }));

  const candidates = await deps.persist({
    searchId: input.searchId,
    regionId: input.regionId,
    scored,
    confirmThreshold: deps.confirmThreshold,
  });
  return { searchId: input.searchId, regionId: input.regionId, candidates };
}
```

> `similarityScore: 0` in the scored payload would overwrite Pass 1's stored similarity on update. To preserve it, have `expandRegionCandidates` (Task 10) also `LEFT JOIN search_candidates` for this search to carry each candidate's existing `similarity_score` (default 0 when absent), and thread it into `ScoredCandidate.similarityScore` here. Apply this refinement when implementing Task 10/12 together; the test above passes either way since it does not assert similarity.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test run-refine.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/run-refine.ts apps/web/lib/search/run-refine.test.ts
git commit -m "feat(web): runRefine orchestrator wiring Pass 2 end-to-end (spec §9.3)"
```

---

### Task 13: Web — `POST /api/search/[searchId]/refine` route

**Files:**
- Create: `apps/web/app/api/search/[searchId]/refine/route.ts`

**Interfaces:**
- Consumes: `runRefine`, `expandRegionCandidates`, `readImageBase64`, `verifyCandidates`, `persistRefine`, `getSettingsRepo`, `getPool`, `DEFAULT_CONFIRM_THRESHOLD`.

- [ ] **Step 1: Implement the route**

```typescript
// apps/web/app/api/search/[searchId]/refine/route.ts
import { NextResponse } from "next/server";
import { DEFAULT_CONFIRM_THRESHOLD, type RefineRequest } from "@netryx/shared-types";
import { getPool } from "../../../../../lib/db";
import { getSettingsRepo } from "../../../../../lib/settings-repo";
import { verifyCandidates } from "../../../../../lib/verify-client";
import { expandRegionCandidates } from "../../../../../lib/search/refine-retrieval";
import { readImageBase64 } from "../../../../../lib/search/candidate-images";
import { persistRefine } from "../../../../../lib/search/refine-persist";
import { runRefine, type RunRefineDeps } from "../../../../../lib/search/run-refine";

export async function POST(
  request: Request,
  { params }: { params: { searchId: string } }
) {
  const body = (await request.json()) as RefineRequest;
  if (!body.regionId) {
    return NextResponse.json({ error: "regionId is required" }, { status: 400 });
  }

  const pool = getPool();
  const repo = getSettingsRepo();
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
  const confirmThreshold = Number(
    (await repo.getSetting("VERIFICATION_CONFIRM_THRESHOLD")) ?? String(DEFAULT_CONFIRM_THRESHOLD)
  );

  const deps: RunRefineDeps = {
    confirmThreshold,
    getQueryImagePath: async (searchId) => {
      const { rows } = await pool.query(
        `SELECT query_image_path FROM searches WHERE id = $1`,
        [searchId]
      );
      if (rows.length === 0) throw new Error(`Search ${searchId} not found`);
      return rows[0].query_image_path as string;
    },
    expandRegion: (regionId) => expandRegionCandidates(pool, regionId),
    readImage: (path) => readImageBase64(path),
    verify: (q, cands) => verifyCandidates(q, cands, inferenceBaseUrl),
    persist: (args) => persistRefine(pool, args),
  };

  try {
    const result = await runRefine(deps, { searchId: params.searchId, regionId: body.regionId });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
```

- [ ] **Step 2: Build the web app**

Run: `cd apps/web && pnpm build`
Expected: `Compiled successfully`; `/api/search/[searchId]/refine` listed as a dynamic route.

- [ ] **Step 3: Manual end-to-end verification**

```bash
# After Pass 1 returned a searchId + regionId (and the area was indexed AFTER Task 3,
# so images exist on disk), and the inference service is running with /verify:
curl -s -X POST http://localhost:3000/api/search/<searchId>/refine \
  -H "content-type: application/json" -d '{"regionId":"<regionId>"}' | jq
```
Expected: JSON `RefineResponse` — `candidates` sorted by `verificationScore` desc with `rank`s, and the top one `status: "confirmed"` if it beat the threshold. `search_candidates` rows show populated `verification_score` and updated `status`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/api/search/[searchId]/refine/route.ts"
git commit -m "feat(web): POST /api/search/:searchId/refine — Pass 2 verification (spec §9.3, §9.4)"
```

---

## Self-Review

- **Spec coverage (§9.3):** expand within region via `ST_DWithin` ✔ (Task 10), geometric verification on the expanded set ✔ (Tasks 6/7-inference/12), re-rank by verification score ✔ (Task 11), auto-confirm top over threshold ✔ (Task 11), threshold configurable ✔ (Task 7). §15.2 Laila: multi-res tiles ✔ (Task 5), MAGSAC++ ✔ (Task 6), calibrated score ✔ (Task 6, honesty note included). §9.4 `/verify` + `POST /api/search/:id/refine` ✔ (Tasks 7-inference/13). Images available for verification ✔ (Tasks 1–3).
- **Placeholder scan:** no TBD/TODO; every code step has full code. The two design refinements (search-id ownership is a Pass 1 concern; `similarityScore` preservation in Task 12) are called out explicitly with the exact edit, not left vague.
- **Type consistency:** `RegionCandidate` (Task 10) → `runRefine` (Task 12); `VerifyResult` (Task 8) → Task 12; `ScoredCandidate`/`PersistRefineArgs` (Task 11) → Task 12; `SearchCandidate`/`RefineResponse`/`RefineRequest`/`DEFAULT_CONFIRM_THRESHOLD` (Task 7) → Tasks 11/12/13. `IndexedImageInsert.imagePath` (Task 3) matches the `image_path` column (Task 1) and `insertIndexedImages` (Task 3). The inference `match_points` adapter method is the single documented seam for real RoMa.
- **Known manual step, now completed:** implementing `match_points` on the real frozen RoMa handle (Task 7-inference Step 5) is weights-dependent and can't be unit-tested; it is isolated behind `_roma_matcher_adapter`/`loader.RomaMatcher` (Task 4) and was verified manually against real weights on GPU — see Task 4's note (`torch.hub` doesn't work for RoMa anymore, use `romatch` from PyPI) and Task 7-inference Step 5 (the real inlier/score numbers that calibrated Task 6's `score_inlier_saturation`).
- **GPU requirement discovered during verification:** Pass 2's `/verify` is impractical on CPU (a single real request exceeded 3 minutes and was killed) — RoMa's dense multi-tile matching needs a CUDA GPU to be usable; document this as a hard requirement for Pass 2 specifically, unlike Pass 1's MegaLoc embedding (CPU-friendly).
- **Pre-plan areas:** documented as needing reindex; refine skips their candidates visibly (Task 12) rather than crashing.

---

## Execution Handoff

**Plan complete and saved to `docs/2026-07-09-search-pass2-refine.md`.**

Execute Pass 1 (`docs/2026-07-09-search-pass1-retrieval.md`) first — this plan depends on its `searches.query_image_path`, `SearchCandidate` types, and `search_candidates` rows.

**Two execution options (for each plan):**
1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

**Which approach — and shall I start with Pass 1?**
