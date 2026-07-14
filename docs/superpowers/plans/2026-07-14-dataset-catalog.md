# "Publish weights" Dataset Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user publish an indexed area to their own GitHub repo (encrypted), browse datasets other Lumi users have published, and install one locally — with every release tagged to the retrieval model+version that produced its embeddings, so a model mismatch is caught and handled explicitly instead of silently corrupting local search.

**Architecture:** Reuses the existing area export/import zip pipeline, extended with a `model` tag (`{id, version, embeddingDim}`) sourced from the already-implemented model registry. Publishing uploads the bundle + a small metadata blob as GitHub Release assets (one release per model+version, tag `{modelId}-v{version}`), both AES-256-GCM-encrypted with one key built into the app itself. Discovery lists every release in every `lumi-dataset`-topic-tagged repo. Installing a release whose model doesn't match the locally active one still imports the images/points (embeddings left `NULL`, reusing the existing "partially indexed" DB state) and automatically enqueues a new, narrower worker job that fills in the embeddings from the already-downloaded images — no re-download, no Street View cost.

**Tech Stack:** Next.js API routes (Node runtime) calling the GitHub REST API directly via `fetch` (no new SDK dependency), `jszip` (already a dependency), Node's built-in `crypto` (AES-256-GCM, already used for settings encryption), `pg-boss` (already used for the existing index-area job), Vitest, Python (registry.py + pytest).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-13-dataset-catalog-design.md` (2026-07-14 revision) — read it before starting; every task below implements one of its sections.
- All new user-facing copy is in Spanish, matching the rest of the app.
- **Settings UI placement — adapts the spec's literal "popup" wording to this codebase's actual established convention:** the spec says "Settings → 'Datasets publicados' button → popup", but this codebase's real convention for a big self-contained management UI living inside Settings is a full **tab** (see `AreasManagePanel`, wired in `apps/web/app/components/SettingsPanel.tsx` as `activeTab === "areas" ? <AreasManagePanel /> : ...`) — not a button that opens a floating modal. Task 17/18 follow that existing pattern (a new "datasets" tab) rather than building a new modal component from scratch. This is an implementation-detail alignment with existing conventions, not a scope change — the approved mockup's Explorar/Publicar layout is unchanged, it just renders as a tab body instead of inside a popup shell.
- The dataset-catalog encryption key (`apps/web/lib/datasets/shared-key.ts`) is intentionally **not** derived from each install's own `SETTINGS_ENCRYPTION_KEY` — it must be the *same* key on every Lumi install so any instance can decrypt any other instance's published bundle (spec's "Key model" section: obfuscation from non-Lumi observers, not a security boundary — anyone reading the open-source app can extract it).
- Asset naming convention (introduced by this plan, used consistently by publish/discovery/install): a release's small metadata blob is uploaded as `metadata.json.enc`; the full encrypted bundle is uploaded as `bundle.zip.enc`.
- Release tag convention: `{modelId}-v{version}` (e.g. `lumi-preview-v1.0`). Publishing the same area under the same tag again overwrites that release (delete + recreate, same tag); a different model or version creates an additional release in the same repo.
- Follow existing file conventions exactly: `pg` `Pool` access via each app's own `getPool()`; worker jobs take a dependency-injection object (see `apps/worker/src/jobs/index-area.ts`) so they're testable without a real DB/inference service; API route tests import the route's exported `GET`/`POST` and call it directly with a real `Request`, mocking imported lib modules via `vi.mock` (see `apps/web/app/api/health/route.test.ts`); DB-touching pure functions in `apps/worker/src` are tested against the real test DB (`TEST_DATABASE_URL`, default `postgres://netryx:changeme@localhost:5432/netryx_test`), matching `apps/worker/src/heartbeat.test.ts`.
- No new runtime dependency for GitHub API access — plain `fetch` against `https://api.github.com`, consistent with this codebase never having added an SDK for anything it can reach with `fetch` (see `apps/worker/src/inference-client.ts`).

---

### Task 1: Model registry `version` field

**Files:**
- Modify: `services/inference/models/registry.py`
- Modify: `packages/shared-types/src/models.ts`
- Create: `services/inference/test_registry.py`
- Modify: `packages/shared-types/src/models.test.ts`

**Interfaces:**
- Produces: `RETRIEVAL_MODELS[].version: string` (Python dict key `"version"` and TS `RetrievalModelDefinition.version`) — Task 9's `getActiveModelTag()` and every later task that reads a model's identity rely on this field existing.

- [ ] **Step 1: Write the failing Python test**

```python
# services/inference/test_registry.py
from models.registry import RETRIEVAL_MODELS


def test_every_retrieval_model_has_a_version():
    for model in RETRIEVAL_MODELS:
        assert isinstance(model.get("version"), str)
        assert model["version"] != ""
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd services/inference && venv/bin/python -m pytest test_registry.py -v`
Expected: FAIL — `KeyError` or `AssertionError` (no `"version"` key yet).

- [ ] **Step 3: Add `version` to the Python registry**

In `services/inference/models/registry.py`, change the `RETRIEVAL_MODELS` entry from:

```python
RETRIEVAL_MODELS = [
    {
        "id": "lumi-preview",
        "display_name": "Lumi Preview",
        "base_model": "MegaLoc (frozen)",
        "status": "preview",
        "embedding_dim": 8448,
    },
    # future retrieval models are added here, without touching the rest of the code
]
```

to:

```python
RETRIEVAL_MODELS = [
    {
        "id": "lumi-preview",
        "display_name": "Lumi Preview",
        "base_model": "MegaLoc (frozen)",
        "status": "preview",
        "embedding_dim": 8448,
        "version": "1.0",
    },
    # future retrieval models are added here, without touching the rest of the code
]
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd services/inference && venv/bin/python -m pytest test_registry.py -v`
Expected: PASS (1 test).

- [ ] **Step 5: Write the failing TS test**

Add to `packages/shared-types/src/models.test.ts` (append a new `describe` block):

```ts
describe("RETRIEVAL_MODELS version field", () => {
  it("gives every retrieval model a non-empty version string", () => {
    for (const model of RETRIEVAL_MODELS) {
      expect(typeof model.version).toBe("string");
      expect(model.version.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @netryx/shared-types test models`
Expected: FAIL — TypeScript error, `version` doesn't exist on `RetrievalModelDefinition`.

- [ ] **Step 7: Add `version` to the TS mirror**

In `packages/shared-types/src/models.ts`, change:

```ts
export interface RetrievalModelDefinition {
  id: string;
  displayName: string;
  baseModel: string;
  status: "preview" | "stable" | "deprecated";
  embeddingDim: number;
}
```

to:

```ts
export interface RetrievalModelDefinition {
  id: string;
  displayName: string;
  baseModel: string;
  status: "preview" | "stable" | "deprecated";
  embeddingDim: number;
  version: string;
}
```

and change the `RETRIEVAL_MODELS` array entry from:

```ts
export const RETRIEVAL_MODELS: RetrievalModelDefinition[] = [
  {
    id: "lumi-preview",
    displayName: "Lumi Preview",
    baseModel: "MegaLoc (frozen)",
    status: "preview",
    embeddingDim: 8448,
  },
];
```

to:

```ts
export const RETRIEVAL_MODELS: RetrievalModelDefinition[] = [
  {
    id: "lumi-preview",
    displayName: "Lumi Preview",
    baseModel: "MegaLoc (frozen)",
    status: "preview",
    embeddingDim: 8448,
    version: "1.0",
  },
];
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm --filter @netryx/shared-types test models`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/inference/models/registry.py services/inference/test_registry.py packages/shared-types/src/models.ts packages/shared-types/src/models.test.ts
git commit -m "feat(models): add version field to the retrieval model registry"
```

---

### Task 2: `GITHUB_TOKEN` setting

**Files:**
- Modify: `packages/shared-types/src/settings.ts`
- Modify: `packages/shared-types/src/settings.test.ts`

**Interfaces:**
- Produces: `SETTINGS_SCHEMA` entry with `key: "GITHUB_TOKEN"` — Task 14/16's routes read it via `getSettingsRepo().getSetting("GITHUB_TOKEN")`.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared-types/src/settings.test.ts`:

```ts
describe("GITHUB_TOKEN setting", () => {
  it("is an optional secret string, for publishing/installing datasets", () => {
    const def = SETTINGS_SCHEMA.find((s) => s.key === "GITHUB_TOKEN")!;
    expect(def).toBeDefined();
    expect(def.type).toBe("string");
    expect(def.isSecret).toBe(true);
    expect(def.required).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @netryx/shared-types test settings`
Expected: FAIL — `def` is `undefined`.

- [ ] **Step 3: Add the setting**

In `packages/shared-types/src/settings.ts`, add this entry to `SETTINGS_SCHEMA` (right after the `MAPBOX_TOKEN` entry):

```ts
  {
    key: "GITHUB_TOKEN",
    label: "GitHub Personal Access Token (para publicar/instalar datasets)",
    type: "string",
    isSecret: true,
    required: false,
  },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @netryx/shared-types test settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/settings.ts packages/shared-types/src/settings.test.ts
git commit -m "feat(settings): add optional GITHUB_TOKEN setting for the dataset catalog"
```

---

### Task 3: Buffer-accepting `encrypt`/`decrypt` variants

**Files:**
- Modify: `packages/settings-repo/src/crypto.ts`
- Modify: `packages/settings-repo/src/crypto.test.ts`

**Interfaces:**
- Consumes: nothing new (same `node:crypto` primitives already used).
- Produces: `encryptBuffer(plaintext: Buffer, key: Buffer): Buffer`, `decryptBuffer(payload: Buffer, key: Buffer): Buffer` — Task 9's `export-bundle.ts`/`shared-key.ts` consumers and Tasks 15/16's routes encrypt/decrypt the zip bundle and metadata blob (raw bytes, not UTF-8 text) with these.

- [ ] **Step 1: Write the failing tests**

Add to `packages/settings-repo/src/crypto.test.ts`:

```ts
import { encryptBuffer, decryptBuffer } from "./crypto";

describe("encryptBuffer/decryptBuffer", () => {
  it("round-trips arbitrary binary data without UTF-8 lossy conversion", () => {
    const key = randomBytes(32);
    // Bytes that are NOT valid UTF-8 on their own (a lone continuation byte) —
    // proves this path never round-trips through a string.
    const original = Buffer.from([0x00, 0x01, 0xff, 0x80, 0x81, 0xfe]);

    const encrypted = encryptBuffer(original, key);
    const decrypted = decryptBuffer(encrypted, key);

    expect(decrypted.equals(original)).toBe(true);
  });

  it("fails to decrypt with the wrong key", () => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const encrypted = encryptBuffer(Buffer.from("hello"), key);

    expect(() => decryptBuffer(encrypted, wrongKey)).toThrow();
  });
});
```

(If `randomBytes` isn't already imported at the top of `crypto.test.ts`, add `import { randomBytes } from "node:crypto";`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/settings-repo test crypto`
Expected: FAIL — `encryptBuffer`/`decryptBuffer` don't exist.

- [ ] **Step 3: Refactor `crypto.ts` to share a raw-Buffer core**

Replace the full contents of `packages/settings-repo/src/crypto.ts`'s `encrypt`/`decrypt` functions (keep `loadOrCreateEncryptionKey` untouched) with:

```ts
function encryptRaw(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

function decryptRaw(payload: Buffer, key: Buffer): Buffer {
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = payload.subarray(IV_LENGTH + 16);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypts `plaintext` and returns `iv || authTag || ciphertext` as a single
 * Buffer, ready to store in `system_settings.encrypted_value` (bytea).
 */
export function encrypt(plaintext: string, key: Buffer): Buffer {
  return encryptRaw(Buffer.from(plaintext, "utf8"), key);
}

export function decrypt(payload: Buffer, key: Buffer): string {
  return decryptRaw(payload, key).toString("utf8");
}

/** Same scheme as encrypt()/decrypt(), but for raw binary payloads (zip
 * bundles, image bytes) that must never round-trip through a UTF-8 string —
 * used by the dataset catalog (docs/superpowers/specs/2026-07-13-dataset-
 * catalog-design.md). */
export function encryptBuffer(plaintext: Buffer, key: Buffer): Buffer {
  return encryptRaw(plaintext, key);
}

export function decryptBuffer(payload: Buffer, key: Buffer): Buffer {
  return decryptRaw(payload, key);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/settings-repo test crypto`
Expected: PASS (all tests, including the pre-existing `encrypt`/`decrypt` ones — unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add packages/settings-repo/src/crypto.ts packages/settings-repo/src/crypto.test.ts
git commit -m "feat(crypto): add Buffer-accepting encrypt/decrypt variants for binary payloads"
```

---

### Task 4: Fix `captureImagePath` path traversal (web)

**Files:**
- Modify: `apps/web/lib/street-view-image-dir.ts`
- Create: `apps/web/lib/street-view-image-dir.test.ts`

**Interfaces:**
- Produces: `captureImagePath(panoId: string, heading: number): string` now throws on an invalid `panoId` instead of silently resolving a traversal path — Task 16's install route relies on this throwing for a malicious manifest.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/street-view-image-dir.test.ts
import { describe, it, expect } from "vitest";
import { captureImagePath } from "./street-view-image-dir";

describe("captureImagePath", () => {
  it("builds a path for a normal panoId", () => {
    const path = captureImagePath("CAoSLEFGMVFpcE1fbG1v", 90);
    expect(path.endsWith("CAoSLEFGMVFpcE1fbG1v_90.jpg")).toBe(true);
  });

  it("rejects a panoId with path traversal sequences", () => {
    expect(() => captureImagePath("../../etc/passwd", 0)).toThrow();
  });

  it("rejects a panoId with a path separator", () => {
    expect(() => captureImagePath("foo/bar", 0)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test street-view-image-dir`
Expected: FAIL — the traversal/separator cases don't throw yet.

- [ ] **Step 3: Add the allowlist check**

Replace `apps/web/lib/street-view-image-dir.ts`'s `captureImagePath` function:

```ts
export function captureImagePath(panoId: string, heading: number): string {
  return resolve(streetViewImageDir(), `${panoId}_${heading}.jpg`);
}
```

with:

```ts
const SAFE_PANO_ID = /^[A-Za-z0-9_-]+$/;

export function captureImagePath(panoId: string, heading: number): string {
  if (!SAFE_PANO_ID.test(panoId)) {
    throw new Error(`Invalid panoId (must match ${SAFE_PANO_ID}): ${JSON.stringify(panoId)}`);
  }
  return resolve(streetViewImageDir(), `${panoId}_${heading}.jpg`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test street-view-image-dir`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/street-view-image-dir.ts apps/web/lib/street-view-image-dir.test.ts
git commit -m "fix(web): reject path-traversal panoIds in captureImagePath"
```

---

### Task 5: Dataset manifest types + validator

**Files:**
- Create: `apps/web/lib/datasets/manifest.ts`
- Create: `apps/web/lib/datasets/manifest.test.ts`

**Interfaces:**
- Produces: `ModelTag`, `DatasetManifestImage`, `DatasetManifestPoint`, `DatasetManifestArea`, `DatasetManifest`, `DatasetMetadata`, `BUNDLE_ASSET_NAME`, `METADATA_ASSET_NAME`, `buildDatasetMetadata(title, description, model, stats): DatasetMetadata`, `validateDatasetManifest(data: unknown, knownModelIds: ReadonlySet<string>): DatasetManifest` — Tasks 6, 9, 14, 15, 16 all import from this file.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/datasets/manifest.test.ts
import { describe, it, expect } from "vitest";
import { validateDatasetManifest, buildDatasetMetadata } from "./manifest";

const KNOWN_MODEL_IDS = new Set(["lumi-preview"]);

function validManifest() {
  return {
    version: 1,
    exportedAt: "2026-07-14T00:00:00.000Z",
    model: { id: "lumi-preview", version: "1.0", embeddingDim: 3 },
    areas: [
      {
        name: "Test area",
        geometryWkt: "POLYGON((0 0,0 1,1 1,1 0,0 0))",
        areaKm2: 1,
        status: "indexed",
        pointsEstimated: 1,
        pointsCaptured: 1,
        pointsFailed: 0,
        imagesEmbedded: 1,
        estimatedCostUsd: null,
        actualCostUsd: null,
        images: [
          {
            panoId: "abc123", heading: 0, lat: 0, lng: 0,
            streetViewDate: null, embedding: [0.1, 0.2, 0.3], hasFile: true,
          },
        ],
        points: [
          { panoId: "abc123", lat: 0, lng: 0, embedding: [0.1, 0.2, 0.3] },
        ],
      },
    ],
  };
}

describe("validateDatasetManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validateDatasetManifest(validManifest(), KNOWN_MODEL_IDS);
    expect(result.model).toEqual({ id: "lumi-preview", version: "1.0", embeddingDim: 3 });
    expect(result.areas).toHaveLength(1);
    expect(result.areas[0].images[0].panoId).toBe("abc123");
  });

  it("rejects an unknown model.id", () => {
    const manifest = validManifest();
    manifest.model.id = "some-other-model";
    expect(() => validateDatasetManifest(manifest, KNOWN_MODEL_IDS)).toThrow(/not a known model/);
  });

  it("rejects an image embedding whose length doesn't match model.embeddingDim", () => {
    const manifest = validManifest();
    manifest.areas[0].images[0].embedding = [0.1, 0.2]; // length 2, declared dim is 3
    expect(() => validateDatasetManifest(manifest, KNOWN_MODEL_IDS)).toThrow(/embedding has length/);
  });

  it("rejects a point embedding whose length doesn't match model.embeddingDim", () => {
    const manifest = validManifest();
    manifest.areas[0].points[0].embedding = [0.1];
    expect(() => validateDatasetManifest(manifest, KNOWN_MODEL_IDS)).toThrow(/embedding has length/);
  });

  it("rejects a panoId that isn't in the safe allowlist", () => {
    const manifest = validManifest();
    manifest.areas[0].images[0].panoId = "../../etc/passwd";
    expect(() => validateDatasetManifest(manifest, KNOWN_MODEL_IDS)).toThrow(/panoId/);
  });

  it("rejects a non-object top level", () => {
    expect(() => validateDatasetManifest(null, KNOWN_MODEL_IDS)).toThrow();
    expect(() => validateDatasetManifest("nope", KNOWN_MODEL_IDS)).toThrow();
  });

  it("rejects areas that isn't an array", () => {
    const manifest = validManifest() as unknown as Record<string, unknown>;
    manifest.areas = "not-an-array";
    expect(() => validateDatasetManifest(manifest, KNOWN_MODEL_IDS)).toThrow(/areas must be an array/);
  });
});

describe("buildDatasetMetadata", () => {
  it("assembles a metadata object from its parts", () => {
    const model = { id: "lumi-preview", version: "1.0", embeddingDim: 8448 };
    const meta = buildDatasetMetadata("Title", "Desc", model, { pointsCaptured: 10, imagesEmbedded: 40 });
    expect(meta).toEqual({
      title: "Title", description: "Desc", model,
      stats: { pointsCaptured: 10, imagesEmbedded: 40 },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/datasets/manifest`
Expected: FAIL — `Cannot find module './manifest'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/datasets/manifest.ts

/** Naming convention for release assets — used consistently by publish
 * (Task 14), discovery (Task 15) and install (Task 16). */
export const BUNDLE_ASSET_NAME = "bundle.zip.enc";
export const METADATA_ASSET_NAME = "metadata.json.enc";

const SAFE_PANO_ID = /^[A-Za-z0-9_-]+$/;

export interface ModelTag {
  id: string;
  version: string;
  embeddingDim: number;
}

export interface DatasetManifestImage {
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  streetViewDate: string | null;
  embedding: number[] | null;
  hasFile: boolean;
}

export interface DatasetManifestPoint {
  panoId: string;
  lat: number;
  lng: number;
  embedding: number[] | null;
}

export interface DatasetManifestArea {
  name: string | null;
  geometryWkt: string;
  areaKm2: number;
  status: string;
  pointsEstimated: number;
  pointsCaptured: number;
  pointsFailed: number;
  imagesEmbedded: number;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  images: DatasetManifestImage[];
  points: DatasetManifestPoint[];
}

export interface DatasetManifest {
  version: number;
  exportedAt: string;
  model: ModelTag;
  areas: DatasetManifestArea[];
}

export interface DatasetMetadata {
  title: string;
  description: string;
  model: ModelTag;
  stats: { pointsCaptured: number; imagesEmbedded: number };
}

export function buildDatasetMetadata(
  title: string,
  description: string,
  model: ModelTag,
  stats: { pointsCaptured: number; imagesEmbedded: number }
): DatasetMetadata {
  return { title, description, model, stats };
}

function validateImage(
  imgData: unknown,
  areaIndex: number,
  imgIndex: number,
  embeddingDim: number
): DatasetManifestImage {
  if (typeof imgData !== "object" || imgData === null) {
    throw new Error(`manifest.areas[${areaIndex}].images[${imgIndex}] must be an object`);
  }
  const img = imgData as Record<string, unknown>;
  if (typeof img.panoId !== "string" || !SAFE_PANO_ID.test(img.panoId)) {
    throw new Error(`manifest.areas[${areaIndex}].images[${imgIndex}].panoId is missing or invalid`);
  }
  if (typeof img.heading !== "number") {
    throw new Error(`manifest.areas[${areaIndex}].images[${imgIndex}].heading must be a number`);
  }
  if (img.embedding !== null && !Array.isArray(img.embedding)) {
    throw new Error(`manifest.areas[${areaIndex}].images[${imgIndex}].embedding must be an array or null`);
  }
  if (Array.isArray(img.embedding) && img.embedding.length !== embeddingDim) {
    throw new Error(
      `manifest.areas[${areaIndex}].images[${imgIndex}].embedding has length ${img.embedding.length}, expected ${embeddingDim}`
    );
  }
  return {
    panoId: img.panoId,
    heading: img.heading,
    lat: Number(img.lat),
    lng: Number(img.lng),
    streetViewDate: (img.streetViewDate as string | null) ?? null,
    embedding: (img.embedding as number[] | null) ?? null,
    hasFile: Boolean(img.hasFile),
  };
}

function validatePoint(
  ptData: unknown,
  areaIndex: number,
  ptIndex: number,
  embeddingDim: number
): DatasetManifestPoint {
  if (typeof ptData !== "object" || ptData === null) {
    throw new Error(`manifest.areas[${areaIndex}].points[${ptIndex}] must be an object`);
  }
  const pt = ptData as Record<string, unknown>;
  if (typeof pt.panoId !== "string" || !SAFE_PANO_ID.test(pt.panoId)) {
    throw new Error(`manifest.areas[${areaIndex}].points[${ptIndex}].panoId is missing or invalid`);
  }
  if (pt.embedding !== null && !Array.isArray(pt.embedding)) {
    throw new Error(`manifest.areas[${areaIndex}].points[${ptIndex}].embedding must be an array or null`);
  }
  if (Array.isArray(pt.embedding) && pt.embedding.length !== embeddingDim) {
    throw new Error(
      `manifest.areas[${areaIndex}].points[${ptIndex}].embedding has length ${pt.embedding.length}, expected ${embeddingDim}`
    );
  }
  return {
    panoId: pt.panoId,
    lat: Number(pt.lat),
    lng: Number(pt.lng),
    embedding: (pt.embedding as number[] | null) ?? null,
  };
}

function validateArea(areaData: unknown, areaIndex: number, embeddingDim: number): DatasetManifestArea {
  if (typeof areaData !== "object" || areaData === null) {
    throw new Error(`manifest.areas[${areaIndex}] must be an object`);
  }
  const area = areaData as Record<string, unknown>;
  if (typeof area.geometryWkt !== "string") {
    throw new Error(`manifest.areas[${areaIndex}].geometryWkt must be a string`);
  }
  if (!Array.isArray(area.images)) {
    throw new Error(`manifest.areas[${areaIndex}].images must be an array`);
  }
  if (!Array.isArray(area.points)) {
    throw new Error(`manifest.areas[${areaIndex}].points must be an array`);
  }

  return {
    name: (area.name as string | null) ?? null,
    geometryWkt: area.geometryWkt,
    areaKm2: Number(area.areaKm2),
    status: String(area.status ?? "indexed"),
    pointsEstimated: Number(area.pointsEstimated ?? 0),
    pointsCaptured: Number(area.pointsCaptured ?? 0),
    pointsFailed: Number(area.pointsFailed ?? 0),
    imagesEmbedded: Number(area.imagesEmbedded ?? 0),
    estimatedCostUsd: area.estimatedCostUsd === undefined || area.estimatedCostUsd === null ? null : Number(area.estimatedCostUsd),
    actualCostUsd: area.actualCostUsd === undefined || area.actualCostUsd === null ? null : Number(area.actualCostUsd),
    images: area.images.map((img, i) => validateImage(img, areaIndex, i, embeddingDim)),
    points: area.points.map((pt, i) => validatePoint(pt, areaIndex, i, embeddingDim)),
  };
}

/**
 * Strictly validates a decrypted dataset bundle's manifest.json (spec's
 * Security section — replaces the original export/import routes' loose
 * `as ManifestArea[]` cast). Throws a descriptive Error on any violation;
 * never returns a partially-valid result.
 */
export function validateDatasetManifest(data: unknown, knownModelIds: ReadonlySet<string>): DatasetManifest {
  if (typeof data !== "object" || data === null) {
    throw new Error("manifest must be an object");
  }
  const raw = data as Record<string, unknown>;

  if (typeof raw.version !== "number") throw new Error("manifest.version must be a number");
  if (typeof raw.exportedAt !== "string") throw new Error("manifest.exportedAt must be a string");

  if (typeof raw.model !== "object" || raw.model === null) {
    throw new Error("manifest.model must be an object");
  }
  const model = raw.model as Record<string, unknown>;
  if (typeof model.id !== "string" || !knownModelIds.has(model.id)) {
    throw new Error(`manifest.model.id ${JSON.stringify(model.id)} is not a known model`);
  }
  if (typeof model.version !== "string" || model.version.length === 0) {
    throw new Error("manifest.model.version must be a non-empty string");
  }
  if (typeof model.embeddingDim !== "number" || !Number.isInteger(model.embeddingDim) || model.embeddingDim <= 0) {
    throw new Error("manifest.model.embeddingDim must be a positive integer");
  }
  const modelTag: ModelTag = { id: model.id, version: model.version, embeddingDim: model.embeddingDim };

  if (!Array.isArray(raw.areas)) throw new Error("manifest.areas must be an array");

  return {
    version: raw.version,
    exportedAt: raw.exportedAt,
    model: modelTag,
    areas: raw.areas.map((area, i) => validateArea(area, i, modelTag.embeddingDim)),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/datasets/manifest`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/datasets/manifest.ts apps/web/lib/datasets/manifest.test.ts
git commit -m "feat(web): add dataset manifest types and a strict validator"
```

---

### Task 6: Model compatibility check

**Files:**
- Create: `apps/web/lib/datasets/compatibility.ts`
- Create: `apps/web/lib/datasets/compatibility.test.ts`

**Interfaces:**
- Consumes: `ModelTag` from `./manifest` (Task 5).
- Produces: `isCompatible(datasetModel: ModelTag, activeModel: ModelTag): boolean` — Task 16's install route and Task 17's UI both call this.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/datasets/compatibility.test.ts
import { describe, it, expect } from "vitest";
import { isCompatible } from "./compatibility";
import type { ModelTag } from "./manifest";

describe("isCompatible", () => {
  it("is true when id and version both match exactly", () => {
    const a: ModelTag = { id: "lumi-preview", version: "1.0", embeddingDim: 8448 };
    const b: ModelTag = { id: "lumi-preview", version: "1.0", embeddingDim: 8448 };
    expect(isCompatible(a, b)).toBe(true);
  });

  it("is false when versions differ, even with the same id", () => {
    const a: ModelTag = { id: "lumi-preview", version: "1.0", embeddingDim: 8448 };
    const b: ModelTag = { id: "lumi-preview", version: "2.0", embeddingDim: 8448 };
    expect(isCompatible(a, b)).toBe(false);
  });

  it("is false when ids differ, even if embeddingDim happens to match", () => {
    const a: ModelTag = { id: "lumi-preview", version: "1.0", embeddingDim: 8448 };
    const b: ModelTag = { id: "some-future-model", version: "1.0", embeddingDim: 8448 };
    expect(isCompatible(a, b)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/datasets/compatibility`
Expected: FAIL — `Cannot find module './compatibility'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/datasets/compatibility.ts
import type { ModelTag } from "./manifest";

/**
 * A dataset release is only safe to import with its embeddings intact when
 * BOTH the model id and its version match exactly — embeddingDim is never
 * compared on its own, because two unrelated models can share a dimension
 * while producing totally incompatible embedding spaces (spec's Security
 * section).
 */
export function isCompatible(datasetModel: ModelTag, activeModel: ModelTag): boolean {
  return datasetModel.id === activeModel.id && datasetModel.version === activeModel.version;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/datasets/compatibility`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/datasets/compatibility.ts apps/web/lib/datasets/compatibility.test.ts
git commit -m "feat(web): add dataset model-compatibility check"
```

---

### Task 7: Bundle validation helpers (size caps + image sniffing)

**Files:**
- Create: `apps/web/lib/datasets/validate-bundle.ts`
- Create: `apps/web/lib/datasets/validate-bundle.test.ts`

**Interfaces:**
- Produces: `MAX_BUNDLE_COMPRESSED_BYTES`, `MAX_BUNDLE_DECOMPRESSED_BYTES`, `MAX_BUNDLE_FILE_COUNT`, `assertCompressedSizeWithinLimit(byteLength: number): void`, `assertFileCountWithinLimit(fileCount: number): void`, `assertDecompressedSizeWithinLimit(runningTotalBytes: number): void`, `isLikelyJpeg(bytes: Buffer): boolean` — Task 16's install route calls all four while staging a bundle.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/datasets/validate-bundle.test.ts
import { describe, it, expect } from "vitest";
import {
  assertCompressedSizeWithinLimit,
  assertFileCountWithinLimit,
  assertDecompressedSizeWithinLimit,
  isLikelyJpeg,
  MAX_BUNDLE_COMPRESSED_BYTES,
  MAX_BUNDLE_DECOMPRESSED_BYTES,
  MAX_BUNDLE_FILE_COUNT,
} from "./validate-bundle";

describe("assertCompressedSizeWithinLimit", () => {
  it("passes under the limit and throws over it", () => {
    expect(() => assertCompressedSizeWithinLimit(1024)).not.toThrow();
    expect(() => assertCompressedSizeWithinLimit(MAX_BUNDLE_COMPRESSED_BYTES + 1)).toThrow(/too large/);
  });
});

describe("assertFileCountWithinLimit", () => {
  it("passes under the limit and throws over it", () => {
    expect(() => assertFileCountWithinLimit(10)).not.toThrow();
    expect(() => assertFileCountWithinLimit(MAX_BUNDLE_FILE_COUNT + 1)).toThrow(/too many files/);
  });
});

describe("assertDecompressedSizeWithinLimit", () => {
  it("passes under the limit and throws over it", () => {
    expect(() => assertDecompressedSizeWithinLimit(1024)).not.toThrow();
    expect(() => assertDecompressedSizeWithinLimit(MAX_BUNDLE_DECOMPRESSED_BYTES + 1)).toThrow(/decompressed limit/);
  });
});

describe("isLikelyJpeg", () => {
  it("is true for bytes starting with the JPEG magic number", () => {
    expect(isLikelyJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe(true);
  });

  it("is false for non-JPEG bytes, including a disguised .jpg extension", () => {
    expect(isLikelyJpeg(Buffer.from("<html><body>not a jpeg</body></html>"))).toBe(false);
    expect(isLikelyJpeg(Buffer.from([]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/datasets/validate-bundle`
Expected: FAIL — `Cannot find module './validate-bundle'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/datasets/validate-bundle.ts

export const MAX_BUNDLE_COMPRESSED_BYTES = 200 * 1024 * 1024; // 200MB
export const MAX_BUNDLE_DECOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1GB
export const MAX_BUNDLE_FILE_COUNT = 20000;

export function assertCompressedSizeWithinLimit(byteLength: number): void {
  if (byteLength > MAX_BUNDLE_COMPRESSED_BYTES) {
    throw new Error(`Bundle too large: ${byteLength} bytes exceeds the ${MAX_BUNDLE_COMPRESSED_BYTES}-byte compressed limit`);
  }
}

export function assertFileCountWithinLimit(fileCount: number): void {
  if (fileCount > MAX_BUNDLE_FILE_COUNT) {
    throw new Error(`Bundle has too many files: ${fileCount} exceeds the ${MAX_BUNDLE_FILE_COUNT} limit`);
  }
}

export function assertDecompressedSizeWithinLimit(runningTotalBytes: number): void {
  if (runningTotalBytes > MAX_BUNDLE_DECOMPRESSED_BYTES) {
    throw new Error(`Bundle exceeds the ${MAX_BUNDLE_DECOMPRESSED_BYTES}-byte decompressed limit`);
  }
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** Sniffs the actual file content instead of trusting a ".jpg" extension —
 * every capture image in this app is a JPEG (spec's Security section). */
export function isLikelyJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes.subarray(0, 3).equals(JPEG_MAGIC);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/datasets/validate-bundle`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/datasets/validate-bundle.ts apps/web/lib/datasets/validate-bundle.test.ts
git commit -m "feat(web): add bundle size-cap and image-sniffing validators"
```

---

### Task 8: GitHub REST client

**Files:**
- Create: `apps/web/lib/datasets/github.ts`
- Create: `apps/web/lib/datasets/github.test.ts`

**Interfaces:**
- Produces: `GithubReleaseAsset`, `GithubRelease`, `ensureRepoWithTopic(owner, repo, token): Promise<void>`, `upsertRelease(owner, repo, tag, title, assets, token): Promise<void>`, `listReleasesForRepo(owner, repo): Promise<GithubRelease[]>`, `searchRepositoriesByTopic(topic): Promise<{owner: string; repo: string}[]>`, `downloadReleaseAsset(assetApiUrl, token?): Promise<Buffer>` — Tasks 14, 15, 16 all import from this file.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/datasets/github.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ensureRepoWithTopic,
  upsertRelease,
  listReleasesForRepo,
  searchRepositoriesByTopic,
  downloadReleaseAsset,
} from "./github";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureRepoWithTopic", () => {
  it("creates the repo if it doesn't exist, then adds the topic without dropping existing ones", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string });
      if (url.endsWith("/repos/inigo/lumi-madrid")) return { status: 404, ok: false } as Response;
      if (url.endsWith("/user/repos")) return { ok: true, status: 201 } as Response;
      if (url.endsWith("/topics") && (!init || init.method === undefined)) {
        return { ok: true, json: async () => ({ names: ["existing-topic"] }) } as Response;
      }
      if (url.endsWith("/topics") && init?.method === "PUT") return { ok: true, status: 200 } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    }));

    await ensureRepoWithTopic("inigo", "lumi-madrid", "tok");

    const createCall = calls.find((c) => c.url.endsWith("/user/repos"));
    expect(createCall).toBeDefined();
    const topicsPut = calls.find((c) => c.url.endsWith("/topics") && c.method === "PUT");
    expect(JSON.parse(topicsPut!.body!).names).toEqual(["existing-topic", "lumi-dataset"]);
  });

  it("does nothing extra when the repo exists and already has the topic", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/repos/inigo/lumi-madrid")) return { ok: true, status: 200 } as Response;
      if (url.endsWith("/topics") && !init?.method) {
        return { ok: true, json: async () => ({ names: ["lumi-dataset"] }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    await expect(ensureRepoWithTopic("inigo", "lumi-madrid", "tok")).resolves.toBeUndefined();
  });
});

describe("upsertRelease", () => {
  it("deletes an existing release with the same tag before creating a fresh one, then uploads assets", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      if (url.includes("/releases/tags/lumi-preview-v1.0")) {
        return { ok: true, json: async () => ({ id: 999 }) } as Response;
      }
      if (url.includes("/releases/999") && init?.method === "DELETE") return { ok: true } as Response;
      if (url.endsWith("/releases") && init?.method === "POST") {
        return { ok: true, json: async () => ({ upload_url: "https://uploads.github.com/repos/inigo/lumi-madrid/releases/1000/assets{?name,label}" }) } as Response;
      }
      if (url.includes("uploads.github.com") && init?.method === "POST") return { ok: true } as Response;
      throw new Error(`unexpected fetch: ${url} ${init?.method}`);
    }));

    await upsertRelease(
      "inigo", "lumi-madrid", "lumi-preview-v1.0", "Lumi Preview v1.0",
      [{ name: "metadata.json.enc", data: Buffer.from("x") }], "tok"
    );

    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    expect(calls.some((c) => c.url.includes("uploads.github.com"))).toBe(true);
  });
});

describe("listReleasesForRepo", () => {
  it("maps GitHub's release shape to GithubRelease", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ([
        { tag_name: "lumi-preview-v1.0", name: "Lumi Preview v1.0", body: "", assets: [{ name: "bundle.zip.enc", url: "https://api.github.com/a/1" }] },
      ]),
    } as Response)));

    const releases = await listReleasesForRepo("inigo", "lumi-madrid");
    expect(releases).toEqual([
      { tagName: "lumi-preview-v1.0", name: "Lumi Preview v1.0", body: "", assets: [{ name: "bundle.zip.enc", url: "https://api.github.com/a/1" }] },
    ]);
  });
});

describe("searchRepositoriesByTopic", () => {
  it("maps search results to owner/repo pairs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [{ owner: { login: "inigo" }, name: "lumi-madrid" }] }),
    } as Response)));

    expect(await searchRepositoriesByTopic("lumi-dataset")).toEqual([{ owner: "inigo", repo: "lumi-madrid" }]);
  });
});

describe("downloadReleaseAsset", () => {
  it("returns the asset bytes as a Buffer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as Response)));

    const bytes = await downloadReleaseAsset("https://api.github.com/a/1", "tok");
    expect(bytes.equals(Buffer.from([1, 2, 3]))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/datasets/github`
Expected: FAIL — `Cannot find module './github'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/datasets/github.ts

const GITHUB_API = "https://api.github.com";

export interface GithubReleaseAsset {
  name: string;
  url: string;
}

export interface GithubRelease {
  tagName: string;
  name: string;
  body: string;
  assets: GithubReleaseAsset[];
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

/** Creates the repo (under the token's own account) if it doesn't exist
 * yet, then adds the `lumi-dataset` topic without clobbering any topics
 * already on the repo (GitHub's "replace topics" endpoint requires the
 * full list, so this reads first). */
export async function ensureRepoWithTopic(owner: string, repo: string, token: string): Promise<void> {
  const getRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: authHeaders(token) });
  if (getRes.status === 404) {
    const createRes = await fetch(`${GITHUB_API}/user/repos`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ name: repo, private: false }),
    });
    if (!createRes.ok) throw new Error(`Failed to create repo ${owner}/${repo}: ${createRes.status}`);
  } else if (!getRes.ok) {
    throw new Error(`Failed to check repo ${owner}/${repo}: ${getRes.status}`);
  }

  const topicsRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/topics`, { headers: authHeaders(token) });
  const current: string[] = topicsRes.ok ? ((await topicsRes.json()) as { names: string[] }).names ?? [] : [];
  if (!current.includes("lumi-dataset")) {
    await fetch(`${GITHUB_API}/repos/${owner}/${repo}/topics`, {
      method: "PUT",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ names: [...current, "lumi-dataset"] }),
    });
  }
}

/** Overwrites any existing release with the same tag (delete then
 * recreate) before creating it fresh and uploading its assets — matches
 * the spec's "same model+version republished overwrites that release"
 * rule. */
export async function upsertRelease(
  owner: string,
  repo: string,
  tag: string,
  title: string,
  assets: { name: string; data: Buffer }[],
  token: string
): Promise<void> {
  const existing = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/releases/tags/${tag}`, {
    headers: authHeaders(token),
  });
  if (existing.ok) {
    const { id } = (await existing.json()) as { id: number };
    await fetch(`${GITHUB_API}/repos/${owner}/${repo}/releases/${id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
  }

  const createRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/releases`, {
    method: "POST",
    headers: { ...authHeaders(token), "content-type": "application/json" },
    body: JSON.stringify({ tag_name: tag, name: title, draft: false, prerelease: false }),
  });
  if (!createRes.ok) throw new Error(`Failed to create release ${tag}: ${createRes.status}`);
  const release = (await createRes.json()) as { upload_url: string };
  const uploadBase = release.upload_url.replace(/\{.*\}$/, "");

  for (const asset of assets) {
    const uploadRes = await fetch(`${uploadBase}?name=${encodeURIComponent(asset.name)}`, {
      method: "POST",
      headers: { ...authHeaders(token), "content-type": "application/octet-stream" },
      body: asset.data,
    });
    if (!uploadRes.ok) throw new Error(`Failed to upload asset ${asset.name}: ${uploadRes.status}`);
  }
}

export async function listReleasesForRepo(owner: string, repo: string): Promise<GithubRelease[]> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/releases`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`Failed to list releases for ${owner}/${repo}: ${res.status}`);
  const body = (await res.json()) as Array<{
    tag_name: string;
    name: string;
    body: string | null;
    assets: Array<{ name: string; url: string }>;
  }>;
  return body.map((r) => ({
    tagName: r.tag_name,
    name: r.name,
    body: r.body ?? "",
    assets: r.assets.map((a) => ({ name: a.name, url: a.url })),
  }));
}

export async function searchRepositoriesByTopic(topic: string): Promise<{ owner: string; repo: string }[]> {
  const res = await fetch(`${GITHUB_API}/search/repositories?q=${encodeURIComponent(`topic:${topic}`)}`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub search failed: ${res.status}`);
  const body = (await res.json()) as { items: Array<{ owner: { login: string }; name: string }> };
  return body.items.map((item) => ({ owner: item.owner.login, repo: item.name }));
}

/** `assetApiUrl` is a release asset's own API `url` (from listReleasesForRepo),
 * which requires `Accept: application/octet-stream` to return raw bytes
 * instead of asset metadata JSON. `token` is optional — public repos'
 * release assets are downloadable unauthenticated, but passing a token
 * avoids the stricter unauthenticated rate limit. */
export async function downloadReleaseAsset(assetApiUrl: string, token?: string): Promise<Buffer> {
  const headers: Record<string, string> = { accept: "application/octet-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(assetApiUrl, { headers });
  if (!res.ok) throw new Error(`Failed to download asset: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/datasets/github`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/datasets/github.ts apps/web/lib/datasets/github.test.ts
git commit -m "feat(web): add a raw-fetch GitHub REST client for the dataset catalog"
```

---

### Task 9: Shared key + active-model helper + shared export-bundle builder

**Files:**
- Create: `apps/web/lib/datasets/shared-key.ts`
- Create: `apps/web/lib/datasets/active-model.ts`
- Create: `apps/web/lib/datasets/active-model.test.ts`
- Create: `apps/web/lib/datasets/export-bundle.ts`
- Create: `apps/web/lib/datasets/export-bundle.test.ts`
- Modify: `apps/web/app/api/areas/export/route.ts`

**Interfaces:**
- Consumes: `ModelTag` (Task 5), `RETRIEVAL_MODELS` (`@netryx/shared-types`, Task 1), `getSettingsRepo` (`../settings-repo`).
- Produces: `DATASET_SHARED_KEY: Buffer`, `getActiveModelTag(): Promise<ModelTag>`, `buildAreasZip(pool, areaIds, model): Promise<Uint8Array>` — Tasks 14 and 16 use all three; the existing export route now goes through `buildAreasZip` too instead of its own inline zip-building.

- [ ] **Step 1: Add the shared key**

```ts
// apps/web/lib/datasets/shared-key.ts

/**
 * ONE key, built into the app itself, the same on every Lumi install — NOT
 * derived from this install's own SETTINGS_ENCRYPTION_KEY. This is
 * obfuscation from someone browsing a published dataset's GitHub repo
 * directly without running Lumi, not a security boundary — it's
 * extractable from this open-source app by anyone who looks (spec's "Key
 * model" section). Never mistake a decrypted bundle for "vetted/trusted" —
 * that's the job of the validation pipeline (validate-bundle.ts,
 * manifest.ts), not this encryption.
 */
export const DATASET_SHARED_KEY = Buffer.from(
  "8GV57JbzQxrFNF3G/yEyxJ6dsFAZ2GiIHbxe6rK216w=",
  "base64"
);
```

- [ ] **Step 2: Write the failing test for `getActiveModelTag`**

```ts
// apps/web/lib/datasets/active-model.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../settings-repo", () => ({
  getSettingsRepo: vi.fn(),
}));

describe("getActiveModelTag", () => {
  it("resolves the active RETRIEVAL_MODEL setting to a full ModelTag", async () => {
    const { getSettingsRepo } = await import("../settings-repo");
    (getSettingsRepo as any).mockReturnValue({
      getSetting: vi.fn().mockResolvedValue("lumi-preview"),
    });

    const { getActiveModelTag } = await import("./active-model");
    const tag = await getActiveModelTag();

    expect(tag).toEqual({ id: "lumi-preview", version: "1.0", embeddingDim: 8448 });
  });

  it("defaults to lumi-preview when the setting isn't set yet", async () => {
    const { getSettingsRepo } = await import("../settings-repo");
    (getSettingsRepo as any).mockReturnValue({
      getSetting: vi.fn().mockResolvedValue(null),
    });

    const { getActiveModelTag } = await import("./active-model");
    const tag = await getActiveModelTag();

    expect(tag.id).toBe("lumi-preview");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @netryx/web test lib/datasets/active-model`
Expected: FAIL — `Cannot find module './active-model'`.

- [ ] **Step 4: Write `active-model.ts`**

```ts
// apps/web/lib/datasets/active-model.ts
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { getSettingsRepo } from "../settings-repo";
import type { ModelTag } from "./manifest";

/** Resolves which retrieval model is active locally right now (spec §15.3)
 * to a full {id, version, embeddingDim} tag — used both to label anything
 * this instance publishes and to check an installing dataset's own tag
 * against it. */
export async function getActiveModelTag(): Promise<ModelTag> {
  const modelId = (await getSettingsRepo().getSetting("RETRIEVAL_MODEL")) ?? "lumi-preview";
  const entry = RETRIEVAL_MODELS.find((m) => m.id === modelId);
  if (!entry) {
    throw new Error(`Active RETRIEVAL_MODEL "${modelId}" is not in the local model registry`);
  }
  return { id: entry.id, version: entry.version, embeddingDim: entry.embeddingDim };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @netryx/web test lib/datasets/active-model`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the failing test for `buildAreasZip`**

```ts
// apps/web/lib/datasets/export-bundle.test.ts
import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import { buildAreasZip } from "./export-bundle";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn().mockRejectedValue(new Error("no file on disk")) }));

function makePool(areaRows: any[], imageRows: any[], pointRows: any[]) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM areas")) return { rows: areaRows };
      if (sql.includes("FROM indexed_images")) return { rows: imageRows };
      if (sql.includes("FROM indexed_points")) return { rows: pointRows };
      throw new Error(`unexpected query: ${sql}`);
    }),
  } as any;
}

describe("buildAreasZip", () => {
  it("includes a model tag in manifest.json alongside the existing area/image/point shape", async () => {
    const pool = makePool(
      [{ id: "a1", name: "Test", geometry_wkt: "POLYGON((0 0,0 1,1 1,1 0,0 0))", area_km2: "1", status: "indexed", points_estimated: 1, points_captured: 1, points_failed: 0, images_embedded: 1, estimated_cost_usd: null, actual_cost_usd: null }],
      [{ pano_id: "abc", heading: 0, lat: "0", lng: "0", street_view_date: null, embedding_text: "[0.1,0.2]", image_path: null }],
      [{ pano_id: "abc", lat: "0", lng: "0", embedding_text: "[0.1,0.2]" }]
    );
    const model = { id: "lumi-preview", version: "1.0", embeddingDim: 2 };

    const zipBytes = await buildAreasZip(pool, ["a1"], model);
    const zip = await JSZip.loadAsync(zipBytes);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));

    expect(manifest.model).toEqual(model);
    expect(manifest.areas).toHaveLength(1);
    expect(manifest.areas[0].images[0].panoId).toBe("abc");
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @netryx/web test lib/datasets/export-bundle`
Expected: FAIL — `Cannot find module './export-bundle'`.

- [ ] **Step 8: Extract `buildAreasZip` from the export route**

```ts
// apps/web/lib/datasets/export-bundle.ts
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import type { ModelTag } from "./manifest";

function parseVector(text: string | null): number[] | null {
  if (!text) return null;
  return text.slice(1, -1).split(",").map(Number);
}

/**
 * Builds the encrypted-later, zippable bundle for one or more areas —
 * extracted from apps/web/app/api/areas/export/route.ts (spec: "reused as-
 * is, not reimplemented") so both the plain personal-backup export route
 * and the dataset-catalog publish route (Task 14) share one implementation.
 * `model` is stamped into manifest.json's top-level `model` field either
 * way, so a plain export also self-documents which model produced its
 * embeddings.
 */
export async function buildAreasZip(pool: Pool, areaIds: string[], model: ModelTag): Promise<Uint8Array> {
  const { rows: areaRows } = await pool.query(
    `SELECT id, name, ST_AsText(geometry) AS geometry_wkt, area_km2, status,
            points_estimated, points_captured, points_failed, images_embedded,
            estimated_cost_usd, actual_cost_usd
     FROM areas WHERE id = ANY($1)`,
    [areaIds]
  );
  if (areaRows.length === 0) {
    throw new Error("no matching areas");
  }

  const zip = new JSZip();
  const manifestAreas: unknown[] = [];

  for (const area of areaRows) {
    const { rows: images } = await pool.query(
      `SELECT pano_id, heading, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              street_view_date, embedding::text AS embedding_text, image_path
       FROM indexed_images WHERE area_id = $1`,
      [area.id]
    );
    const { rows: points } = await pool.query(
      `SELECT pano_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              embedding::text AS embedding_text
       FROM indexed_points WHERE area_id = $1`,
      [area.id]
    );

    const imageEntries = [];
    for (const img of images) {
      let hasFile = false;
      if (img.image_path) {
        try {
          const bytes = await readFile(img.image_path);
          zip.file(`images/${img.pano_id}_${img.heading}.jpg`, bytes);
          hasFile = true;
        } catch {
          // missing on disk — proceed without the file
        }
      }
      imageEntries.push({
        panoId: img.pano_id,
        heading: img.heading,
        lat: Number(img.lat),
        lng: Number(img.lng),
        streetViewDate: img.street_view_date,
        embedding: parseVector(img.embedding_text),
        hasFile,
      });
    }

    const pointEntries = points.map((p) => ({
      panoId: p.pano_id,
      lat: Number(p.lat),
      lng: Number(p.lng),
      embedding: parseVector(p.embedding_text),
    }));

    manifestAreas.push({
      name: area.name,
      geometryWkt: area.geometry_wkt,
      areaKm2: Number(area.area_km2),
      status: area.status,
      pointsEstimated: area.points_estimated,
      pointsCaptured: area.points_captured,
      pointsFailed: area.points_failed,
      imagesEmbedded: area.images_embedded,
      estimatedCostUsd: area.estimated_cost_usd,
      actualCostUsd: area.actual_cost_usd,
      images: imageEntries,
      points: pointEntries,
    });
  }

  zip.file(
    "manifest.json",
    JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), model, areas: manifestAreas }, null, 2)
  );

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `pnpm --filter @netryx/web test lib/datasets/export-bundle`
Expected: PASS.

- [ ] **Step 10: Update the export route to use `buildAreasZip`**

Replace the full contents of `apps/web/app/api/areas/export/route.ts` with:

```ts
// apps/web/app/api/areas/export/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";
import { buildAreasZip } from "../../../../lib/datasets/export-bundle";
import { getActiveModelTag } from "../../../../lib/datasets/active-model";

interface ExportBody {
  areaIds?: string[];
}

export async function POST(request: Request) {
  const body = (await request.json()) as ExportBody;
  if (!body.areaIds || !Array.isArray(body.areaIds) || body.areaIds.length === 0) {
    return NextResponse.json({ error: "areaIds is required" }, { status: 400 });
  }

  const model = await getActiveModelTag();
  let buffer: Uint8Array;
  try {
    buffer = await buildAreasZip(getPool(), body.areaIds, model);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }

  const filename = `lumi-areas-${new Date().toISOString().slice(0, 10)}.zip`;
  return new NextResponse(buffer as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
```

- [ ] **Step 11: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add apps/web/lib/datasets/shared-key.ts apps/web/lib/datasets/active-model.ts apps/web/lib/datasets/active-model.test.ts apps/web/lib/datasets/export-bundle.ts apps/web/lib/datasets/export-bundle.test.ts apps/web/app/api/areas/export/route.ts
git commit -m "feat(web): extract shared area-export-zip builder, add active-model + shared-key helpers"
```

---

### Task 10: `embedPendingImages` job — shared types

**Files:**
- Modify: `packages/shared-types/src/jobs.ts`
- Modify: `packages/shared-types/src/jobs.test.ts`

**Interfaces:**
- Produces: `EMBED_PENDING_IMAGES_JOB_NAME = "embed-pending-images"`, `interface EmbedPendingImagesJobPayload { areaId: string }` — Tasks 11-13 all import both.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared-types/src/jobs.test.ts`:

```ts
import { EMBED_PENDING_IMAGES_JOB_NAME } from "./jobs";
import type { EmbedPendingImagesJobPayload } from "./jobs";

describe("EMBED_PENDING_IMAGES_JOB_NAME", () => {
  it("is a distinct job name from index-area", () => {
    expect(EMBED_PENDING_IMAGES_JOB_NAME).toBe("embed-pending-images");
  });

  it("payload only needs an areaId", () => {
    const payload: EmbedPendingImagesJobPayload = { areaId: "abc" };
    expect(payload.areaId).toBe("abc");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @netryx/shared-types test jobs`
Expected: FAIL — `EMBED_PENDING_IMAGES_JOB_NAME` doesn't exist.

- [ ] **Step 3: Add the job name + payload type**

Append to `packages/shared-types/src/jobs.ts`:

```ts
/** Fills in embeddings for indexed_images rows that already have an image
 * on disk but embedding IS NULL — used after installing a dataset release
 * built with a different model (spec's "Completing embeddings after a
 * mismatched install" section). Deliberately NOT the same job as
 * index-area: that job re-walks street geometry and re-attempts Street
 * View downloads, using a global (pano_id, heading) dedup that would just
 * SKIP these already-captured rows, embedding included. */
export const EMBED_PENDING_IMAGES_JOB_NAME = "embed-pending-images";

export interface EmbedPendingImagesJobPayload {
  areaId: string;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @netryx/shared-types test jobs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/jobs.ts packages/shared-types/src/jobs.test.ts
git commit -m "feat(shared-types): add embed-pending-images job name and payload"
```

---

### Task 11: Worker DB queries for pending-embed rows

**Files:**
- Modify: `apps/worker/src/db-queries.ts`
- Create: `apps/worker/src/db-queries.test.ts`

**Interfaces:**
- Produces: `interface PendingEmbedImage { id: string; imagePath: string }`, `getPendingEmbedImages(pool, areaId): Promise<PendingEmbedImage[]>`, `updateImageEmbeddings(pool, updates: {id: string; embedding: number[]}[]): Promise<void>` — Task 12's job imports both.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/worker/src/db-queries.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { getPendingEmbedImages, updateImageEmbeddings } from "./db-queries";

const connectionString =
  process.env.TEST_DATABASE_URL ?? "postgres://netryx:changeme@localhost:5432/netryx_test";
const pool = new Pool({ connectionString });

const AREA_ID = "00000000-0000-0000-0000-0000000000a1";

beforeEach(async () => {
  await pool.query("DELETE FROM indexed_images WHERE area_id = $1", [AREA_ID]);
  await pool.query("DELETE FROM areas WHERE id = $1", [AREA_ID]);
  await pool.query(
    `INSERT INTO areas (id, geometry, area_km2) VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 1)`,
    [AREA_ID]
  );
  await pool.query(
    `INSERT INTO indexed_images (area_id, pano_id, heading, location, embedding, image_path)
     VALUES
       ($1, 'pending1', 0, ST_GeogFromText('POINT(0 0)'), NULL, '/tmp/pending1_0.jpg'),
       ($1, 'pending2', 90, ST_GeogFromText('POINT(0 0)'), NULL, NULL),
       ($1, 'already-embedded', 0, ST_GeogFromText('POINT(0 0)'), '[0.1,0.2]', '/tmp/already_0.jpg')`,
    [AREA_ID]
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM indexed_images WHERE area_id = $1", [AREA_ID]);
  await pool.query("DELETE FROM areas WHERE id = $1", [AREA_ID]);
  await pool.end();
});

describe("getPendingEmbedImages", () => {
  it("returns only rows with embedding IS NULL AND image_path IS NOT NULL", async () => {
    const pending = await getPendingEmbedImages(pool, AREA_ID);
    expect(pending).toHaveLength(1);
    expect(pending[0].imagePath).toBe("/tmp/pending1_0.jpg");
  });
});

describe("updateImageEmbeddings", () => {
  it("writes the embedding for the given row ids", async () => {
    const [pending] = await getPendingEmbedImages(pool, AREA_ID);
    await updateImageEmbeddings(pool, [{ id: pending.id, embedding: [0.5, 0.6] }]);

    const { rows } = await pool.query("SELECT embedding::text FROM indexed_images WHERE id = $1", [pending.id]);
    expect(rows[0].embedding).toBe("[0.5,0.6]");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/worker test db-queries`
Expected: FAIL — `getPendingEmbedImages`/`updateImageEmbeddings` don't exist.

- [ ] **Step 3: Add the two functions**

Append to `apps/worker/src/db-queries.ts`:

```ts
export interface PendingEmbedImage {
  id: string;
  imagePath: string;
}

/** Rows that already have an image on disk but no embedding yet — the
 * state a dataset-catalog install leaves behind when the release's model
 * doesn't match what's locally active (spec's "Completing embeddings
 * after a mismatched install" section). Deliberately does NOT touch
 * loadExistingPanoHeadings' dedup set — this has nothing to do with
 * re-downloading. */
export async function getPendingEmbedImages(pool: Pool, areaId: string): Promise<PendingEmbedImage[]> {
  const { rows } = await pool.query<{ id: string; image_path: string }>(
    `SELECT id, image_path FROM indexed_images
     WHERE area_id = $1 AND embedding IS NULL AND image_path IS NOT NULL`,
    [areaId]
  );
  return rows.map((r) => ({ id: r.id, imagePath: r.image_path }));
}

export async function updateImageEmbeddings(
  pool: Pool,
  updates: { id: string; embedding: number[] }[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const update of updates) {
      await client.query(
        `UPDATE indexed_images SET embedding = $2, embedded_at = now() WHERE id = $1`,
        [update.id, `[${update.embedding.join(",")}]`]
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/worker test db-queries`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/db-queries.ts apps/worker/src/db-queries.test.ts
git commit -m "feat(worker): add DB queries for pending (unembedded) images"
```

---

### Task 12: `embedPendingImages` job

**Files:**
- Create: `apps/worker/src/jobs/embed-pending-images.ts`
- Create: `apps/worker/src/jobs/embed-pending-images.test.ts`

**Interfaces:**
- Consumes: `PendingEmbedImage`, `getPendingEmbedImages`, `updateImageEmbeddings` (Task 11).
- Produces: `interface EmbedPendingImagesJobDeps { ... }`, `runEmbedPendingImagesJob(payload: EmbedPendingImagesJobPayload, deps: EmbedPendingImagesJobDeps): Promise<void>` — Task 13's worker `index.ts` wires this into `boss.work(...)`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/worker/src/jobs/embed-pending-images.test.ts
import { describe, it, expect, vi } from "vitest";
import { runEmbedPendingImagesJob, type EmbedPendingImagesJobDeps } from "./embed-pending-images";

function makeDeps(overrides: Partial<EmbedPendingImagesJobDeps> = {}): EmbedPendingImagesJobDeps {
  return {
    getPendingImages: vi.fn().mockResolvedValue([
      { id: "img-1", imagePath: "/data/img1.jpg" },
      { id: "img-2", imagePath: "/data/img2.jpg" },
    ]),
    readImageBase64: vi.fn().mockResolvedValue("ZmFrZS1pbWFnZS1ieXRlcw=="),
    embedImages: vi.fn().mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]),
    updateImageEmbeddings: vi.fn().mockResolvedValue(undefined),
    updateAreaProgress: vi.fn().mockResolvedValue(undefined),
    inferenceBaseUrl: "http://localhost:8000",
    ...overrides,
  };
}

describe("runEmbedPendingImagesJob", () => {
  it("reads pending images, embeds them, writes embeddings, and marks the area indexed", async () => {
    const deps = makeDeps();
    await runEmbedPendingImagesJob({ areaId: "area-1" }, deps);

    expect(deps.getPendingImages).toHaveBeenCalledWith("area-1");
    expect(deps.readImageBase64).toHaveBeenCalledTimes(2);
    expect(deps.embedImages).toHaveBeenCalledWith(["ZmFrZS1pbWFnZS1ieXRlcw==", "ZmFrZS1pbWFnZS1ieXRlcw=="], "http://localhost:8000");
    expect(deps.updateImageEmbeddings).toHaveBeenCalledWith([
      { id: "img-1", embedding: [0.1, 0.2] },
      { id: "img-2", embedding: [0.3, 0.4] },
    ]);
    expect(deps.updateAreaProgress).toHaveBeenCalledWith("area-1", { status: "indexing" });
    expect(deps.updateAreaProgress).toHaveBeenCalledWith("area-1", { status: "indexed" });
  });

  it("never calls anything related to Street View downloads or geometry sampling", async () => {
    const deps = makeDeps();
    await runEmbedPendingImagesJob({ areaId: "area-1" }, deps);
    // The dependency shape itself has no downloadCaptures/fetchStreetGeometry/
    // samplePointsAlongStreets fields — this test documents that constraint
    // rather than asserting a spy, since those deps simply don't exist here.
    expect(Object.keys(deps)).not.toContain("downloadCaptures");
    expect(Object.keys(deps)).not.toContain("fetchStreetGeometry");
  });

  it("does nothing but mark the area indexed when there are no pending images", async () => {
    const deps = makeDeps({ getPendingImages: vi.fn().mockResolvedValue([]) });
    await runEmbedPendingImagesJob({ areaId: "area-1" }, deps);

    expect(deps.embedImages).not.toHaveBeenCalled();
    expect(deps.updateImageEmbeddings).not.toHaveBeenCalled();
    expect(deps.updateAreaProgress).toHaveBeenCalledWith("area-1", { status: "indexed" });
  });

  it("marks the area failed if embedding throws", async () => {
    const deps = makeDeps({ embedImages: vi.fn().mockRejectedValue(new Error("inference down")) });
    await runEmbedPendingImagesJob({ areaId: "area-1" }, deps);

    expect(deps.updateAreaProgress).toHaveBeenCalledWith("area-1", { status: "failed" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/worker test jobs/embed-pending-images`
Expected: FAIL — `Cannot find module './embed-pending-images'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/worker/src/jobs/embed-pending-images.ts
import type { EmbedPendingImagesJobPayload } from "@netryx/shared-types";
import type { AreaProgressUpdate } from "../progress";

export interface PendingEmbedImageDep {
  id: string;
  imagePath: string;
}

export interface EmbedPendingImagesJobDeps {
  getPendingImages: (areaId: string) => Promise<PendingEmbedImageDep[]>;
  readImageBase64: (imagePath: string) => Promise<string>;
  embedImages: (imagesBase64: string[], inferenceBaseUrl: string) => Promise<number[][]>;
  updateImageEmbeddings: (updates: { id: string; embedding: number[] }[]) => Promise<void>;
  updateAreaProgress: (areaId: string, update: AreaProgressUpdate) => Promise<void>;
  inferenceBaseUrl: string;
}

// Same chunk size as apps/worker/src/jobs/index-area.ts's EMBED_CHUNK_SIZE,
// for the same reason: embedding one giant batch OOMs the CPU-bound
// inference service.
const EMBED_CHUNK_SIZE = 16;

/**
 * Fills in embeddings for images that are already on disk but have
 * `embedding IS NULL` — the state left behind by installing a dataset
 * release built with a different model (spec's "Completing embeddings
 * after a mismatched install" section). Deliberately does NOT re-walk
 * street geometry or call Street View — no cost, no re-download, unlike
 * runIndexAreaJob (index-area.ts), whose global pano/heading dedup would
 * just skip these rows entirely instead of embedding them.
 */
export async function runEmbedPendingImagesJob(
  payload: EmbedPendingImagesJobPayload,
  deps: EmbedPendingImagesJobDeps
): Promise<void> {
  const { areaId } = payload;

  try {
    const pending = await deps.getPendingImages(areaId);

    if (pending.length === 0) {
      await deps.updateAreaProgress(areaId, { status: "indexed" });
      return;
    }

    await deps.updateAreaProgress(areaId, { status: "indexing" });

    for (let start = 0; start < pending.length; start += EMBED_CHUNK_SIZE) {
      const chunk = pending.slice(start, start + EMBED_CHUNK_SIZE);
      const imagesBase64 = await Promise.all(chunk.map((img) => deps.readImageBase64(img.imagePath)));
      const embeddings = await deps.embedImages(imagesBase64, deps.inferenceBaseUrl);

      await deps.updateImageEmbeddings(
        chunk.map((img, i) => ({ id: img.id, embedding: embeddings[i] }))
      );
    }

    await deps.updateAreaProgress(areaId, { status: "indexed" });
  } catch (err) {
    console.error(`[embed-pending-images] job for area ${areaId} failed:`, err);
    await deps.updateAreaProgress(areaId, { status: "failed" }).catch(() => {});
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/worker test jobs/embed-pending-images`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/jobs/embed-pending-images.ts apps/worker/src/jobs/embed-pending-images.test.ts
git commit -m "feat(worker): add embed-pending-images job"
```

---

### Task 13: Wire the new job into both queues + the worker's `main()`

**Files:**
- Modify: `apps/worker/src/queue.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/web/lib/queue.ts`

**Interfaces:**
- Consumes: `EMBED_PENDING_IMAGES_JOB_NAME`, `EmbedPendingImagesJobPayload` (Task 10); `runEmbedPendingImagesJob` (Task 12); `getPendingEmbedImages`, `updateImageEmbeddings` (Task 11).
- Produces: `enqueueEmbedPendingImagesJob(payload: EmbedPendingImagesJobPayload): Promise<string>` (in `apps/web/lib/queue.ts`) — Task 16's install route calls this.

- [ ] **Step 1: Re-export the new job name/type from the worker's `queue.ts`**

In `apps/worker/src/queue.ts`, change:

```ts
import PgBoss from "pg-boss";
import { INDEX_AREA_JOB_NAME, type IndexAreaJobPayload } from "@netryx/shared-types";

export { INDEX_AREA_JOB_NAME };
export type { IndexAreaJobPayload };
```

to:

```ts
import PgBoss from "pg-boss";
import {
  INDEX_AREA_JOB_NAME,
  EMBED_PENDING_IMAGES_JOB_NAME,
  type IndexAreaJobPayload,
  type EmbedPendingImagesJobPayload,
} from "@netryx/shared-types";

export { INDEX_AREA_JOB_NAME, EMBED_PENDING_IMAGES_JOB_NAME };
export type { IndexAreaJobPayload, EmbedPendingImagesJobPayload };
```

- [ ] **Step 2: Register the new job handler in the worker's `main()`**

In `apps/worker/src/index.ts`, add these imports (alongside the existing ones):

```ts
import { runEmbedPendingImagesJob } from "./jobs/embed-pending-images";
import { getPendingEmbedImages, updateImageEmbeddings } from "./db-queries";
import { readFile } from "node:fs/promises";
```

Add this type guard right after `isIndexAreaJobPayload`:

```ts
function isEmbedPendingImagesJobPayload(data: unknown): data is EmbedPendingImagesJobPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    "areaId" in data &&
    typeof (data as { areaId: unknown }).areaId === "string"
  );
}
```

Add `EmbedPendingImagesJobPayload` to the existing `import type { IndexAreaJobPayload } from "@netryx/shared-types";` line, making it:

```ts
import type { IndexAreaJobPayload, EmbedPendingImagesJobPayload } from "@netryx/shared-types";
```

And add this `boss.work(...)` call inside `main()`, right after the existing `await boss.work(INDEX_AREA_JOB_NAME, ...)` block:

```ts
  await boss.work(EMBED_PENDING_IMAGES_JOB_NAME, async (job) => {
    if (!isEmbedPendingImagesJobPayload(job.data)) {
      throw new Error(`Malformed ${EMBED_PENDING_IMAGES_JOB_NAME} payload: ${JSON.stringify(job.data)}`);
    }
    await runEmbedPendingImagesJob(job.data, {
      getPendingImages: (areaId) => getPendingEmbedImages(pool, areaId),
      readImageBase64: async (imagePath) => (await readFile(imagePath)).toString("base64"),
      embedImages,
      updateImageEmbeddings: (updates) => updateImageEmbeddings(pool, updates),
      updateAreaProgress: (areaId, update) => updateAreaProgress(pool, areaId, update),
      inferenceBaseUrl,
    });
  });
```

(`EMBED_PENDING_IMAGES_JOB_NAME` is already imported from `./queue` once you change the existing `import { getBoss, INDEX_AREA_JOB_NAME } from "./queue";` line to `import { getBoss, INDEX_AREA_JOB_NAME, EMBED_PENDING_IMAGES_JOB_NAME } from "./queue";`.)

- [ ] **Step 3: Typecheck the worker**

Run: `pnpm --filter @netryx/worker typecheck`
Expected: no errors.

- [ ] **Step 4: Add the producer-side enqueue function to `apps/web/lib/queue.ts`**

In `apps/web/lib/queue.ts`, change the import line:

```ts
import { INDEX_AREA_JOB_NAME, type IndexAreaJobPayload } from "@netryx/shared-types";
```

to:

```ts
import {
  INDEX_AREA_JOB_NAME,
  EMBED_PENDING_IMAGES_JOB_NAME,
  type IndexAreaJobPayload,
  type EmbedPendingImagesJobPayload,
} from "@netryx/shared-types";
```

Append this function after `enqueueIndexAreaJob`:

```ts
/** Enqueued after a dataset install whose release didn't match the locally
 * active model (spec: "Completing embeddings after a mismatched install") —
 * see apps/worker/src/jobs/embed-pending-images.ts for what the worker
 * actually does with it. */
export async function enqueueEmbedPendingImagesJob(payload: EmbedPendingImagesJobPayload): Promise<string> {
  const client = await getBoss();
  const jobId = await client.send(EMBED_PENDING_IMAGES_JOB_NAME, payload);

  if (!jobId) {
    throw new Error(`pg-boss declined to enqueue the ${EMBED_PENDING_IMAGES_JOB_NAME} job`);
  }

  return jobId;
}
```

- [ ] **Step 5: Typecheck the web app**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/queue.ts apps/worker/src/index.ts apps/web/lib/queue.ts
git commit -m "feat: wire embed-pending-images job into both queues and the worker"
```

---

### Task 14: `POST /api/datasets/publish`

**Files:**
- Create: `apps/web/app/api/datasets/publish/route.ts`
- Create: `apps/web/app/api/datasets/publish/route.test.ts`

**Interfaces:**
- Consumes: `getActiveModelTag` (Task 9), `buildAreasZip` (Task 9), `buildDatasetMetadata`, `BUNDLE_ASSET_NAME`, `METADATA_ASSET_NAME` (Task 5), `DATASET_SHARED_KEY` (Task 9), `encryptBuffer` (Task 3), `ensureRepoWithTopic`, `upsertRelease` (Task 8), `getSettingsRepo` (`../../../../lib/settings-repo`).
- Produces: `POST(request: Request): Promise<Response>` returning `{ tag: string }` on success.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/api/datasets/publish/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn() }));
vi.mock("../../../../lib/datasets/active-model", () => ({ getActiveModelTag: vi.fn() }));
vi.mock("../../../../lib/datasets/export-bundle", () => ({ buildAreasZip: vi.fn() }));
vi.mock("../../../../lib/datasets/github", () => ({ ensureRepoWithTopic: vi.fn(), upsertRelease: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/datasets/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/datasets/publish", () => {
  it("400s when GITHUB_TOKEN isn't configured", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue(null) });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ areaId: "a1", title: "T", description: "D", owner: "inigo", repo: "lumi-madrid" }));
    expect(res.status).toBe(400);
  });

  it("builds the bundle, uploads it tagged with the active model, and returns the tag", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue("gh-token") });

    const { getActiveModelTag } = await import("../../../../lib/datasets/active-model");
    (getActiveModelTag as any).mockResolvedValue({ id: "lumi-preview", version: "1.0", embeddingDim: 8448 });

    const { buildAreasZip } = await import("../../../../lib/datasets/export-bundle");
    (buildAreasZip as any).mockResolvedValue(new Uint8Array([1, 2, 3]));

    const { ensureRepoWithTopic, upsertRelease } = await import("../../../../lib/datasets/github");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ areaId: "a1", title: "T", description: "D", owner: "inigo", repo: "lumi-madrid" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tag).toBe("lumi-preview-v1.0");
    expect(ensureRepoWithTopic).toHaveBeenCalledWith("inigo", "lumi-madrid", "gh-token");
    expect(upsertRelease).toHaveBeenCalledWith(
      "inigo", "lumi-madrid", "lumi-preview-v1.0", "Lumi Preview v1.0",
      expect.arrayContaining([
        expect.objectContaining({ name: "bundle.zip.enc" }),
        expect.objectContaining({ name: "metadata.json.enc" }),
      ]),
      "gh-token"
    );
  });

  it("400s when required fields are missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ areaId: "a1" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test app/api/datasets/publish/route`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/datasets/publish/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { getActiveModelTag } from "../../../../lib/datasets/active-model";
import { buildAreasZip } from "../../../../lib/datasets/export-bundle";
import { buildDatasetMetadata, BUNDLE_ASSET_NAME, METADATA_ASSET_NAME } from "../../../../lib/datasets/manifest";
import { DATASET_SHARED_KEY } from "../../../../lib/datasets/shared-key";
import { encryptBuffer } from "@netryx/settings-repo";
import { ensureRepoWithTopic, upsertRelease } from "../../../../lib/datasets/github";

interface PublishBody {
  areaId?: string;
  title?: string;
  description?: string;
  owner?: string;
  repo?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as PublishBody;
  if (!body.areaId || !body.title || !body.description || !body.owner || !body.repo) {
    return NextResponse.json({ error: "areaId, title, description, owner and repo are required" }, { status: 400 });
  }

  const token = await getSettingsRepo().getSetting("GITHUB_TOKEN");
  if (!token) {
    return NextResponse.json({ error: "GITHUB_TOKEN is not configured — set it in Settings first" }, { status: 400 });
  }

  const model = await getActiveModelTag();
  const zipBytes = await buildAreasZip(getPool(), [body.areaId], model);

  const { rows } = await getPool().query(
    `SELECT points_captured, images_embedded FROM areas WHERE id = $1`,
    [body.areaId]
  );
  const stats = {
    pointsCaptured: rows[0]?.points_captured ?? 0,
    imagesEmbedded: rows[0]?.images_embedded ?? 0,
  };
  const metadata = buildDatasetMetadata(body.title, body.description, model, stats);

  const tag = `${model.id}-v${model.version}`;
  const title = `${model.id} v${model.version}`;

  await ensureRepoWithTopic(body.owner, body.repo, token);
  await upsertRelease(
    body.owner,
    body.repo,
    tag,
    title,
    [
      { name: BUNDLE_ASSET_NAME, data: encryptBuffer(Buffer.from(zipBytes), DATASET_SHARED_KEY) },
      { name: METADATA_ASSET_NAME, data: encryptBuffer(Buffer.from(JSON.stringify(metadata)), DATASET_SHARED_KEY) },
    ],
    token
  );

  return NextResponse.json({ tag }, { status: 200 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test app/api/datasets/publish/route`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/datasets/publish/route.ts apps/web/app/api/datasets/publish/route.test.ts
git commit -m "feat(web): add POST /api/datasets/publish"
```

---

### Task 15: `GET /api/datasets` (discovery)

**Files:**
- Create: `apps/web/app/api/datasets/route.ts`
- Create: `apps/web/app/api/datasets/route.test.ts`

**Interfaces:**
- Consumes: `searchRepositoriesByTopic`, `listReleasesForRepo`, `downloadReleaseAsset` (Task 8), `METADATA_ASSET_NAME` (Task 5), `DATASET_SHARED_KEY` (Task 9), `decryptBuffer` (Task 3), `getActiveModelTag` (Task 9), `isCompatible` (Task 6).
- Produces: `GET(): Promise<Response>` returning `{ areas: Array<{ owner, repo, releases: Array<{ tag, title, description, model, stats, compatible }> }> }`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/api/datasets/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/datasets/github", () => ({
  searchRepositoriesByTopic: vi.fn(),
  listReleasesForRepo: vi.fn(),
  downloadReleaseAsset: vi.fn(),
}));
vi.mock("../../../lib/datasets/active-model", () => ({ getActiveModelTag: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/datasets", () => {
  it("groups releases by repo and marks each release's compatibility against the active model", async () => {
    const github = await import("../../../lib/datasets/github");
    (github.searchRepositoriesByTopic as any).mockResolvedValue([{ owner: "inigo", repo: "lumi-madrid" }]);
    (github.listReleasesForRepo as any).mockResolvedValue([
      { tagName: "lumi-preview-v1.0", name: "Lumi Preview v1.0", body: "", assets: [{ name: "metadata.json.enc", url: "https://api.github.com/a/1" }] },
      { tagName: "future-model-v2.0", name: "Future Model v2.0", body: "", assets: [{ name: "metadata.json.enc", url: "https://api.github.com/a/2" }] },
    ]);

    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { DATASET_SHARED_KEY } = await import("../../../lib/datasets/shared-key");
    const metaA = { title: "Downtown Madrid", description: "d", model: { id: "lumi-preview", version: "1.0", embeddingDim: 8448 }, stats: { pointsCaptured: 10, imagesEmbedded: 40 } };
    const metaB = { title: "Downtown Madrid", description: "d", model: { id: "future-model", version: "2.0", embeddingDim: 512 }, stats: { pointsCaptured: 10, imagesEmbedded: 40 } };
    (github.downloadReleaseAsset as any)
      .mockResolvedValueOnce(encryptBuffer(Buffer.from(JSON.stringify(metaA)), DATASET_SHARED_KEY))
      .mockResolvedValueOnce(encryptBuffer(Buffer.from(JSON.stringify(metaB)), DATASET_SHARED_KEY));

    const { getActiveModelTag } = await import("../../../lib/datasets/active-model");
    (getActiveModelTag as any).mockResolvedValue({ id: "lumi-preview", version: "1.0", embeddingDim: 8448 });

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json.areas).toHaveLength(1);
    expect(json.areas[0].owner).toBe("inigo");
    expect(json.areas[0].releases).toHaveLength(2);
    expect(json.areas[0].releases.find((r: any) => r.tag === "lumi-preview-v1.0").compatible).toBe(true);
    expect(json.areas[0].releases.find((r: any) => r.tag === "future-model-v2.0").compatible).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test app/api/datasets/route`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/datasets/route.ts
import { NextResponse } from "next/server";
import { searchRepositoriesByTopic, listReleasesForRepo, downloadReleaseAsset } from "../../../lib/datasets/github";
import { getActiveModelTag } from "../../../lib/datasets/active-model";
import { isCompatible } from "../../../lib/datasets/compatibility";
import { METADATA_ASSET_NAME, type DatasetMetadata } from "../../../lib/datasets/manifest";
import { DATASET_SHARED_KEY } from "../../../lib/datasets/shared-key";
import { decryptBuffer } from "@netryx/settings-repo";

export async function GET() {
  const activeModel = await getActiveModelTag();
  const repos = await searchRepositoriesByTopic("lumi-dataset");

  const areas = await Promise.all(
    repos.map(async ({ owner, repo }) => {
      const githubReleases = await listReleasesForRepo(owner, repo);

      const releases = await Promise.all(
        githubReleases.map(async (release) => {
          const metadataAsset = release.assets.find((a) => a.name === METADATA_ASSET_NAME);
          if (!metadataAsset) return null;

          const encrypted = await downloadReleaseAsset(metadataAsset.url);
          const metadata = JSON.parse(decryptBuffer(encrypted, DATASET_SHARED_KEY).toString("utf8")) as DatasetMetadata;

          return {
            tag: release.tagName,
            title: metadata.title,
            description: metadata.description,
            model: metadata.model,
            stats: metadata.stats,
            compatible: isCompatible(metadata.model, activeModel),
          };
        })
      );

      return { owner, repo, releases: releases.filter((r): r is NonNullable<typeof r> => r !== null) };
    })
  );

  return NextResponse.json({ areas });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test app/api/datasets/route`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/datasets/route.ts apps/web/app/api/datasets/route.test.ts
git commit -m "feat(web): add GET /api/datasets (discovery, grouped by repo)"
```

---

### Task 16: `POST /api/datasets/install`

**Files:**
- Create: `apps/web/app/api/datasets/install/route.ts`
- Create: `apps/web/app/api/datasets/install/route.test.ts`

**Interfaces:**
- Consumes: `listReleasesForRepo`, `downloadReleaseAsset` (Task 8), `METADATA_ASSET_NAME`, `BUNDLE_ASSET_NAME`, `validateDatasetManifest` (Task 5), `isCompatible` (Task 6), `getActiveModelTag` (Task 9), `assertCompressedSizeWithinLimit`, `assertFileCountWithinLimit`, `assertDecompressedSizeWithinLimit`, `isLikelyJpeg` (Task 7), `enqueueEmbedPendingImagesJob` (Task 13), `captureImagePath` (Task 4), `RETRIEVAL_MODELS` (`@netryx/shared-types`).
- Produces: `POST(request: Request): Promise<Response>` — `409` with `{ compatible: false, datasetModel, activeModel }` on an unconfirmed mismatch; `201` with `{ areaId, compatible }` on success.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/api/datasets/install/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn() }));
vi.mock("../../../../lib/datasets/github", () => ({ listReleasesForRepo: vi.fn(), downloadReleaseAsset: vi.fn() }));
vi.mock("../../../../lib/datasets/active-model", () => ({ getActiveModelTag: vi.fn() }));
vi.mock("../../../../lib/queue", () => ({ enqueueEmbedPendingImagesJob: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/datasets/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function encryptedMetadata(model: { id: string; version: string; embeddingDim: number }) {
  const { encryptBuffer } = await import("@netryx/settings-repo");
  const { DATASET_SHARED_KEY } = await import("../../../../lib/datasets/shared-key");
  return encryptBuffer(
    Buffer.from(JSON.stringify({ title: "T", description: "D", model, stats: { pointsCaptured: 0, imagesEmbedded: 0 } })),
    DATASET_SHARED_KEY
  );
}

describe("POST /api/datasets/install", () => {
  it("404s when the release/tag isn't found", async () => {
    const { listReleasesForRepo } = await import("../../../../lib/datasets/github");
    (listReleasesForRepo as any).mockResolvedValue([]);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-madrid", tag: "missing-v1.0" }));
    expect(res.status).toBe(404);
  });

  it("409s on a model mismatch when forceInstall isn't set, without downloading the bundle", async () => {
    const { listReleasesForRepo, downloadReleaseAsset } = await import("../../../../lib/datasets/github");
    (listReleasesForRepo as any).mockResolvedValue([
      { tagName: "future-model-v2.0", name: "x", body: "", assets: [{ name: "metadata.json.enc", url: "meta-url" }, { name: "bundle.zip.enc", url: "bundle-url" }] },
    ]);
    (downloadReleaseAsset as any).mockImplementation(async (url: string) => {
      if (url === "meta-url") return encryptedMetadata({ id: "future-model", version: "2.0", embeddingDim: 512 });
      throw new Error("should not download the bundle before the compatibility check");
    });

    const { getActiveModelTag } = await import("../../../../lib/datasets/active-model");
    (getActiveModelTag as any).mockResolvedValue({ id: "lumi-preview", version: "1.0", embeddingDim: 8448 });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-madrid", tag: "future-model-v2.0" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.compatible).toBe(false);
    expect(json.datasetModel.id).toBe("future-model");
    expect(json.activeModel.id).toBe("lumi-preview");
  });

  it("400s when the release is missing an expected asset", async () => {
    const { listReleasesForRepo } = await import("../../../../lib/datasets/github");
    (listReleasesForRepo as any).mockResolvedValue([
      { tagName: "lumi-preview-v1.0", name: "x", body: "", assets: [] },
    ]);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-madrid", tag: "lumi-preview-v1.0" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test app/api/datasets/install/route`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/datasets/install/route.ts
import { NextResponse } from "next/server";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { decryptBuffer } from "@netryx/settings-repo";
import { getPool } from "../../../../lib/db";
import { streetViewImageDir, captureImagePath } from "../../../../lib/street-view-image-dir";
import { listReleasesForRepo, downloadReleaseAsset } from "../../../../lib/datasets/github";
import { getActiveModelTag } from "../../../../lib/datasets/active-model";
import { isCompatible } from "../../../../lib/datasets/compatibility";
import {
  validateDatasetManifest,
  BUNDLE_ASSET_NAME,
  METADATA_ASSET_NAME,
  type DatasetMetadata,
} from "../../../../lib/datasets/manifest";
import { DATASET_SHARED_KEY } from "../../../../lib/datasets/shared-key";
import {
  assertCompressedSizeWithinLimit,
  assertFileCountWithinLimit,
  assertDecompressedSizeWithinLimit,
  isLikelyJpeg,
} from "../../../../lib/datasets/validate-bundle";
import { enqueueEmbedPendingImagesJob } from "../../../../lib/queue";

interface InstallBody {
  owner?: string;
  repo?: string;
  tag?: string;
  forceInstall?: boolean;
}

const KNOWN_MODEL_IDS = new Set(RETRIEVAL_MODELS.map((m) => m.id));

export async function POST(request: Request) {
  const body = (await request.json()) as InstallBody;
  if (!body.owner || !body.repo || !body.tag) {
    return NextResponse.json({ error: "owner, repo and tag are required" }, { status: 400 });
  }

  const releases = await listReleasesForRepo(body.owner, body.repo);
  const release = releases.find((r) => r.tagName === body.tag);
  if (!release) {
    return NextResponse.json({ error: "release not found" }, { status: 404 });
  }

  const metadataAsset = release.assets.find((a) => a.name === METADATA_ASSET_NAME);
  const bundleAsset = release.assets.find((a) => a.name === BUNDLE_ASSET_NAME);
  if (!metadataAsset || !bundleAsset) {
    return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
  }

  const metadataBytes = await downloadReleaseAsset(metadataAsset.url);
  const metadata = JSON.parse(decryptBuffer(metadataBytes, DATASET_SHARED_KEY).toString("utf8")) as DatasetMetadata;

  const activeModel = await getActiveModelTag();
  const compatible = isCompatible(metadata.model, activeModel);

  if (!compatible && !body.forceInstall) {
    return NextResponse.json({ compatible: false, datasetModel: metadata.model, activeModel }, { status: 409 });
  }

  const bundleBytes = await downloadReleaseAsset(bundleAsset.url);
  const decrypted = decryptBuffer(bundleBytes, DATASET_SHARED_KEY);
  assertCompressedSizeWithinLimit(decrypted.length);

  let zip: JSZip;
  let manifest;
  try {
    zip = await JSZip.loadAsync(decrypted);
    assertFileCountWithinLimit(Object.keys(zip.files).length);
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) throw new Error("manifest.json missing from bundle");
    manifest = validateDatasetManifest(JSON.parse(await manifestFile.async("string")), KNOWN_MODEL_IDS);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  const stagingDir = await mkdtemp(join(tmpdir(), "lumi-dataset-"));
  const stagedImages: { panoId: string; heading: number; bytes: Buffer }[] = [];
  let decompressedTotal = 0;

  try {
    for (const area of manifest.areas) {
      for (const img of area.images) {
        if (!img.hasFile) continue;
        const entry = zip.file(`images/${img.panoId}_${img.heading}.jpg`);
        if (!entry) continue;
        const bytes = Buffer.from(await entry.async("nodebuffer"));
        decompressedTotal += bytes.length;
        assertDecompressedSizeWithinLimit(decompressedTotal);
        if (!isLikelyJpeg(bytes)) {
          throw new Error(`images/${img.panoId}_${img.heading}.jpg does not look like a real JPEG`);
        }
        const stagedPath = join(stagingDir, `${img.panoId}_${img.heading}.jpg`);
        await writeFile(stagedPath, bytes);
        stagedImages.push({ panoId: img.panoId, heading: img.heading, bytes });
      }
    }

    await mkdir(streetViewImageDir(), { recursive: true });
    let areaId = "";
    for (const area of manifest.areas) {
      const { rows } = await getPool().query(
        `INSERT INTO areas (name, geometry, area_km2, status, points_estimated, points_captured,
                            points_failed, images_embedded, estimated_cost_usd, actual_cost_usd)
         VALUES ($1, ST_GeomFromText($2, 4326), $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          area.name, area.geometryWkt, area.areaKm2,
          compatible ? area.status : "pending",
          area.pointsEstimated, area.pointsCaptured, area.pointsFailed,
          compatible ? area.imagesEmbedded : 0,
          area.estimatedCostUsd, area.actualCostUsd,
        ]
      );
      areaId = rows[0].id as string;

      for (const img of area.images) {
        const staged = stagedImages.find((s) => s.panoId === img.panoId && s.heading === img.heading);
        const imagePath = staged ? captureImagePath(img.panoId, img.heading) : null;
        if (staged && imagePath) {
          await writeFile(imagePath, staged.bytes);
        }
        const embeddingLiteral = compatible && img.embedding ? `[${img.embedding.join(",")}]` : null;
        await getPool().query(
          `INSERT INTO indexed_images (area_id, pano_id, heading, location, street_view_date, embedding, image_path, embedded_at)
           VALUES ($1, $2, $3, ST_GeogFromText($4), $5, $6, $7, CASE WHEN $6 IS NOT NULL THEN now() ELSE NULL END)
           ON CONFLICT (pano_id, heading) DO NOTHING`,
          [areaId, img.panoId, img.heading, `POINT(${img.lng} ${img.lat})`, img.streetViewDate, embeddingLiteral, imagePath]
        );
      }

      for (const pt of area.points) {
        const embeddingLiteral = compatible && pt.embedding ? `[${pt.embedding.join(",")}]` : null;
        await getPool().query(
          `INSERT INTO indexed_points (area_id, pano_id, location, embedding)
           VALUES ($1, $2, ST_GeogFromText($3), $4)
           ON CONFLICT (pano_id) DO NOTHING`,
          [areaId, pt.panoId, `POINT(${pt.lng} ${pt.lat})`, embeddingLiteral]
        );
      }
    }

    if (!compatible) {
      await enqueueEmbedPendingImagesJob({ areaId });
    }

    return NextResponse.json({ areaId, compatible }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test app/api/datasets/install/route`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/datasets/install/route.ts apps/web/app/api/datasets/install/route.test.ts
git commit -m "feat(web): add POST /api/datasets/install with model-compatibility handling"
```

---

### Task 17: `DatasetsCatalogPanel` UI (Explorar / Publicar)

**Files:**
- Create: `apps/web/app/components/DatasetsCatalogPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/datasets`, `POST /api/datasets/install`, `POST /api/datasets/publish`, `fetchJson` (`../lib/fetch-json`), `FloatingCard` (`./FloatingCard`).
- Produces: `DatasetsCatalogPanel()` — Task 18 renders this as a new Settings tab.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/DatasetsCatalogPanel.tsx
"use client";
import { useEffect, useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { fetchJson } from "../lib/fetch-json";

interface ModelTag { id: string; version: string; embeddingDim: number }
interface DatasetRelease {
  tag: string; title: string; description: string; model: ModelTag;
  stats: { pointsCaptured: number; imagesEmbedded: number }; compatible: boolean;
}
interface DatasetArea { owner: string; repo: string; releases: DatasetRelease[] }

function ReleaseRow({
  owner, repo, release, onInstall,
}: { owner: string; repo: string; release: DatasetRelease; onInstall: (owner: string, repo: string, release: DatasetRelease) => void }) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 last:border-b-0">
      <div>
        <div className="text-[13px] text-fg">{release.model.id} v{release.model.version}</div>
        <div className="text-[11px] text-subtle">{release.stats.pointsCaptured} puntos · {release.stats.imagesEmbedded} imágenes</div>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-medium ${
            release.compatible
              ? "border border-[rgba(120,200,140,0.35)] bg-[rgba(120,200,140,0.12)] text-[#8fd6a3]"
              : "border border-[rgba(239,159,39,0.4)] bg-[rgba(239,159,39,0.12)] text-warning-fg"
          }`}
        >
          {release.compatible ? "Compatible" : "Requiere completar embeddings"}
        </span>
        <button
          onClick={() => onInstall(owner, repo, release)}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-black"
        >
          Instalar
        </button>
      </div>
    </div>
  );
}

function MismatchDialog({
  release, onCancel, onConfirm,
}: { release: DatasetRelease; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60">
      <FloatingCard className="w-[420px] p-5">
        <div className="text-[13.5px] font-medium text-fg">Modelo distinto al activo</div>
        <p className="mt-2.5 text-[12.5px] text-muted">
          Este dataset se construyó con <b className="text-fg">{release.model.id} v{release.model.version}</b>.
          Se instalarán las imágenes y puntos igualmente, y se completarán los embeddings automáticamente con tu
          modelo activo (sin volver a gastar cuota de Street View). El área aparecerá como &quot;indexando&quot; hasta que termine.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-white/15 px-4 py-2 text-xs text-fg hover:bg-white/10">
            Cancelar
          </button>
          <button onClick={onConfirm} className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black">
            Instalar y completar embeddings
          </button>
        </div>
      </FloatingCard>
    </div>
  );
}

function ExplorarTab() {
  const [areas, setAreas] = useState<DatasetArea[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<{ owner: string; repo: string; release: DatasetRelease } | null>(null);

  useEffect(() => {
    fetchJson<{ areas: DatasetArea[] }>("/api/datasets").then((r) => setAreas(r.data?.areas ?? []));
  }, []);

  async function install(owner: string, repo: string, release: DatasetRelease, forceInstall: boolean) {
    setStatus("Instalando…");
    const { ok, data } = await fetchJson("/api/datasets/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner, repo, tag: release.tag, forceInstall }),
    });
    if (!ok && (data as { compatible?: boolean })?.compatible === false && !forceInstall) {
      setPendingInstall({ owner, repo, release });
      setStatus(null);
      return;
    }
    setStatus(ok ? "Instalado" : (data as { error?: string })?.error ?? "No se pudo instalar");
  }

  return (
    <div>
      {status && <div className="mb-3 text-xs text-muted">{status}</div>}
      {areas.map((area) => (
        <FloatingCard key={`${area.owner}/${area.repo}`} className="mb-3 overflow-hidden">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="text-[13.5px] font-medium text-fg">{area.repo}</div>
            <div className="text-[11px] text-subtle">github.com/{area.owner}/{area.repo} · {area.releases.length} release{area.releases.length === 1 ? "" : "s"}</div>
          </div>
          {area.releases.map((release) => (
            <ReleaseRow
              key={release.tag}
              owner={area.owner}
              repo={area.repo}
              release={release}
              onInstall={(o, r, rel) => install(o, r, rel, false)}
            />
          ))}
        </FloatingCard>
      ))}
      {pendingInstall && (
        <MismatchDialog
          release={pendingInstall.release}
          onCancel={() => setPendingInstall(null)}
          onConfirm={() => {
            const { owner, repo, release } = pendingInstall;
            setPendingInstall(null);
            install(owner, repo, release, true);
          }}
        />
      )}
    </div>
  );
}

function PublicarTab() {
  const [areaId, setAreaId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function publish() {
    setStatus("Publicando…");
    const { ok, data } = await fetchJson("/api/datasets/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ areaId, title, description, owner, repo }),
    });
    setStatus(ok ? "Publicado" : (data as { error?: string })?.error ?? "No se pudo publicar");
  }

  return (
    <FloatingCard className="p-5">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted">ID del área indexada</label>
          <input value={areaId} onChange={(e) => setAreaId(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Título</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Descripción</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Repositorio destino (owner/repo)</label>
          <div className="flex gap-2">
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner"
              className="w-1/2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo"
              className="w-1/2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
          </div>
        </div>
        <div className="rounded-md border border-dashed border-white/22 bg-white/[.03] px-3 py-2 text-xs text-muted">
          🔒 Se publicará etiquetado con tu modelo de retrieval activo ahora mismo (no editable).
        </div>
        <div className="flex items-start gap-2 rounded-md border border-[rgba(163,51,51,0.4)] bg-[rgba(163,51,51,0.08)] px-3 py-2.5 text-[11.5px] text-danger-fg">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5" />
          <span>
            Entiendo que publicar contenido de Street View reempaquetado a otros usuarios puede infringir los
            Términos de Servicio de Google Maps Platform (ver docs/PROOF_OF_CONCEPT.md §3.1) y asumo esa responsabilidad.
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={publish}
            disabled={!accepted || !areaId || !title || !description || !owner || !repo}
            className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black disabled:opacity-50"
          >
            Publicar
          </button>
          {status && <span className="text-xs text-muted">{status}</span>}
        </div>
      </div>
    </FloatingCard>
  );
}

export function DatasetsCatalogPanel() {
  const [tab, setTab] = useState<"explorar" | "publicar">("explorar");
  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-white/10">
        {(["explorar", "publicar"] as const).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-[12.5px] ${tab === id ? "border-b-2 border-accent font-medium text-fg" : "text-muted hover:text-fg"}`}
          >
            {id === "explorar" ? "Explorar" : "Publicar"}
          </button>
        ))}
      </div>
      {tab === "explorar" ? <ExplorarTab /> : <PublicarTab />}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/DatasetsCatalogPanel.tsx
git commit -m "feat(web): add DatasetsCatalogPanel (Explorar/Publicar) matching the approved mockup"
```

---

### Task 18: Wire `DatasetsCatalogPanel` into Settings as a new tab

**Files:**
- Modify: `apps/web/app/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `DatasetsCatalogPanel` (Task 17).

- [ ] **Step 1: Add the import**

In `apps/web/app/components/SettingsPanel.tsx`, add to the imports (alongside `AreasManagePanel`):

```ts
import { DatasetsCatalogPanel } from "./DatasetsCatalogPanel";
```

- [ ] **Step 2: Add a "Datasets" tab entry and icon**

Add this entry to the `SECTION_ICON` map (alongside `areas`):

```ts
  "datasets": svg(<><path d="M12 3c4.4 0 8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6c0-1.7 3.6-3 8-3Z" /><path d="M4 6c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>, "#7edca4"),
```

Change the `tabItems` array from:

```ts
  const tabItems = [
    ...groups.map(({ section }) => ({ id: section.id, label: section.title, icon: SECTION_ICON[section.id] })),
    { id: "areas", label: "Áreas", icon: SECTION_ICON.areas },
  ];
```

to:

```ts
  const tabItems = [
    ...groups.map(({ section }) => ({ id: section.id, label: section.title, icon: SECTION_ICON[section.id] })),
    { id: "areas", label: "Áreas", icon: SECTION_ICON.areas },
    { id: "datasets", label: "Datasets publicados", icon: SECTION_ICON.datasets },
  ];
```

- [ ] **Step 3: Render the panel when the tab is active**

Find the conditional that renders `AreasManagePanel` (`{activeTab === "areas" ? (<AreasManagePanel />) : (...)}`) and change it to also handle `"datasets"`:

```tsx
{activeTab === "areas" ? (
  <AreasManagePanel />
) : activeTab === "datasets" ? (
  <DatasetsCatalogPanel />
) : (
```

(Keep the existing final `)}` and whatever schema-driven rendering branch was already there for the `else` case — this only adds one more branch before it.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run the dev stack (`python3 tools/build.py`), open `/settings`, click the new "Datasets publicados" tab. Confirm: Explorar shows the empty-state (no repos yet) without crashing; Publicar's fields are all editable and the publish button stays disabled until every field is filled and the ToS checkbox is checked. Set a real `GITHUB_TOKEN` and `RETRIEVAL_MODEL` in Settings, publish a real small indexed area to a throwaway test repo, confirm the release appears on GitHub with `bundle.zip.enc`/`metadata.json.enc` assets and the `lumi-dataset` topic; reload Explorar and confirm it shows up with a green "Compatible" badge; install it and confirm the area appears with its embeddings intact. Then change `RETRIEVAL_MODEL` to a different (test-only) registry entry, publish the same area again, confirm a second release appears in the same repo, and confirm installing it (with the original model still active) shows the amber badge, prompts the mismatch dialog, and after confirming, the area appears as "indexing" and flips to "indexed" once the `embed-pending-images` job finishes — with no new Street View API usage recorded.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/SettingsPanel.tsx
git commit -m "feat(web): add a Datasets publicados tab to Settings"
```

---

## Self-Review Notes

- **Spec coverage:** model registry `version` field (Task 1); `GITHUB_TOKEN` setting (Task 2); Buffer-accepting crypto (Task 3); `captureImagePath` path-traversal fix (Task 4); manifest types + strict validator including unknown-model-id and embedding-length checks (Task 5); compatibility check (Task 6); bundle size caps + image sniffing (Task 7); GitHub REST client covering repo/topic/release/asset operations (Task 8); shared key, active-model resolution, and the extracted (DRY) zip builder used by both the existing export route and publish (Task 9); new job name/payload (Task 10); worker DB queries scoped to `embedding IS NULL AND image_path IS NOT NULL` (Task 11); the `embedPendingImages` job itself, explicitly not reusing `index-area.ts`'s dedup-skip behavior (Task 12); wiring into both queues (Task 13); publish route with GitHub upload + release-tag convention (Task 14); discovery route grouping releases by repo with per-release compatibility badges (Task 15); install route with the pre-download compatibility check, the two-path decision, staged validation, and auto-enqueue of the embed job (Task 16); Explorar/Publicar UI matching the approved mockup, including the mismatch dialog and the read-only model-tag indicator on Publicar (Task 17); Settings tab wiring, adapted from "popup" to this codebase's actual tab convention as noted in Global Constraints (Task 18). All spec sections covered.
- **Placeholder scan:** none — every step has complete, runnable code and exact commands/expected output.
- **Type consistency:** `ModelTag` (Task 5) is defined once and reused verbatim by `compatibility.ts` (Task 6), `active-model.ts`/`export-bundle.ts` (Task 9), and every route (Tasks 14-16) — no renamed fields (`id`/`version`/`embeddingDim` throughout). `DatasetMetadata`'s `model`/`stats` shape (Task 5) matches exactly what Task 14 writes and Task 15/16 read back. `EmbedPendingImagesJobPayload`/`EMBED_PENDING_IMAGES_JOB_NAME` (Task 10) are consumed with identical names in Tasks 11-13. `PendingEmbedImage`/`getPendingEmbedImages`/`updateImageEmbeddings` (Task 11) match the parameter names `EmbedPendingImagesJobDeps` (Task 12) expects. `BUNDLE_ASSET_NAME`/`METADATA_ASSET_NAME` (Task 5) are the exact same two string constants used by publish (Task 14), discovery (Task 15), and install (Task 16) — no asset-name string is hand-typed differently in any of the three.
