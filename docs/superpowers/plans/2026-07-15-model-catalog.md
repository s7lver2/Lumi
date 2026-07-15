# Model Catalog (Epic B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the project owner publish a new `services/inference` code version to a GitHub-backed catalog — gated by a mandatory local benchmark — browse published versions with their benchmark results, and install a different version via a narrow, catalog-scoped code-swap + restart (never a general app updater).

**Architecture:** A benchmark suite runs real estimate+cluster against a deterministically-selected set of the owner's own already-indexed images (leave-one-out, so it can't trivially match itself), scoring location accuracy. Publishing zips `services/inference`'s `.py` files + `requirements.txt`, encrypts them plus a results manifest, and uploads both as GitHub Release assets (same pattern as the dataset catalog: topic search for discovery, repo write-access as the entire authorization boundary — reused as a deliberately-duplicated local copy, not a cross-plan import, since this plan may run before or after the dataset-catalog plan). Installing stages the download, backs up the current code, swaps files, conditionally reinstalls dependencies, and restarts the inference service by reusing the low-VRAM-mode epic's `killProcessOnPort`/`restart-inference` mechanism — auto-restoring the backup if the restart never comes back healthy.

**Tech Stack:** Next.js API routes (Node runtime), `jszip`, Node's built-in `crypto` (AES-256-GCM via `@netryx/settings-repo`), `pg`, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-15-model-catalog-design.md` — read it before starting.
- **No general app-update system** — every step here only ever swaps `services/inference`'s own files, triggered manually from the catalog UI. Nothing here runs automatically or in the background.
- No real weight-file distribution — a release is a code + manifest bundle, never a weights file (no model here has custom weights).
- Publishing is owner-only via GitHub repo write access — no new auth system, same boundary the dataset catalog already established.
- **Deliberate, disclosed duplication:** `apps/web/lib/model-catalog/github.ts` (Task 1) duplicates the GitHub REST client the dataset-catalog plan (`docs/superpowers/plans/2026-07-14-dataset-catalog.md`, Task 8) also builds, rather than importing a shared module — these two plans may be executed independently and in either order, and a cross-plan file dependency would be fragile. If both plans are eventually implemented, unifying them into one shared client is a reasonable future cleanup, not required by either plan.
- "Fixed reference set" (spec's benchmark section) is interpreted as **deterministically selected from this install's own local data** (`ORDER BY created_at, id LIMIT N`), not a hardcoded fixture — a hardcoded set of specific image ids couldn't work across different self-hosted installs, each with entirely different indexed data.
- All new user-facing copy is in Spanish, matching the rest of the app.
- Follow existing conventions: route tests mock imported lib modules via `vi.mock` (see `apps/web/app/api/health/route.test.ts`); the model-catalog manifest validator follows `validateDatasetManifest`'s strict, descriptive-error style (not yet implemented in this worktree, but specified in the dataset-catalog plan — this plan's validator is written fresh, following the same style, not importing it).

---

### Task 1: Model-catalog GitHub Releases client

**Files:**
- Create: `apps/web/lib/model-catalog/github.ts`
- Create: `apps/web/lib/model-catalog/github.test.ts`

**Interfaces:**
- Produces: `GithubReleaseAsset`, `GithubRelease`, `ensureRepoWithTopic(owner, repo, token): Promise<void>`, `upsertRelease(owner, repo, tag, title, assets, token): Promise<void>`, `listReleasesForRepo(owner, repo): Promise<GithubRelease[]>`, `searchRepositoriesByTopic(topic): Promise<{owner, repo}[]>`, `downloadReleaseAsset(assetApiUrl, token?): Promise<Buffer>` — Tasks 7, 8, 10 all import from this file.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/model-catalog/github.test.ts
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
  it("creates the repo if missing, then adds the topic without dropping existing ones", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string });
      if (url.endsWith("/repos/inigo/lumi-model-catalog")) return { status: 404, ok: false } as Response;
      if (url.endsWith("/user/repos")) return { ok: true, status: 201 } as Response;
      if (url.endsWith("/topics") && !init?.method) return { ok: true, json: async () => ({ names: [] }) } as Response;
      if (url.endsWith("/topics") && init?.method === "PUT") return { ok: true, status: 200 } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    }));

    await ensureRepoWithTopic("inigo", "lumi-model-catalog", "tok");

    const topicsPut = calls.find((c) => c.url.endsWith("/topics") && c.method === "PUT");
    expect(JSON.parse(topicsPut!.body!).names).toEqual(["lumi-model-catalog"]);
  });
});

describe("upsertRelease", () => {
  it("deletes an existing release with the same tag before creating a fresh one, then uploads assets", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      if (url.includes("/releases/tags/lumi-preview-v1.1")) return { ok: true, json: async () => ({ id: 999 }) } as Response;
      if (url.includes("/releases/999") && init?.method === "DELETE") return { ok: true } as Response;
      if (url.endsWith("/releases") && init?.method === "POST") {
        return { ok: true, json: async () => ({ upload_url: "https://uploads.github.com/repos/inigo/lumi-model-catalog/releases/1000/assets{?name,label}" }) } as Response;
      }
      if (url.includes("uploads.github.com") && init?.method === "POST") return { ok: true } as Response;
      throw new Error(`unexpected fetch: ${url} ${init?.method}`);
    }));

    await upsertRelease(
      "inigo", "lumi-model-catalog", "lumi-preview-v1.1", "Lumi Preview v1.1",
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
        { tag_name: "lumi-preview-v1.0", name: "Lumi Preview v1.0", body: "", assets: [{ name: "code.zip.enc", url: "https://api.github.com/a/1" }] },
      ]),
    } as Response)));

    expect(await listReleasesForRepo("inigo", "lumi-model-catalog")).toEqual([
      { tagName: "lumi-preview-v1.0", name: "Lumi Preview v1.0", body: "", assets: [{ name: "code.zip.enc", url: "https://api.github.com/a/1" }] },
    ]);
  });
});

describe("searchRepositoriesByTopic", () => {
  it("maps search results to owner/repo pairs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [{ owner: { login: "inigo" }, name: "lumi-model-catalog" }] }),
    } as Response)));

    expect(await searchRepositoriesByTopic("lumi-model-catalog")).toEqual([{ owner: "inigo", repo: "lumi-model-catalog" }]);
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

Run: `pnpm --filter @netryx/web test lib/model-catalog/github`
Expected: FAIL — `Cannot find module './github'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/model-catalog/github.ts

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
  if (!current.includes("lumi-model-catalog")) {
    await fetch(`${GITHUB_API}/repos/${owner}/${repo}/topics`, {
      method: "PUT",
      headers: { ...authHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ names: [...current, "lumi-model-catalog"] }),
    });
  }
}

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

export async function downloadReleaseAsset(assetApiUrl: string, token?: string): Promise<Buffer> {
  const headers: Record<string, string> = { accept: "application/octet-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(assetApiUrl, { headers });
  if (!res.ok) throw new Error(`Failed to download asset: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/model-catalog/github`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/model-catalog/github.ts apps/web/lib/model-catalog/github.test.ts
git commit -m "feat(web): add model-catalog GitHub Releases client"
```

---

### Task 2: `excludeIndexedImageId` on `retrieveCandidates`

**Files:**
- Modify: `apps/web/lib/search/retrieval.ts`
- Create: `apps/web/lib/search/retrieval.test.ts`

**Interfaces:**
- Produces: `retrieveCandidates(pool, queryEmbedding, k, excludeIndexedImageId?: string): Promise<RetrievedCandidate[]>` — Task 5's benchmark scorer calls this with the case's own id excluded.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/search/retrieval.test.ts
import { describe, it, expect, vi } from "vitest";
import { retrieveCandidates } from "./retrieval";

function makePool(perHeadingRows: any[], aggregateRows: any[] = []) {
  return {
    query: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes("FROM indexed_images") && sql.includes("ORDER BY embedding")) {
        return { rows: perHeadingRows.filter((r) => params[2] == null || r.id !== params[2]) };
      }
      if (sql.includes("FROM (")) return { rows: aggregateRows };
      throw new Error(`unexpected query: ${sql}`);
    }),
  } as any;
}

describe("retrieveCandidates with excludeIndexedImageId", () => {
  it("excludes the given id from the per-heading result set", async () => {
    const pool = makePool([
      { id: "img-1", pano_id: "p1", heading: 0, lat: "0", lng: "0", similarity: "0.9", embedding_text: "[0.1,0.2]" },
      { id: "img-2", pano_id: "p2", heading: 0, lat: "0", lng: "0", similarity: "0.8", embedding_text: "[0.1,0.2]" },
    ]);

    const results = await retrieveCandidates(pool, [0.1, 0.2], 10, "img-1");
    expect(results.map((r) => r.indexedImageId)).toEqual(["img-2"]);
  });

  it("includes everything when no id is excluded (unchanged default behavior)", async () => {
    const pool = makePool([
      { id: "img-1", pano_id: "p1", heading: 0, lat: "0", lng: "0", similarity: "0.9", embedding_text: "[0.1,0.2]" },
    ]);
    const results = await retrieveCandidates(pool, [0.1, 0.2], 10);
    expect(results).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @netryx/web test lib/search/retrieval`
Expected: FAIL — the 4th argument doesn't exist yet / exclusion isn't applied.

- [ ] **Step 3: Add the parameter**

In `apps/web/lib/search/retrieval.ts`, change the function signature and both queries. Change:

```ts
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
```

to:

```ts
export async function retrieveCandidates(
  pool: Pool,
  queryEmbedding: number[],
  k: number,
  excludeIndexedImageId?: string
): Promise<RetrievedCandidate[]> {
  const q = toVectorLiteral(queryEmbedding);
  const excludeId = excludeIndexedImageId ?? null;

  const perHeading = await pool.query(
    `SELECT id, pano_id, heading,
            ST_Y(location::geometry) AS lat,
            ST_X(location::geometry) AS lng,
            1 - (embedding <=> $1) AS similarity,
            embedding::text AS embedding_text
     FROM indexed_images
     WHERE embedding IS NOT NULL AND ($3::uuid IS NULL OR id <> $3)
     ORDER BY embedding <=> $1
     LIMIT $2`,
    [q, k, excludeId]
  );
```

Then change the aggregate query's outer `WHERE` clause from:

```ts
     JOIN indexed_images img ON img.pano_id = near_panos.pano_id
     WHERE img.embedding IS NOT NULL`,
    [q, k]
  );
```

to:

```ts
     JOIN indexed_images img ON img.pano_id = near_panos.pano_id
     WHERE img.embedding IS NOT NULL AND ($3::uuid IS NULL OR img.id <> $3)`,
    [q, k, excludeId]
  );
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @netryx/web test lib/search/retrieval`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors (the existing caller in the estimate route passes only 3 args, which stays valid since the 4th is optional).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/search/retrieval.ts apps/web/lib/search/retrieval.test.ts
git commit -m "feat(web): add optional excludeIndexedImageId to retrieveCandidates"
```

---

### Task 3: `MODEL_CATALOG_REPO` setting

**Files:**
- Modify: `packages/shared-types/src/settings.ts`
- Modify: `packages/shared-types/src/settings.test.ts`
- Modify: `apps/web/app/settings/sections.ts`

**Interfaces:**
- Produces: `SETTINGS_SCHEMA` entry `MODEL_CATALOG_REPO` (`owner/repo` string, optional) — Task 7/8/10's routes read it via `getSettingsRepo().getSetting("MODEL_CATALOG_REPO")`.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared-types/src/settings.test.ts`:

```ts
describe("MODEL_CATALOG_REPO setting", () => {
  it("is an optional, non-secret string for the model catalog's GitHub repo", () => {
    const def = SETTINGS_SCHEMA.find((s) => s.key === "MODEL_CATALOG_REPO")!;
    expect(def).toBeDefined();
    expect(def.type).toBe("string");
    expect(def.isSecret).toBe(false);
    expect(def.required).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @netryx/shared-types test settings`
Expected: FAIL — `def` is `undefined`.

- [ ] **Step 3: Add the setting**

In `packages/shared-types/src/settings.ts`, add this entry to `SETTINGS_SCHEMA` (right after `GITHUB_TOKEN`, if present from the dataset-catalog plan; otherwise right after `MAPBOX_TOKEN`):

```ts
  {
    key: "MODEL_CATALOG_REPO",
    label: "Repositorio del catálogo de modelos (owner/repo)",
    type: "string",
    isSecret: false,
    required: false,
  },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @netryx/shared-types test settings`
Expected: PASS.

- [ ] **Step 5: Assign the key to a section**

`apps/web/app/settings/sections.ts`'s `groupSettings()` throws if any schema key is unassigned. Add `"MODEL_CATALOG_REPO"` to the `"models"` section's `keys` array (same section as `RETRIEVAL_MODEL`/`INFERENCE_RUNTIME`).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-types/src/settings.ts packages/shared-types/src/settings.test.ts apps/web/app/settings/sections.ts
git commit -m "feat(settings): add MODEL_CATALOG_REPO setting"
```

---

### Task 4: Shared key + manifest types/validator

**Files:**
- Create: `apps/web/lib/model-catalog/shared-key.ts`
- Create: `apps/web/lib/model-catalog/manifest.ts`
- Create: `apps/web/lib/model-catalog/manifest.test.ts`

**Interfaces:**
- Produces: `MODEL_CATALOG_SHARED_KEY: Buffer`, `BUNDLE_CODE_ASSET_NAME`, `MODEL_CATALOG_METADATA_ASSET_NAME`, `ModelCatalogManifest`, `validateModelCatalogManifest(data: unknown): ModelCatalogManifest` — Tasks 7, 8, 10 all import from this file.

- [ ] **Step 1: Add the shared key**

```ts
// apps/web/lib/model-catalog/shared-key.ts

/**
 * ONE key, built into the app itself, the same on every Lumi install —
 * intentionally a SEPARATE constant from the dataset catalog's own shared
 * key (different trust surface: owner-only publish here vs. community
 * publish there — no reason to share a key just because the encryption
 * mechanism is the same code). Same "obfuscation, not a security boundary"
 * caveat applies (spec's Architecture section).
 */
export const MODEL_CATALOG_SHARED_KEY = Buffer.from(
  "R7hN2vLpQeK9wXmZ1sYtUiOaFdCbGjHk6nRlVzTq8yA=",
  "base64"
);
```

- [ ] **Step 2: Write the failing tests for the manifest validator**

```ts
// apps/web/lib/model-catalog/manifest.test.ts
import { describe, it, expect } from "vitest";
import { validateModelCatalogManifest } from "./manifest";

function validManifest() {
  return {
    bundleId: "lumi-preview",
    version: "1.1",
    backbones: [
      { name: "MegaLoc", source: "torch.hub:gmberton/MegaLoc" },
      { name: "RoMa", source: "pip:romatch" },
    ],
    benchmark: { accuracyWithin50m: 0.89, avgDistanceM: 8.1, sampleCount: 20, ranAt: "2026-07-15T10:00:00.000Z" },
    description: "Better re-ranking.",
  };
}

describe("validateModelCatalogManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validateModelCatalogManifest(validManifest());
    expect(result.bundleId).toBe("lumi-preview");
    expect(result.benchmark.accuracyWithin50m).toBe(0.89);
  });

  it("rejects a manifest missing the benchmark field entirely", () => {
    const manifest = validManifest() as any;
    delete manifest.benchmark;
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/benchmark/);
  });

  it("rejects a manifest whose backbones isn't an array", () => {
    const manifest = validManifest() as any;
    manifest.backbones = "not-an-array";
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/backbones/);
  });

  it("rejects a non-object top level", () => {
    expect(() => validateModelCatalogManifest(null)).toThrow();
    expect(() => validateModelCatalogManifest("nope")).toThrow();
  });

  it("rejects a missing bundleId/version", () => {
    const manifest = validManifest() as any;
    delete manifest.bundleId;
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/bundleId/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/model-catalog/manifest`
Expected: FAIL — `Cannot find module './manifest'`.

- [ ] **Step 4: Write the implementation**

```ts
// apps/web/lib/model-catalog/manifest.ts

export const BUNDLE_CODE_ASSET_NAME = "code.zip.enc";
export const MODEL_CATALOG_METADATA_ASSET_NAME = "metadata.json.enc";

export interface BackboneReference {
  name: string;
  source: string;
}

export interface ModelCatalogBenchmark {
  accuracyWithin50m: number;
  avgDistanceM: number;
  sampleCount: number;
  ranAt: string;
}

export interface ModelCatalogManifest {
  bundleId: string;
  version: string;
  backbones: BackboneReference[];
  benchmark: ModelCatalogBenchmark;
  description: string;
}

/**
 * Strictly validates a decrypted model-catalog manifest — same discipline
 * as the dataset catalog's own manifest validator (spec's Architecture
 * section): reject malformed/missing fields outright, never return a
 * partially-valid result.
 */
export function validateModelCatalogManifest(data: unknown): ModelCatalogManifest {
  if (typeof data !== "object" || data === null) {
    throw new Error("manifest must be an object");
  }
  const raw = data as Record<string, unknown>;

  if (typeof raw.bundleId !== "string" || raw.bundleId.length === 0) {
    throw new Error("manifest.bundleId must be a non-empty string");
  }
  if (typeof raw.version !== "string" || raw.version.length === 0) {
    throw new Error("manifest.version must be a non-empty string");
  }
  if (!Array.isArray(raw.backbones)) {
    throw new Error("manifest.backbones must be an array");
  }
  const backbones: BackboneReference[] = raw.backbones.map((b, i) => {
    if (typeof b !== "object" || b === null) throw new Error(`manifest.backbones[${i}] must be an object`);
    const entry = b as Record<string, unknown>;
    if (typeof entry.name !== "string" || typeof entry.source !== "string") {
      throw new Error(`manifest.backbones[${i}] must have string name/source`);
    }
    return { name: entry.name, source: entry.source };
  });

  if (typeof raw.benchmark !== "object" || raw.benchmark === null) {
    throw new Error("manifest.benchmark is required");
  }
  const benchmarkRaw = raw.benchmark as Record<string, unknown>;
  if (
    typeof benchmarkRaw.accuracyWithin50m !== "number" ||
    typeof benchmarkRaw.avgDistanceM !== "number" ||
    typeof benchmarkRaw.sampleCount !== "number" ||
    typeof benchmarkRaw.ranAt !== "string"
  ) {
    throw new Error("manifest.benchmark has missing or wrongly-typed fields");
  }

  return {
    bundleId: raw.bundleId,
    version: raw.version,
    backbones,
    benchmark: {
      accuracyWithin50m: benchmarkRaw.accuracyWithin50m,
      avgDistanceM: benchmarkRaw.avgDistanceM,
      sampleCount: benchmarkRaw.sampleCount,
      ranAt: benchmarkRaw.ranAt,
    },
    description: typeof raw.description === "string" ? raw.description : "",
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/model-catalog/manifest`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/model-catalog/shared-key.ts apps/web/lib/model-catalog/manifest.ts apps/web/lib/model-catalog/manifest.test.ts
git commit -m "feat(web): add model-catalog shared key and manifest validator"
```

---

### Task 5: Reference-set builder + benchmark scorer

**Files:**
- Create: `apps/web/lib/model-catalog/benchmark.ts`
- Create: `apps/web/lib/model-catalog/benchmark.test.ts`

**Interfaces:**
- Consumes: `retrieveCandidates` (Task 2), `clusterCandidates` (`../search/cluster`, unchanged), `DEFAULT_TOP_K`/`DEFAULT_REGION_RADIUS_M` (`@netryx/shared-types`).
- Produces: `BenchmarkCase`, `BenchmarkDeps`, `BENCHMARK_ACCURACY_THRESHOLD`, `BENCHMARK_DISTANCE_THRESHOLD_M`, `buildReferenceSet(pool, count): Promise<BenchmarkCase[]>`, `runBenchmark(cases, deps): Promise<ModelCatalogBenchmark>`, `passesBenchmarkThreshold(result): boolean` — Task 7's publish route calls all of these in sequence.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/model-catalog/benchmark.test.ts
import { describe, it, expect, vi } from "vitest";
import { runBenchmark, passesBenchmarkThreshold, buildReferenceSet, BENCHMARK_ACCURACY_THRESHOLD } from "./benchmark";
import type { BenchmarkCase, BenchmarkDeps } from "./benchmark";

function makePool(rows: any[]) {
  return { query: vi.fn(async () => ({ rows })) } as any;
}

describe("buildReferenceSet", () => {
  it("selects up to `count` rows deterministically from local indexed images", async () => {
    const pool = makePool([
      { id: "img-1", image_path: "/data/a.jpg", lat: "40.0", lng: "-3.0" },
      { id: "img-2", image_path: "/data/b.jpg", lat: "41.0", lng: "-4.0" },
    ]);
    const cases = await buildReferenceSet(pool, 2);
    expect(cases).toEqual([
      { indexedImageId: "img-1", imagePath: "/data/a.jpg", trueLat: 40.0, trueLng: -3.0 },
      { indexedImageId: "img-2", imagePath: "/data/b.jpg", trueLat: 41.0, trueLng: -4.0 },
    ]);
  });
});

function makeDeps(overrides: Partial<BenchmarkDeps> = {}): BenchmarkDeps {
  return {
    readImageBase64: vi.fn().mockResolvedValue("ZmFrZQ=="),
    embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
    retrieve: vi.fn().mockResolvedValue([
      { indexedImageId: "other", panoId: "p2", heading: 0, lat: 40.0001, lng: -3.0001, similarity: 0.9, embedding: [0.1, 0.2] },
    ]),
    ...overrides,
  };
}

describe("runBenchmark", () => {
  it("scores each case's distance from the top clustered region to the true location", async () => {
    const cases: BenchmarkCase[] = [{ indexedImageId: "img-1", imagePath: "/data/a.jpg", trueLat: 40.0, trueLng: -3.0 }];
    const result = await runBenchmark(cases, makeDeps());

    expect(result.sampleCount).toBe(1);
    expect(result.accuracyWithin50m).toBe(1); // ~11m away, within 50m
    expect(result.avgDistanceM).toBeGreaterThan(0);
    expect(typeof result.ranAt).toBe("string");
  });

  it("scores 0 accuracy when retrieval returns nothing (Infinity distance)", async () => {
    const cases: BenchmarkCase[] = [{ indexedImageId: "img-1", imagePath: "/data/a.jpg", trueLat: 40.0, trueLng: -3.0 }];
    const result = await runBenchmark(cases, makeDeps({ retrieve: vi.fn().mockResolvedValue([]) }));
    expect(result.accuracyWithin50m).toBe(0);
  });

  it("calls retrieve with the case's own id excluded (leave-one-out)", async () => {
    const deps = makeDeps();
    const cases: BenchmarkCase[] = [{ indexedImageId: "img-1", imagePath: "/data/a.jpg", trueLat: 40.0, trueLng: -3.0 }];
    await runBenchmark(cases, deps);
    expect(deps.retrieve).toHaveBeenCalledWith([0.1, 0.2], "img-1");
  });
});

describe("passesBenchmarkThreshold", () => {
  it("passes at or above the threshold, fails below it", () => {
    expect(passesBenchmarkThreshold({ accuracyWithin50m: BENCHMARK_ACCURACY_THRESHOLD, avgDistanceM: 1, sampleCount: 1, ranAt: "x" })).toBe(true);
    expect(passesBenchmarkThreshold({ accuracyWithin50m: BENCHMARK_ACCURACY_THRESHOLD - 0.01, avgDistanceM: 1, sampleCount: 1, ranAt: "x" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/model-catalog/benchmark`
Expected: FAIL — `Cannot find module './benchmark'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/model-catalog/benchmark.ts
import type { Pool } from "pg";
import { DEFAULT_TOP_K, DEFAULT_REGION_RADIUS_M } from "@netryx/shared-types";
import { clusterCandidates } from "../search/cluster";
import type { RetrievedCandidate } from "../search/retrieval";
import type { ModelCatalogBenchmark } from "./manifest";

export const BENCHMARK_ACCURACY_THRESHOLD = 0.7;
export const BENCHMARK_DISTANCE_THRESHOLD_M = 50;
const DEFAULT_REFERENCE_SET_SIZE = 20;

export interface BenchmarkCase {
  indexedImageId: string;
  imagePath: string;
  trueLat: number;
  trueLng: number;
}

export interface BenchmarkDeps {
  readImageBase64: (imagePath: string) => Promise<string>;
  embedQuery: (imageBase64: string) => Promise<number[]>;
  retrieve: (embedding: number[], excludeIndexedImageId: string) => Promise<RetrievedCandidate[]>;
}

/**
 * Deterministically selects up to `count` already-indexed images from THIS
 * install's own data as the benchmark reference set (spec's "fixed
 * reference set" — interpreted as "stable across runs on this install",
 * not a hardcoded fixture, since every self-hosted install has entirely
 * different indexed data). Ordered by created_at/id so re-running the
 * benchmark later (as long as the underlying rows haven't changed) picks
 * the same cases.
 */
export async function buildReferenceSet(pool: Pool, count: number = DEFAULT_REFERENCE_SET_SIZE): Promise<BenchmarkCase[]> {
  const { rows } = await pool.query(
    `SELECT id, image_path, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
     FROM indexed_images
     WHERE embedding IS NOT NULL AND image_path IS NOT NULL
     ORDER BY created_at, id
     LIMIT $1`,
    [count]
  );
  return rows.map((r) => ({
    indexedImageId: r.id,
    imagePath: r.image_path,
    trueLat: Number(r.lat),
    trueLng: Number(r.lng),
  }));
}

function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Scores each reference case using real embed + retrieve + cluster
 * (leave-one-out via retrieve's excludeIndexedImageId), comparing the top
 * clustered region's centroid to the case's known-true location. Uses
 * retrieval+clustering only, not a full refine pass, to keep this
 * runnable as part of the publish flow itself (RoMa verification is
 * 10-25s/candidate — too slow to run per benchmark case here); this can
 * be extended to include refine later without changing the pass/fail
 * mechanism (spec's benchmark section, implementation note).
 */
export async function runBenchmark(cases: BenchmarkCase[], deps: BenchmarkDeps): Promise<ModelCatalogBenchmark> {
  let withinThreshold = 0;
  let totalDistance = 0;

  for (const c of cases) {
    const imageBase64 = await deps.readImageBase64(c.imagePath);
    const embedding = await deps.embedQuery(imageBase64);
    const candidates = await deps.retrieve(embedding, c.indexedImageId);
    const regions = clusterCandidates(candidates, DEFAULT_REGION_RADIUS_M);
    const top = regions[0];
    const distance = top ? haversineDistanceM(c.trueLat, c.trueLng, top.centroid.lat, top.centroid.lng) : Infinity;
    if (distance <= BENCHMARK_DISTANCE_THRESHOLD_M) withinThreshold++;
    totalDistance += distance;
  }

  return {
    accuracyWithin50m: cases.length > 0 ? withinThreshold / cases.length : 0,
    avgDistanceM: cases.length > 0 ? totalDistance / cases.length : 0,
    sampleCount: cases.length,
    ranAt: new Date().toISOString(),
  };
}

export function passesBenchmarkThreshold(result: ModelCatalogBenchmark): boolean {
  return result.accuracyWithin50m >= BENCHMARK_ACCURACY_THRESHOLD;
}
```

Note: `DEFAULT_TOP_K` is imported but not directly referenced in this file's own code — it's kept as an import to be threaded into `deps.retrieve`'s real implementation at the call site (Task 7's publish route builds the real `retrieve` dependency using `DEFAULT_TOP_K`, this file just defines the contract). Remove the unused import if your editor flags it — the actual publish route wiring in Task 7 is where `DEFAULT_TOP_K` gets used.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/model-catalog/benchmark`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/model-catalog/benchmark.ts apps/web/lib/model-catalog/benchmark.test.ts
git commit -m "feat(web): add model-catalog benchmark reference set + scorer"
```

---

### Task 6: Code-bundle builder

**Files:**
- Create: `apps/web/lib/model-catalog/code-bundle.ts`
- Create: `apps/web/lib/model-catalog/code-bundle.test.ts`

**Interfaces:**
- Produces: `buildInferenceCodeZip(inferenceDir: string): Promise<Uint8Array>` — Task 7's publish route calls this.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/model-catalog/code-bundle.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { buildInferenceCodeZip } from "./code-bundle";

let fakeInferenceDir: string;

beforeAll(async () => {
  fakeInferenceDir = await mkdtemp(join(tmpdir(), "lumi-fake-inference-"));
  await writeFile(join(fakeInferenceDir, "main.py"), "print('hello')");
  await writeFile(join(fakeInferenceDir, "requirements.txt"), "torch==2.0.0");
  await mkdir(join(fakeInferenceDir, "models"));
  await writeFile(join(fakeInferenceDir, "models", "registry.py"), "RETRIEVAL_MODELS = []");
  await mkdir(join(fakeInferenceDir, "venv"));
  await writeFile(join(fakeInferenceDir, "venv", "should-not-be-included.py"), "x = 1");
  await mkdir(join(fakeInferenceDir, "data"));
  await writeFile(join(fakeInferenceDir, "data", "should-not-be-included.bin"), "x");
});

afterAll(async () => {
  await rm(fakeInferenceDir, { recursive: true, force: true });
});

describe("buildInferenceCodeZip", () => {
  it("includes .py files and requirements.txt, excludes venv/ and data/", async () => {
    const zipBytes = await buildInferenceCodeZip(fakeInferenceDir);
    const zip = await JSZip.loadAsync(zipBytes);
    const names = Object.keys(zip.files);

    expect(names).toContain("main.py");
    expect(names).toContain("requirements.txt");
    expect(names).toContain("models/registry.py");
    expect(names.some((n) => n.includes("venv"))).toBe(false);
    expect(names.some((n) => n.includes("data"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @netryx/web test lib/model-catalog/code-bundle`
Expected: FAIL — `Cannot find module './code-bundle'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/model-catalog/code-bundle.ts
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import JSZip from "jszip";

const EXCLUDED_DIRS = new Set(["venv", "data", "__pycache__", ".pytest_cache"]);

async function collectFiles(dir: string, root: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await collectFiles(join(dir, entry.name), root, out);
      continue;
    }
    if (entry.name.endsWith(".py") || entry.name === "requirements.txt") {
      out.push(join(dir, entry.name));
    }
  }
}

/**
 * Zips services/inference's own wrapper code (spec's "Catalog manifest +
 * publish flow" section) — every .py file plus requirements.txt, never
 * venv/ (the installed dependencies themselves) or data/ (model weight
 * caches, indexed images) which are either huge, machine-specific, or
 * both.
 */
export async function buildInferenceCodeZip(inferenceDir: string): Promise<Uint8Array> {
  const filePaths: string[] = [];
  await collectFiles(inferenceDir, inferenceDir, filePaths);

  const zip = new JSZip();
  for (const filePath of filePaths) {
    const relPath = relative(inferenceDir, filePath).split(sep).join("/");
    zip.file(relPath, await readFile(filePath));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @netryx/web test lib/model-catalog/code-bundle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/model-catalog/code-bundle.ts apps/web/lib/model-catalog/code-bundle.test.ts
git commit -m "feat(web): add services/inference code-bundle zip builder"
```

---

### Task 7: `POST /api/model-catalog/publish`

**Files:**
- Create: `apps/web/app/api/model-catalog/publish/route.ts`
- Create: `apps/web/app/api/model-catalog/publish/route.test.ts`

**Interfaces:**
- Consumes: `buildReferenceSet`, `runBenchmark`, `passesBenchmarkThreshold` (Task 5); `buildInferenceCodeZip` (Task 6); `ensureRepoWithTopic`, `upsertRelease` (Task 1); `MODEL_CATALOG_SHARED_KEY`, `BUNDLE_CODE_ASSET_NAME`, `MODEL_CATALOG_METADATA_ASSET_NAME` (Task 4); `MODEL_BUNDLES` (`@netryx/shared-types`, from the Lumi Preview unification plan — if not yet implemented in this worktree, use `RETRIEVAL_MODELS[0]` as a fallback for `bundleId`/`version`, since they share the same id/version today).
- Produces: `POST(request): Promise<Response>` returning `{ tag, benchmark }` on success, `409` with `{ benchmark }` when the benchmark fails.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/api/model-catalog/publish/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn() }));
vi.mock("../../../../lib/model-catalog/benchmark", () => ({
  buildReferenceSet: vi.fn(),
  runBenchmark: vi.fn(),
  passesBenchmarkThreshold: vi.fn(),
}));
vi.mock("../../../../lib/model-catalog/code-bundle", () => ({ buildInferenceCodeZip: vi.fn() }));
vi.mock("../../../../lib/model-catalog/github", () => ({ ensureRepoWithTopic: vi.fn(), upsertRelease: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/model-catalog/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/model-catalog/publish", () => {
  it("400s when GITHUB_TOKEN or MODEL_CATALOG_REPO isn't configured", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue(null) });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ description: "d" }));
    expect(res.status).toBe(400);
  });

  it("409s with the benchmark result when it fails the threshold, uploading nothing", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({
      getSetting: vi.fn((key: string) => Promise.resolve(key === "GITHUB_TOKEN" ? "tok" : "inigo/lumi-model-catalog")),
    });
    const { buildReferenceSet, runBenchmark, passesBenchmarkThreshold } = await import("../../../../lib/model-catalog/benchmark");
    (buildReferenceSet as any).mockResolvedValue([{ indexedImageId: "i1", imagePath: "/a.jpg", trueLat: 0, trueLng: 0 }]);
    (runBenchmark as any).mockResolvedValue({ accuracyWithin50m: 0.2, avgDistanceM: 200, sampleCount: 1, ranAt: "x" });
    (passesBenchmarkThreshold as any).mockReturnValue(false);

    const { ensureRepoWithTopic } = await import("../../../../lib/model-catalog/github");
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ description: "d" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.benchmark.accuracyWithin50m).toBe(0.2);
    expect(ensureRepoWithTopic).not.toHaveBeenCalled();
  });

  it("publishes when the benchmark passes", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({
      getSetting: vi.fn((key: string) => Promise.resolve(key === "GITHUB_TOKEN" ? "tok" : "inigo/lumi-model-catalog")),
    });
    const { buildReferenceSet, runBenchmark, passesBenchmarkThreshold } = await import("../../../../lib/model-catalog/benchmark");
    (buildReferenceSet as any).mockResolvedValue([{ indexedImageId: "i1", imagePath: "/a.jpg", trueLat: 0, trueLng: 0 }]);
    (runBenchmark as any).mockResolvedValue({ accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 1, ranAt: "x" });
    (passesBenchmarkThreshold as any).mockReturnValue(true);

    const { buildInferenceCodeZip } = await import("../../../../lib/model-catalog/code-bundle");
    (buildInferenceCodeZip as any).mockResolvedValue(new Uint8Array([1, 2, 3]));

    const { ensureRepoWithTopic, upsertRelease } = await import("../../../../lib/model-catalog/github");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ description: "Better re-ranking" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tag).toBe("lumi-preview-v1.0");
    expect(ensureRepoWithTopic).toHaveBeenCalledWith("inigo", "lumi-model-catalog", "tok");
    expect(upsertRelease).toHaveBeenCalledWith(
      "inigo", "lumi-model-catalog", "lumi-preview-v1.0", "Lumi Preview v1.0",
      expect.arrayContaining([
        expect.objectContaining({ name: "code.zip.enc" }),
        expect.objectContaining({ name: "metadata.json.enc" }),
      ]),
      "tok"
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test app/api/model-catalog/publish`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/model-catalog/publish/route.ts
import { NextResponse } from "next/server";
import { RETRIEVAL_MODELS, DEFAULT_TOP_K } from "@netryx/shared-types";
import { getPool } from "../../../../lib/db";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { embedQueryImage } from "../../../../lib/inference-client";
import { retrieveCandidates } from "../../../../lib/search/retrieval";
import { buildReferenceSet, runBenchmark, passesBenchmarkThreshold } from "../../../../lib/model-catalog/benchmark";
import { buildInferenceCodeZip } from "../../../../lib/model-catalog/code-bundle";
import { ensureRepoWithTopic, upsertRelease } from "../../../../lib/model-catalog/github";
import { MODEL_CATALOG_SHARED_KEY } from "../../../../lib/model-catalog/shared-key";
import { BUNDLE_CODE_ASSET_NAME, MODEL_CATALOG_METADATA_ASSET_NAME, type ModelCatalogManifest } from "../../../../lib/model-catalog/manifest";
import { encryptBuffer } from "@netryx/settings-repo";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface PublishBody {
  description?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as PublishBody;
  const repo = getSettingsRepo();
  const token = await repo.getSetting("GITHUB_TOKEN");
  const catalogRepo = await repo.getSetting("MODEL_CATALOG_REPO");
  if (!token || !catalogRepo) {
    return NextResponse.json({ error: "GITHUB_TOKEN and MODEL_CATALOG_REPO must be configured in Settings first" }, { status: 400 });
  }

  const pool = getPool();
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

  const cases = await buildReferenceSet(pool);
  const benchmark = await runBenchmark(cases, {
    readImageBase64: async (imagePath) => (await readFile(imagePath)).toString("base64"),
    embedQuery: (imageBase64) => embedQueryImage(imageBase64, inferenceBaseUrl),
    retrieve: (embedding, excludeId) => retrieveCandidates(pool, embedding, DEFAULT_TOP_K, excludeId),
  });

  if (!passesBenchmarkThreshold(benchmark)) {
    return NextResponse.json({ benchmark }, { status: 409 });
  }

  const activeRetrievalModel = RETRIEVAL_MODELS[0];
  const bundleId = activeRetrievalModel?.id ?? "lumi-preview";
  const version = activeRetrievalModel?.version ?? "1.0";

  const inferenceDir = resolve(process.cwd(), "..", "services", "inference");
  const codeZip = await buildInferenceCodeZip(inferenceDir);

  const manifest: ModelCatalogManifest = {
    bundleId,
    version,
    backbones: [
      { name: "MegaLoc", source: "torch.hub:gmberton/MegaLoc" },
      { name: "RoMa", source: "pip:romatch" },
    ],
    benchmark,
    description: body.description ?? "",
  };

  const [owner, repoName] = catalogRepo.split("/");
  const tag = `${bundleId}-v${version}`;
  const title = `${activeRetrievalModel?.displayName ?? "Lumi Preview"} v${version}`;

  await ensureRepoWithTopic(owner, repoName, token);
  await upsertRelease(
    owner,
    repoName,
    tag,
    title,
    [
      { name: BUNDLE_CODE_ASSET_NAME, data: encryptBuffer(Buffer.from(codeZip), MODEL_CATALOG_SHARED_KEY) },
      { name: MODEL_CATALOG_METADATA_ASSET_NAME, data: encryptBuffer(Buffer.from(JSON.stringify(manifest)), MODEL_CATALOG_SHARED_KEY) },
    ],
    token
  );

  return NextResponse.json({ tag, benchmark }, { status: 200 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test app/api/model-catalog/publish`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/model-catalog/publish/route.ts apps/web/app/api/model-catalog/publish/route.test.ts
git commit -m "feat(web): add POST /api/model-catalog/publish with benchmark gate"
```

---

### Task 8: `GET /api/model-catalog`

**Files:**
- Create: `apps/web/app/api/model-catalog/route.ts`
- Create: `apps/web/app/api/model-catalog/route.test.ts`

**Interfaces:**
- Consumes: `searchRepositoriesByTopic`, `listReleasesForRepo`, `downloadReleaseAsset` (Task 1); `MODEL_CATALOG_METADATA_ASSET_NAME` (Task 4); `MODEL_CATALOG_SHARED_KEY` (Task 4); `RETRIEVAL_MODELS` (`@netryx/shared-types`).
- Produces: `GET(): Promise<Response>` returning `{ bundles: [{ owner, repo, releases: [{ tag, bundleId, version, backbones, benchmark, description, isActive }] }] }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/api/model-catalog/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/model-catalog/github", () => ({
  searchRepositoriesByTopic: vi.fn(),
  listReleasesForRepo: vi.fn(),
  downloadReleaseAsset: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/model-catalog", () => {
  it("groups releases by repo and marks the currently-active version", async () => {
    const github = await import("../../../lib/model-catalog/github");
    (github.searchRepositoriesByTopic as any).mockResolvedValue([{ owner: "inigo", repo: "lumi-model-catalog" }]);
    (github.listReleasesForRepo as any).mockResolvedValue([
      { tagName: "lumi-preview-v1.0", name: "x", body: "", assets: [{ name: "metadata.json.enc", url: "meta-1" }] },
      { tagName: "lumi-preview-v1.1", name: "x", body: "", assets: [{ name: "metadata.json.enc", url: "meta-2" }] },
    ]);

    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { MODEL_CATALOG_SHARED_KEY } = await import("../../../lib/model-catalog/shared-key");
    const metaA = { bundleId: "lumi-preview", version: "1.0", backbones: [], benchmark: { accuracyWithin50m: 0.83, avgDistanceM: 12, sampleCount: 20, ranAt: "x" }, description: "" };
    const metaB = { bundleId: "lumi-preview", version: "1.1", backbones: [], benchmark: { accuracyWithin50m: 0.89, avgDistanceM: 8, sampleCount: 20, ranAt: "x" }, description: "" };
    (github.downloadReleaseAsset as any)
      .mockResolvedValueOnce(encryptBuffer(Buffer.from(JSON.stringify(metaA)), MODEL_CATALOG_SHARED_KEY))
      .mockResolvedValueOnce(encryptBuffer(Buffer.from(JSON.stringify(metaB)), MODEL_CATALOG_SHARED_KEY));

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json.bundles).toHaveLength(1);
    const releases = json.bundles[0].releases;
    expect(releases.find((r: any) => r.version === "1.0").isActive).toBe(true);
    expect(releases.find((r: any) => r.version === "1.1").isActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @netryx/web test app/api/model-catalog/route`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/model-catalog/route.ts
import { NextResponse } from "next/server";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { searchRepositoriesByTopic, listReleasesForRepo, downloadReleaseAsset } from "../../../lib/model-catalog/github";
import { MODEL_CATALOG_METADATA_ASSET_NAME, type ModelCatalogManifest } from "../../../lib/model-catalog/manifest";
import { MODEL_CATALOG_SHARED_KEY } from "../../../lib/model-catalog/shared-key";
import { decryptBuffer } from "@netryx/settings-repo";

export async function GET() {
  const activeVersion = RETRIEVAL_MODELS[0]?.version ?? null;
  const repos = await searchRepositoriesByTopic("lumi-model-catalog");

  const bundles = await Promise.all(
    repos.map(async ({ owner, repo }) => {
      const githubReleases = await listReleasesForRepo(owner, repo);

      const releases = await Promise.all(
        githubReleases.map(async (release) => {
          const metadataAsset = release.assets.find((a) => a.name === MODEL_CATALOG_METADATA_ASSET_NAME);
          if (!metadataAsset) return null;

          const encrypted = await downloadReleaseAsset(metadataAsset.url);
          const manifest = JSON.parse(decryptBuffer(encrypted, MODEL_CATALOG_SHARED_KEY).toString("utf8")) as ModelCatalogManifest;

          return {
            tag: release.tagName,
            bundleId: manifest.bundleId,
            version: manifest.version,
            backbones: manifest.backbones,
            benchmark: manifest.benchmark,
            description: manifest.description,
            isActive: manifest.version === activeVersion,
          };
        })
      );

      return { owner, repo, releases: releases.filter((r): r is NonNullable<typeof r> => r !== null) };
    })
  );

  return NextResponse.json({ bundles });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @netryx/web test app/api/model-catalog/route`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/model-catalog/route.ts apps/web/app/api/model-catalog/route.test.ts
git commit -m "feat(web): add GET /api/model-catalog discovery endpoint"
```

---

### Task 9: Backup/restore helper

**Files:**
- Create: `apps/web/lib/model-catalog/backup.ts`
- Create: `apps/web/lib/model-catalog/backup.test.ts`

**Interfaces:**
- Produces: `backupInferenceCode(inferenceDir: string): Promise<string>` (returns the backup dir path), `restoreInferenceCode(inferenceDir: string, backupDir: string): Promise<void>` — Task 10's install route calls both.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/model-catalog/backup.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupInferenceCode, restoreInferenceCode } from "./backup";

let inferenceDir: string;

beforeEach(async () => {
  inferenceDir = await mkdtemp(join(tmpdir(), "lumi-fake-inference-"));
  await writeFile(join(inferenceDir, "main.py"), "version-1");
  await mkdir(join(inferenceDir, "models"));
  await writeFile(join(inferenceDir, "models", "registry.py"), "version-1-registry");
  await mkdir(join(inferenceDir, "venv"));
  await writeFile(join(inferenceDir, "venv", "leave-me-alone.py"), "venv-file");
});

afterEach(async () => {
  await rm(inferenceDir, { recursive: true, force: true });
});

describe("backupInferenceCode / restoreInferenceCode", () => {
  it("backs up all .py files, then a later 'install' overwriting them can be restored", async () => {
    const backupDir = await backupInferenceCode(inferenceDir);

    // Simulate installing a new version by overwriting main.py.
    await writeFile(join(inferenceDir, "main.py"), "version-2");
    await writeFile(join(inferenceDir, "models", "registry.py"), "version-2-registry");

    await restoreInferenceCode(inferenceDir, backupDir);

    expect((await readFile(join(inferenceDir, "main.py"), "utf8"))).toBe("version-1");
    expect((await readFile(join(inferenceDir, "models", "registry.py"), "utf8"))).toBe("version-1-registry");
    // venv/ was never touched by backup/restore at all.
    expect((await readFile(join(inferenceDir, "venv", "leave-me-alone.py"), "utf8"))).toBe("venv-file");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/model-catalog/backup`
Expected: FAIL — `Cannot find module './backup'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/model-catalog/backup.ts
import { mkdtemp, mkdir, readdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, dirname } from "node:path";

const EXCLUDED_DIRS = new Set(["venv", "data", "__pycache__", ".pytest_cache", ".catalog-backup"]);

async function copyTree(fromDir: string, toDir: string, root: string): Promise<void> {
  const entries = await readdir(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await copyTree(join(fromDir, entry.name), toDir, root);
      continue;
    }
    if (!entry.name.endsWith(".py") && entry.name !== "requirements.txt") continue;
    const srcPath = join(fromDir, entry.name);
    const relPath = relative(root, srcPath);
    const destPath = join(toDir, relPath);
    await mkdir(dirname(destPath), { recursive: true });
    await copyFile(srcPath, destPath);
  }
}

/** Copies the current .py files + requirements.txt into a fresh temp
 * backup directory, before a catalog install overwrites them — never
 * touches venv/ or data/ (spec's install-flow "backup" step). Returns the
 * backup directory's path, needed later by restoreInferenceCode if the
 * new version's restart fails. */
export async function backupInferenceCode(inferenceDir: string): Promise<string> {
  const backupDir = await mkdtemp(join(tmpdir(), "lumi-catalog-backup-"));
  await copyTree(inferenceDir, backupDir, inferenceDir);
  return backupDir;
}

/** Restores files from a prior backupInferenceCode() call back over
 * inferenceDir — used when a newly-installed version's restart never
 * comes back healthy. */
export async function restoreInferenceCode(inferenceDir: string, backupDir: string): Promise<void> {
  await copyTree(backupDir, inferenceDir, backupDir);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/model-catalog/backup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/model-catalog/backup.ts apps/web/lib/model-catalog/backup.test.ts
git commit -m "feat(web): add services/inference code backup/restore helper"
```

---

### Task 10: `POST /api/model-catalog/install`

**Files:**
- Create: `apps/web/app/api/model-catalog/install/route.ts`
- Create: `apps/web/app/api/model-catalog/install/route.test.ts`

**Interfaces:**
- Consumes: `listReleasesForRepo`, `downloadReleaseAsset` (Task 1); `validateModelCatalogManifest`, `BUNDLE_CODE_ASSET_NAME`, `MODEL_CATALOG_METADATA_ASSET_NAME` (Task 4); `MODEL_CATALOG_SHARED_KEY` (Task 4); `backupInferenceCode`, `restoreInferenceCode` (Task 9).
- Produces: `POST(request): Promise<Response>` — `{ ok: true, version }` on a successful install; `{ ok: false, error, restoredVersion }` on a failed restart that was auto-restored.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/api/model-catalog/install/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../lib/model-catalog/github", () => ({ listReleasesForRepo: vi.fn(), downloadReleaseAsset: vi.fn() }));
vi.mock("../../../../lib/model-catalog/backup", () => ({ backupInferenceCode: vi.fn(), restoreInferenceCode: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rm: vi.fn(), mkdtemp: vi.fn().mockResolvedValue("/tmp/staging"), mkdir: vi.fn(), copyFile: vi.fn(), readdir: vi.fn().mockResolvedValue([]) };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/model-catalog/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/model-catalog/install", () => {
  it("404s when the release/tag isn't found", async () => {
    const { listReleasesForRepo } = await import("../../../../lib/model-catalog/github");
    (listReleasesForRepo as any).mockResolvedValue([]);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "missing" }));
    expect(res.status).toBe(404);
  });

  it("400s when the release is missing expected assets", async () => {
    const { listReleasesForRepo } = await import("../../../../lib/model-catalog/github");
    (listReleasesForRepo as any).mockResolvedValue([{ tagName: "lumi-preview-v1.1", name: "x", body: "", assets: [] }]);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "lumi-preview-v1.1" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test app/api/model-catalog/install`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/model-catalog/install/route.ts
import { NextResponse } from "next/server";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import JSZip from "jszip";
import { readdir, copyFile } from "node:fs/promises";
import { decryptBuffer } from "@netryx/settings-repo";
import { listReleasesForRepo, downloadReleaseAsset } from "../../../../lib/model-catalog/github";
import { validateModelCatalogManifest, BUNDLE_CODE_ASSET_NAME, MODEL_CATALOG_METADATA_ASSET_NAME } from "../../../../lib/model-catalog/manifest";
import { MODEL_CATALOG_SHARED_KEY } from "../../../../lib/model-catalog/shared-key";
import { backupInferenceCode, restoreInferenceCode } from "../../../../lib/model-catalog/backup";

interface InstallBody {
  owner?: string;
  repo?: string;
  tag?: string;
}

const INFERENCE_DIR = resolve(process.cwd(), "..", "services", "inference");

async function waitForInferenceReady(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://localhost:8000/docs", { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

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

  const metadataAsset = release.assets.find((a) => a.name === MODEL_CATALOG_METADATA_ASSET_NAME);
  const codeAsset = release.assets.find((a) => a.name === BUNDLE_CODE_ASSET_NAME);
  if (!metadataAsset || !codeAsset) {
    return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
  }

  const metadataBytes = await downloadReleaseAsset(metadataAsset.url);
  const manifest = validateModelCatalogManifest(
    JSON.parse(decryptBuffer(metadataBytes, MODEL_CATALOG_SHARED_KEY).toString("utf8"))
  );

  const codeBytes = await downloadReleaseAsset(codeAsset.url);
  const decrypted = decryptBuffer(codeBytes, MODEL_CATALOG_SHARED_KEY);

  const stagingDir = await mkdtemp(join(tmpdir(), "lumi-catalog-install-"));
  let backupDir: string | null = null;

  try {
    const zip = await JSZip.loadAsync(decrypted);
    for (const [relPath, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const destPath = join(stagingDir, relPath);
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, await entry.async("nodebuffer"));
    }

    backupDir = await backupInferenceCode(INFERENCE_DIR);

    // Copy staged files over the real inference dir.
    async function copyStagedTree(fromDir: string): Promise<void> {
      const entries = await readdir(fromDir, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = join(fromDir, entry.name);
        if (entry.isDirectory()) {
          await copyStagedTree(srcPath);
          continue;
        }
        const relPath = srcPath.slice(stagingDir.length + 1);
        const destPath = join(INFERENCE_DIR, relPath);
        await mkdir(dirname(destPath), { recursive: true });
        await copyFile(srcPath, destPath);
      }
    }
    await copyStagedTree(stagingDir);

    // Restart the inference service — reuses the low-VRAM-mode epic's
    // restart mechanism (POST /api/setup/run/restart-inference).
    const restartRes = await fetch("http://localhost:3000/api/setup/run/restart-inference", { method: "POST" });
    void restartRes; // SSE stream — this route just waits for real readiness below, not the stream's own "done" event.

    const ready = await waitForInferenceReady(60_000);
    if (!ready) {
      await restoreInferenceCode(INFERENCE_DIR, backupDir);
      await fetch("http://localhost:3000/api/setup/run/restart-inference", { method: "POST" });
      return NextResponse.json(
        { ok: false, error: `No se pudo aplicar la versión ${manifest.version} — se restauró la versión anterior`, restoredVersion: true },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, version: manifest.version });
  } catch (err) {
    if (backupDir) await restoreInferenceCode(INFERENCE_DIR, backupDir);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test app/api/model-catalog/install`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/model-catalog/install/route.ts apps/web/app/api/model-catalog/install/route.test.ts
git commit -m "feat(web): add POST /api/model-catalog/install (stage, backup, swap, restart, auto-restore)"
```

---

### Task 11: `ModelCatalogPanel` UI

**Files:**
- Create: `apps/web/app/components/ModelCatalogPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/model-catalog`, `POST /api/model-catalog/publish`, `POST /api/model-catalog/install`, `fetchJson` (`../lib/fetch-json`), `FloatingCard` (`./FloatingCard`).
- Produces: `ModelCatalogPanel()` — Task 12 renders this as a new Settings tab.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/ModelCatalogPanel.tsx
"use client";
import { useEffect, useState } from "react";
import { FloatingCard } from "./FloatingCard";
import { fetchJson } from "../lib/fetch-json";

interface Backbone { name: string; source: string }
interface CatalogBenchmark { accuracyWithin50m: number; avgDistanceM: number; sampleCount: number; ranAt: string }
interface CatalogRelease {
  tag: string; bundleId: string; version: string; backbones: Backbone[];
  benchmark: CatalogBenchmark; description: string; isActive: boolean;
}
interface CatalogBundle { owner: string; repo: string; releases: CatalogRelease[] }

function ReleaseRow({
  owner, repo, release, selected, onSelect, onInstall,
}: { owner: string; repo: string; release: CatalogRelease; selected: boolean; onSelect: () => void; onInstall: () => void }) {
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-center justify-between border-b border-white/10 px-4 py-3 last:border-b-0 ${selected ? "bg-white/[.03]" : ""}`}
    >
      <div>
        <div className="text-[13px] text-fg">v{release.version}</div>
        <div className="text-[11px] text-subtle">{release.backbones.map((b) => b.name).join(" + ")}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-[rgba(120,200,140,0.35)] bg-[rgba(120,200,140,0.12)] px-2.5 py-0.5 text-[10.5px] font-medium text-[#8fd6a3]">
          {Math.round(release.benchmark.accuracyWithin50m * 100)}% ≤ 50m
        </span>
        {release.isActive && (
          <span className="rounded-full border border-[rgba(133,183,235,0.35)] bg-[rgba(133,183,235,0.12)] px-2.5 py-0.5 text-[10.5px] font-medium text-[#85b7eb]">
            Activa
          </span>
        )}
        {!release.isActive && (
          <button
            onClick={(e) => { e.stopPropagation(); onInstall(); }}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-black"
          >
            Instalar
          </button>
        )}
      </div>
    </div>
  );
}

function ExplorarTab() {
  const [bundles, setBundles] = useState<CatalogBundle[]>([]);
  const [selected, setSelected] = useState<{ owner: string; repo: string; release: CatalogRelease } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ bundles: CatalogBundle[] }>("/api/model-catalog").then((r) => setBundles(r.data?.bundles ?? []));
  }, []);

  async function install(owner: string, repo: string, release: CatalogRelease) {
    setStatus(`Instalando v${release.version}…`);
    const { ok, data } = await fetchJson("/api/model-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner, repo, tag: release.tag }),
    });
    setStatus(ok ? `Instalada v${release.version}` : (data as { error?: string })?.error ?? "No se pudo instalar");
  }

  return (
    <div>
      {status && <div className="mb-3 text-xs text-muted">{status}</div>}
      {bundles.map((bundle) => (
        <FloatingCard key={`${bundle.owner}/${bundle.repo}`} className="mb-3 overflow-hidden">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="text-[13.5px] font-medium text-fg">Lumi Preview</div>
            <div className="text-[11px] text-subtle">github.com/{bundle.owner}/{bundle.repo} · {bundle.releases.length} release{bundle.releases.length === 1 ? "" : "s"}</div>
          </div>
          {bundle.releases.map((release) => (
            <ReleaseRow
              key={release.tag}
              owner={bundle.owner}
              repo={bundle.repo}
              release={release}
              selected={selected?.release.tag === release.tag}
              onSelect={() => setSelected({ owner: bundle.owner, repo: bundle.repo, release })}
              onInstall={() => install(bundle.owner, bundle.repo, release)}
            />
          ))}
        </FloatingCard>
      ))}
      {selected && (
        <FloatingCard className="p-5">
          <div className="text-[14px] font-medium text-fg">Lumi Preview v{selected.release.version}</div>
          <div className="mt-3 flex gap-6">
            <div>
              <div className="text-[10.5px] uppercase tracking-wide text-subtle">Precisión (≤50m)</div>
              <div className="mt-0.5 text-[17px] text-fg">{Math.round(selected.release.benchmark.accuracyWithin50m * 100)}%</div>
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-wide text-subtle">Distancia media</div>
              <div className="mt-0.5 text-[17px] text-fg">{selected.release.benchmark.avgDistanceM.toFixed(1)}m</div>
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-wide text-subtle">Casos evaluados</div>
              <div className="mt-0.5 text-[17px] text-fg">{selected.release.benchmark.sampleCount}</div>
            </div>
          </div>
        </FloatingCard>
      )}
    </div>
  );
}

function PublicarTab() {
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [benchmark, setBenchmark] = useState<CatalogBenchmark | null>(null);

  async function publish() {
    setStatus({ tone: "ok", text: "Publicando… (ejecutando benchmark)" });
    const { ok, data } = await fetchJson("/api/model-catalog/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description }),
    });
    if (ok) {
      setBenchmark((data as { benchmark: CatalogBenchmark }).benchmark);
      setStatus({ tone: "ok", text: "Publicado" });
    } else {
      const body = data as { error?: string; benchmark?: CatalogBenchmark };
      if (body.benchmark) setBenchmark(body.benchmark);
      setStatus({ tone: "error", text: body.error ?? "El benchmark no superó el umbral — no se publicó nada" });
    }
  }

  return (
    <FloatingCard className="p-5">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted">Descripción de esta versión</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25" />
        </div>
        {benchmark && (
          <div className={`rounded-md border px-3 py-2.5 text-[11.5px] ${
            benchmark.accuracyWithin50m >= 0.7
              ? "border-[rgba(120,200,140,0.4)] bg-[rgba(120,200,140,0.08)] text-[#8fd6a3]"
              : "border-[rgba(163,51,51,0.4)] bg-[rgba(163,51,51,0.08)] text-danger-fg"
          }`}>
            {Math.round(benchmark.accuracyWithin50m * 100)}% de {benchmark.sampleCount} casos a menos de 50m (umbral: 70%)
          </div>
        )}
        <div className="flex items-center gap-3">
          <button onClick={publish} className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-black">
            Publicar
          </button>
          {status && <span className={`text-xs ${status.tone === "ok" ? "text-fg" : "text-danger-fg"}`}>{status.text}</span>}
        </div>
      </div>
    </FloatingCard>
  );
}

export function ModelCatalogPanel() {
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
git add apps/web/app/components/ModelCatalogPanel.tsx
git commit -m "feat(web): add ModelCatalogPanel (Explorar/Publicar) matching the approved mockup"
```

---

### Task 12: Wire `ModelCatalogPanel` into Settings as a new tab

**Files:**
- Modify: `apps/web/app/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `ModelCatalogPanel` (Task 11).

- [ ] **Step 1: Add the import**

```ts
import { ModelCatalogPanel } from "./ModelCatalogPanel";
```

- [ ] **Step 2: Add a "Catálogo de modelos" tab entry and icon**

Add this entry to `SECTION_ICON` (alongside `areas`/`datasets`, if the datasets one already exists from that plan; otherwise alongside `areas`):

```ts
  "model-catalog": svg(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M10 4v16" /></>, "#a89fff"),
```

Change `tabItems` from (exact prior content depends on whether the datasets-catalog tab was already added by that plan — add this entry as the new last item regardless):

```ts
  const tabItems = [
    ...groups.map(({ section }) => ({ id: section.id, label: section.title, icon: SECTION_ICON[section.id] })),
    { id: "areas", label: "Áreas", icon: SECTION_ICON.areas },
    { id: "model-catalog", label: "Catálogo de modelos", icon: SECTION_ICON["model-catalog"] },
  ];
```

- [ ] **Step 3: Render the panel when the tab is active**

Add one more branch to the tab-body conditional (alongside `"areas"`/`"datasets"` if present):

```tsx
{activeTab === "areas" ? (
  <AreasManagePanel />
) : activeTab === "model-catalog" ? (
  <ModelCatalogPanel />
) : (
```

(Keep whatever the existing final `else` branch and closing `)}` already are — this only inserts one more branch before them.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run the dev stack, open `/settings` → "Catálogo de modelos". Confirm Explorar shows an empty state without crashing when `MODEL_CATALOG_REPO` isn't set yet. Set `GITHUB_TOKEN` and `MODEL_CATALOG_REPO` to a real throwaway repo, go to Publicar, write a description, click Publicar — confirm the benchmark actually runs against real local indexed images (requires at least ~20 already-indexed images with embeddings) and either blocks with a red readout or succeeds and uploads a real release with the `lumi-model-catalog` topic. Reload Explorar, confirm the release appears with its benchmark badge and "Activa" badge. Simulate an install (same version, already active) and confirm the full flow (stage → backup → swap → restart) completes without breaking the running service.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/SettingsPanel.tsx
git commit -m "feat(web): add a Catálogo de modelos tab to Settings"
```

---

## Self-Review Notes

- **Spec coverage:** benchmark suite with leave-one-out scoring and a fixed local reference set (Tasks 2, 5); manifest + owner-only GitHub-backed publish flow with its own topic/shared key (Tasks 1, 4, 6, 7); discovery separate from Epic A's `GET /api/models` (Task 8); narrow catalog-scoped install with backup/restore and reuse of the low-VRAM-mode epic's restart mechanism (Tasks 9, 10); Explorar/Publicar UI matching the approved (dataset-catalog-mirroring) mockup, wired into Settings as its own tab (Tasks 11, 12). All spec sections covered.
- **Placeholder scan:** none — every step has complete, runnable code and exact commands/expected output.
- **Type consistency:** `ModelCatalogManifest`/`ModelCatalogBenchmark` (Task 4) are used identically by the benchmark scorer (Task 5), the publish route (Task 7), the discovery route (Task 8), and the install route (Task 10) — no renamed fields. `BenchmarkCase`/`BenchmarkDeps` (Task 5) match exactly how Task 7's publish route constructs its `retrieve`/`embedQuery`/`readImageBase64` dependencies. `BUNDLE_CODE_ASSET_NAME`/`MODEL_CATALOG_METADATA_ASSET_NAME` (Task 4) are the same two constants used consistently by publish (Task 7), discovery (Task 8), and install (Task 10).
