# Indexing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an `areas` polygon indexable end-to-end: sample capture points along real streets (Overpass), download Street View images with dedupe/concurrency/retry, embed them via a FastAPI inference service that loads **Lumi Preview** (MegaLoc) once at startup, persist `{descriptor, lat, lng, heading, pano_id}` into `indexed_images`, and report live progress on the `areas` row — all driven by a **pg-boss** job so the `POST /api/areas` request returns instantly (spec §4, §6, §9.1, §12).

**Architecture:** `apps/web`'s `POST /api/areas` validates the polygon against `MAX_AREA_KM2`, estimates cost from a cheap Overpass-based point count, inserts the `areas` row (`status: "pending"`), and enqueues a pg-boss job — it never touches PyTorch or does the actual capture work. `apps/worker` picks up the job, walks the pipeline (Overpass → sample → dedupe → download → embed → persist), and writes progress back onto the same `areas` row on a short interval; `GET /api/areas/:id/progress` is a lightweight SSE endpoint that polls that row (no separate pub/sub, per spec §6.2). `services/inference` is a standalone FastAPI process that loads the model selected by the `RETRIEVAL_MODEL` setting exactly once at boot and exposes `POST /embed`; the worker calls it over HTTP and never imports torch itself. Two settings-reading pieces of logic (encryption + `system_settings` access, and street sampling/cost estimation) are extracted into shared packages during this plan because both `apps/web` and `apps/worker` now need them — duplicating either would violate DRY and drift out of sync.

**Tech Stack:** TypeScript (worker + web), Python 3.11 + FastAPI + PyTorch (inference service), pg-boss, p-limit, @turf/turf, node-pg-migrate, pytest, vitest.

**Depends on:** Foundation plan (schema, `system_settings`, settings repo, `SETTINGS_SCHEMA`, model registry) — already merged.

**Out of scope for this plan:** `/api/search` + `/api/search/:id/refine` (Search & Refine Pipeline plan), `MapCanvas`/`IndexingDrawTool`/`JobProgressBar` UI (Dashboard & Map UI plan), `api_usage` daily bookkeeping and estimated-vs-actual reconciliation beyond the per-area total this plan already needs (Cost tracking plan). This plan computes `areas.actual_cost_usd` because the job already knows exactly how many images it downloaded — it does **not** write to `api_usage`.

---

## Prerequisites

- Foundation plan merged: `netryx_dev`/`netryx_test` databases exist with the Foundation migration applied, `packages/shared-types` and `apps/web` build and test clean.
- Python 3.11+ with `venv` available (spec §7.1 — native, no Docker required).
- A real or throwaway Google Cloud API key with **Street View Static API** enabled, for manual verification steps only — all automated tests mock the network.
- `pnpm add -D p-limit @turf/turf pg-boss` will be run in Task 5/9; not needed before then.

---

## File Structure

```
netryx-fork/
├── .env.example                                  # +SETTINGS_KEY_PATH (Task 2)
├── db/
│   └── migrations/
│       └── 1720400100000_add_points_failed.js    # Task 1
├── packages/
│   ├── settings-repo/                            # Task 2 (extracted from apps/web/lib)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── crypto.ts
│   │       ├── crypto.test.ts
│   │       ├── settings-repo.ts
│   │       ├── settings-repo.test.ts
│   │       └── index.ts
│   ├── shared-types/
│   │   └── src/
│   │       ├── jobs.ts                           # Task 3
│   │       ├── jobs.test.ts
│   │       ├── areas.ts                          # Task 3
│   │       └── index.ts                          # Modify
│   └── geo-sampling/                             # Task 4
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── overpass.ts
│           ├── overpass.test.ts
│           ├── sample.ts
│           ├── sample.test.ts
│           ├── cost.ts
│           ├── cost.test.ts
│           └── index.ts
├── apps/
│   ├── web/
│   │   ├── lib/
│   │   │   └── settings-repo.ts                  # Modify (Task 2 — thin wrapper over package)
│   │   └── app/api/areas/
│   │       ├── route.ts                          # Task 14
│   │       ├── route.test.ts
│   │       └── [id]/progress/
│   │           ├── route.ts                      # Task 15
│   │           └── route.test.ts
│   └── worker/
│       ├── package.json                          # Modify (Task 5)
│       └── src/
│           ├── db.ts                             # Task 5
│           ├── settings.ts                       # Task 5
│           ├── street-view.ts                    # Task 6
│           ├── street-view.test.ts
│           ├── inference-client.ts               # Task 7
│           ├── inference-client.test.ts
│           ├── progress.ts                       # Task 8
│           ├── progress.test.ts
│           ├── queue.ts                          # Task 9
│           ├── jobs/
│           │   ├── index-area.ts                 # Task 10
│           │   └── index-area.test.ts
│           └── index.ts                          # Modify (Task 11)
└── services/
    └── inference/
        ├── requirements.txt                       # Task 12
        ├── settings.py                            # Task 12
        ├── test_settings.py
        ├── loader.py                              # Task 12
        ├── test_loader.py
        ├── main.py                                # Task 13
        └── test_main.py
```

---

### Task 1: Migration — track partial failures on `areas`

The spec's UI requirement in §8.3 ("Job de indexado fallido a medias — mostrar cuántos puntos fallaron, no solo éxito/fracaso binario") has no column to store that count yet. Add one before the worker needs to write to it.

**Files:**
- Create: `db/migrations/1720400100000_add_points_failed.js`
- Modify: `db/test/migrations.test.ts`

- [ ] **Step 1: Add a failing assertion to the migrations test**

```typescript
// db/test/migrations.test.ts — add inside the existing describe("init migration") block
it("adds points_failed to areas with a default of 0", async () => {
  const testId = "00000000-0000-0000-0000-000000000002";

  // Defensive cleanup: if a previous run failed between the INSERT and the
  // final DELETE below, this row would be left orphaned and collide on the
  // PK here — delete first so the test is idempotent across failed runs.
  await client.query(`DELETE FROM areas WHERE id = $1`, [testId]);

  try {
    await client.query(
      `INSERT INTO areas (id, geometry, area_km2)
       VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 1.0)`,
      [testId]
    );
    const { rows } = await client.query(
      `SELECT points_failed FROM areas WHERE id = $1`,
      [testId]
    );
    expect(rows[0].points_failed).toBe(0);
  } finally {
    await client.query(`DELETE FROM areas WHERE id = $1`, [testId]);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd db && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test`
Expected: FAIL — `column "points_failed" does not exist`.

- [ ] **Step 3: Write the migration**

```javascript
// db/migrations/1720400100000_add_points_failed.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE areas
    ADD COLUMN points_failed integer NOT NULL DEFAULT 0;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE areas DROP COLUMN points_failed;`);
};
```

- [ ] **Step 4: Run the migration against the test DB**

Run: `cd db && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm migrate:up:test`
Expected: `> Migrating files: - 1720400100000_add_points_failed` then `Migrations complete!`

- [ ] **Step 5: Run test to verify it passes, then apply to dev**

Run: `cd db && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test && pnpm migrate:up`
Expected: PASS — 5 tests green; dev migration applies cleanly.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/1720400100000_add_points_failed.js db/test/migrations.test.ts
git commit -m "feat(db): add areas.points_failed for partial-failure reporting (spec §8.3)"
```

---

### Task 2: Extract `packages/settings-repo` (shared between web and worker)

The worker needs `GOOGLE_MAPS_API_KEY` and the cost/area limits (spec §14.5: "el worker... consulta `system_settings`"), which means it needs the same encryption + repo logic Foundation built inside `apps/web/lib`. Moving it to a package avoids two copies of AES-256-GCM code drifting apart. The encryption key file itself must be a single physical file both processes agree on — so `SETTINGS_KEY_PATH` becomes an explicit, required-for-worker env var instead of a path guessed relative to `process.cwd()`.

**Files:**
- Create: `packages/settings-repo/package.json`, `packages/settings-repo/tsconfig.json`, `packages/settings-repo/src/index.ts`
- Move: `apps/web/lib/crypto.ts` → `packages/settings-repo/src/crypto.ts`
- Move: `apps/web/lib/crypto.test.ts` → `packages/settings-repo/src/crypto.test.ts`
- Move: `apps/web/lib/settings-repo.ts` (the `createSettingsRepo` function and its types only) → `packages/settings-repo/src/settings-repo.ts`
- Move: `apps/web/lib/settings-repo.test.ts` → `packages/settings-repo/src/settings-repo.test.ts`
- Modify: `apps/web/lib/settings-repo.ts` (becomes a thin re-export + singleton)
- Modify: `.env.example`

- [ ] **Step 1: Move the four files verbatim**

```bash
mkdir -p packages/settings-repo/src
git mv apps/web/lib/crypto.ts packages/settings-repo/src/crypto.ts
git mv apps/web/lib/crypto.test.ts packages/settings-repo/src/crypto.test.ts
```

Move only the pure `createSettingsRepo`/type portion of `apps/web/lib/settings-repo.ts` (everything up to and including `export type SettingsRepo = ReturnType<typeof createSettingsRepo>;`) into the new file — leave the `getSettingsRepo()` singleton behind, it stays app-specific:

```typescript
// packages/settings-repo/src/settings-repo.ts
// (identical content to the Foundation-plan apps/web/lib/settings-repo.ts,
//  MINUS the trailing getSettingsRepo() singleton block)
import type { Pool } from "pg";
import { loadOrCreateEncryptionKey, encrypt, decrypt } from "./crypto";

const SETUP_COMPLETED_KEY = "__setup_completed__";

export interface SettingWrite {
  key: string;
  value: string;
  isSecret: boolean;
}

export interface SettingsRepoOptions {
  pool: Pool;
  encryptionKeyPath: string;
  cacheTtlMs?: number;
}

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

export function createSettingsRepo(options: SettingsRepoOptions) {
  const { pool, encryptionKeyPath } = options;
  const cacheTtlMs = options.cacheTtlMs ?? 30_000;
  const cache = new Map<string, CacheEntry>();

  function getKey(): Buffer {
    return loadOrCreateEncryptionKey(
      encryptionKeyPath,
      process.env.SETTINGS_ENCRYPTION_KEY
    );
  }

  function invalidate(key: string) {
    cache.delete(key);
  }

  async function getSetting(key: string): Promise<string | null> {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const { rows } = await pool.query(
      "SELECT value, encrypted_value FROM system_settings WHERE key = $1",
      [key]
    );

    let value: string | null = null;
    if (rows.length > 0) {
      const row = rows[0];
      value = row.encrypted_value
        ? decrypt(row.encrypted_value, getKey())
        : row.value;
    }

    cache.set(key, { value, expiresAt: Date.now() + cacheTtlMs });
    return value;
  }

  async function setSetting(
    key: string,
    value: string,
    isSecret: boolean
  ): Promise<void> {
    if (isSecret) {
      const encrypted = encrypt(value, getKey());
      await pool.query(
        `INSERT INTO system_settings (key, value, encrypted_value, is_secret, updated_at)
         VALUES ($1, NULL, $2, true, now())
         ON CONFLICT (key) DO UPDATE
           SET value = NULL, encrypted_value = $2, is_secret = true, updated_at = now()`,
        [key, encrypted]
      );
    } else {
      await pool.query(
        `INSERT INTO system_settings (key, value, encrypted_value, is_secret, updated_at)
         VALUES ($1, $2, NULL, false, now())
         ON CONFLICT (key) DO UPDATE
           SET value = $2, encrypted_value = NULL, is_secret = false, updated_at = now()`,
        [key, value]
      );
    }
    invalidate(key);
  }

  async function isSetupCompleted(): Promise<boolean> {
    const value = await getSetting(SETUP_COMPLETED_KEY);
    return value === "true";
  }

  async function completeSetup(writes: SettingWrite[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const { key, value, isSecret } of writes) {
        if (isSecret) {
          const encrypted = encrypt(value, getKey());
          await client.query(
            `INSERT INTO system_settings (key, value, encrypted_value, is_secret, updated_at)
             VALUES ($1, NULL, $2, true, now())
             ON CONFLICT (key) DO UPDATE
               SET value = NULL, encrypted_value = $2, is_secret = true, updated_at = now()`,
            [key, encrypted]
          );
        } else {
          await client.query(
            `INSERT INTO system_settings (key, value, encrypted_value, is_secret, updated_at)
             VALUES ($1, $2, NULL, false, now())
             ON CONFLICT (key) DO UPDATE
               SET value = $2, encrypted_value = NULL, is_secret = false, updated_at = now()`,
            [key, value]
          );
        }
      }
      await client.query(
        `INSERT INTO system_settings (key, value, is_secret, updated_at)
         VALUES ($1, 'true', false, now())
         ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now()`,
        [SETUP_COMPLETED_KEY]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
      for (const { key } of writes) invalidate(key);
      invalidate(SETUP_COMPLETED_KEY);
    }
  }

  return { getSetting, setSetting, isSetupCompleted, completeSetup };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
```

Move the test file the same way (its `import { createSettingsRepo } from "./settings-repo"` stays valid since it's now sitting next to the file in the same package).

- [ ] **Step 2: Create the package manifest and barrel export**

```json
// packages/settings-repo/package.json
{
  "name": "@netryx/settings-repo",
  "private": true,
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "pg": "^8.12.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.6",
    "vitest": "^2.0.5",
    "typescript": "^5.5.4"
  }
}
```

```json
// packages/settings-repo/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

```typescript
// packages/settings-repo/src/index.ts
export * from "./settings-repo";
export * from "./crypto";
```

- [ ] **Step 3: Rewrite `apps/web/lib/settings-repo.ts` as a thin app-specific wrapper**

```typescript
// apps/web/lib/settings-repo.ts
import { getPool } from "./db";
import {
  createSettingsRepo,
  type SettingsRepo,
} from "@netryx/settings-repo";

export type { SettingsRepo, SettingWrite } from "@netryx/settings-repo";

let singleton: SettingsRepo | undefined;

/**
 * SETTINGS_KEY_PATH must be an absolute path shared with apps/worker — both
 * processes encrypt/decrypt the same system_settings rows and MUST agree on
 * the physical key file (spec §14.4). Falls back to a repo-relative default
 * only for the web app's own convenience; the worker has no such fallback
 * (see apps/worker/src/settings.ts, Task 5) because guessing a relative path
 * across two different process cwds is exactly the kind of bug that stays
 * invisible until someone rotates a key.
 */
function resolveKeyPath(): string {
  return process.env.SETTINGS_KEY_PATH ?? `${process.cwd()}/data/settings.key`;
}

export function getSettingsRepo(): SettingsRepo {
  if (!singleton) {
    singleton = createSettingsRepo({
      pool: getPool(),
      encryptionKeyPath: resolveKeyPath(),
    });
  }
  return singleton;
}
```

- [ ] **Step 4: Add `@netryx/settings-repo` as a dependency of `apps/web`**

```json
// apps/web/package.json — add to "dependencies"
"@netryx/settings-repo": "workspace:*",
```

- [ ] **Step 5: Add `SETTINGS_KEY_PATH` to `.env.example`**

```bash
# apps/web and apps/worker must both read the SAME file here — this is the
# key that decrypts GOOGLE_MAPS_API_KEY/MAPBOX_TOKEN in system_settings
# (spec §14.4). Absolute path, created automatically on first boot if missing.
SETTINGS_KEY_PATH=/absolute/path/to/netryx-fork/data/settings.key
```

- [ ] **Step 6: Reinstall workspace and run every existing test to confirm nothing broke**

Run: `pnpm install && pnpm -r test`
Expected: PASS everywhere — `packages/settings-repo` runs the 5 crypto + 6 repo tests that used to live in `apps/web`; `apps/web`'s own remaining tests (`layout.test.ts`, `route.test.ts`, `actions.test.ts`) still pass unchanged since they only imported `getSettingsRepo`/`SettingsRepo`, both still exported from `apps/web/lib/settings-repo.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/settings-repo apps/web/lib/settings-repo.ts apps/web/package.json .env.example pnpm-lock.yaml
git commit -m "refactor: extract @netryx/settings-repo so apps/worker can share it (spec §14.5)"
```

---

### Task 3: Shared types for jobs and areas

**Files:**
- Create: `packages/shared-types/src/jobs.ts`
- Create: `packages/shared-types/src/jobs.test.ts`
- Create: `packages/shared-types/src/areas.ts`
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared-types/src/jobs.test.ts
import { describe, it, expect } from "vitest";
import { INDEX_AREA_JOB_NAME, STREET_VIEW_HEADINGS } from "./jobs";

describe("job constants", () => {
  it("names the indexing job consistently for enqueue and consume", () => {
    expect(INDEX_AREA_JOB_NAME).toBe("index-area");
  });

  it("captures 4 cardinal headings per point (spec §4)", () => {
    expect(STREET_VIEW_HEADINGS).toEqual([0, 90, 180, 270]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared-types && pnpm test jobs.test.ts`
Expected: FAIL — `Cannot find module './jobs'`.

- [ ] **Step 3: Implement `jobs.ts` and `areas.ts`**

```typescript
// packages/shared-types/src/jobs.ts
export const INDEX_AREA_JOB_NAME = "index-area";

/** 0°=N, 90°=E, 180°=S, 270°=W — one capture per cardinal direction per point (spec §4). */
export const STREET_VIEW_HEADINGS: readonly number[] = [0, 90, 180, 270];

export interface IndexAreaJobPayload {
  areaId: string;
}

export interface SampledPoint {
  lat: number;
  lng: number;
}

export interface StreetViewCapture {
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  /** Street View's own capture date, "YYYY-MM" format, or null if unavailable. */
  captureDate: string | null;
  imageBase64: string;
}
```

```typescript
// packages/shared-types/src/areas.ts
export type AreaStatus = "pending" | "indexing" | "indexed" | "failed";

export interface AreaRow {
  id: string;
  name: string | null;
  areaKm2: number;
  status: AreaStatus;
  pointsEstimated: number;
  pointsCaptured: number;
  pointsFailed: number;
  imagesEmbedded: number;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
}
```

- [ ] **Step 4: Add both to the barrel export**

```typescript
// packages/shared-types/src/index.ts — add these two lines
export * from "./jobs";
export * from "./areas";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/shared-types && pnpm test`
Expected: PASS — 2 new tests plus all 16 existing ones green.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types
git commit -m "feat(shared-types): job payload, sampled point, capture, and area row types"
```

---

### Task 4: `packages/geo-sampling` — Overpass query, street sampling, cost estimate

This package is used by **both** `apps/worker` (to actually run the pipeline) and `apps/web`'s `POST /api/areas` (to produce the cost estimate before the job is even created) — spec §12.1 needs the same point count both places, so it can't live inside the worker only.

**Files:**
- Create: `packages/geo-sampling/package.json`, `packages/geo-sampling/tsconfig.json`
- Create: `packages/geo-sampling/src/overpass.ts`, `overpass.test.ts`
- Create: `packages/geo-sampling/src/sample.ts`, `sample.test.ts`
- Create: `packages/geo-sampling/src/cost.ts`, `cost.test.ts`
- Create: `packages/geo-sampling/src/index.ts`

- [ ] **Step 1: Write the failing test for Overpass parsing**

```typescript
// packages/geo-sampling/src/overpass.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchStreetGeometry } from "./overpass";

afterEach(() => {
  vi.unstubAllGlobals();
});

const SAMPLE_RESPONSE = {
  elements: [
    {
      type: "way",
      id: 1,
      tags: { highway: "residential" },
      geometry: [
        { lat: 37.7749, lon: -122.4194 },
        { lat: 37.7755, lon: -122.4194 },
        { lat: 37.776, lon: -122.419 },
      ],
    },
    {
      type: "node", // non-way elements must be ignored
      id: 2,
      lat: 37.775,
      lon: -122.419,
    },
  ],
};

describe("fetchStreetGeometry", () => {
  it("POSTs an Overpass QL query built from the polygon and returns LineStrings in [lng, lat] order", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_RESPONSE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const polygon: [number, number][] = [
      [-122.42, 37.774],
      [-122.418, 37.774],
      [-122.418, 37.777],
      [-122.42, 37.777],
      [-122.42, 37.774],
    ];

    const lines = await fetchStreetGeometry(polygon);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://overpass-api.de/api/interpreter");
    expect(init.method).toBe("POST");
    expect(init.body).toContain("highway");
    expect(init.body).toContain("37.774"); // polygon coords made it into the query

    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe("LineString");
    expect(lines[0].coordinates[0]).toEqual([-122.4194, 37.7749]);
  });

  it("throws a clear error when Overpass responds with a non-OK status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 504, json: async () => ({}) })
    );

    await expect(fetchStreetGeometry([[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]])).rejects.toThrow(
      /Overpass request failed \(504\)/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/geo-sampling && pnpm install && pnpm test overpass.test.ts`
Expected: FAIL — `Cannot find module './overpass'`.

- [ ] **Step 3: Implement `overpass.ts`**

```typescript
// packages/geo-sampling/src/overpass.ts
export interface LineStringGeoJSON {
  type: "LineString";
  coordinates: [number, number][];
}

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

// The free public overpass-api.de instance is shared infrastructure and
// intermittently returns transient gateway errors under load — confirmed
// live: a POST /api/areas 504'd moments after an identical polygon succeeded
// against /api/areas/estimate. These codes are worth a retry; anything else
// (4xx, malformed query) is not.
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

function buildQuery(polygon: [number, number][]): string {
  // Overpass "poly" filter wants "lat1 lon1 lat2 lon2 ..." (lat first).
  const poly = polygon.map(([lng, lat]) => `${lat} ${lng}`).join(" ");
  return `
    [out:json][timeout:60];
    way["highway"](poly:"${poly}");
    out geom;
  `.trim();
}

async function postOverpassQuery(query: string): Promise<Response> {
  // overpass-api.de's front proxy returns 406 Not Acceptable for requests with
  // no (or a generic) User-Agent — confirmed directly against the live
  // endpoint: an identical request succeeds with a descriptive UA and fails
  // without one. This is also what Overpass's own usage policy asks clients
  // to send. Form-encoding the query in a `data` field matches the shape
  // Overpass's own curl/wget examples use.
  return fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "netryx-lumi/0.1 (+https://github.com/netryx-fork)",
    },
    body: new URLSearchParams({ data: query }).toString(),
  });
}

export interface FetchStreetGeometryOptions {
  retries?: number;
  retryBaseDelayMs?: number;
}

/**
 * Queries Overpass for all `highway=*` ways inside `polygon` and returns them
 * as GeoJSON LineStrings ([lng, lat] order) ready for turf.js (spec §4 step 2).
 * Retries with exponential backoff on transient gateway errors (502/503/504).
 */
export async function fetchStreetGeometry(
  polygon: [number, number][],
  options: FetchStreetGeometryOptions = {}
): Promise<LineStringGeoJSON[]> {
  const retries = options.retries ?? 2;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
  const query = buildQuery(polygon);

  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await postOverpassQuery(query);
    if (res.ok || !RETRYABLE_STATUS_CODES.has(res.status) || attempt >= retries) {
      break;
    }
    await new Promise((r) => setTimeout(r, retryBaseDelayMs * 2 ** attempt));
  }

  if (!res.ok) {
    throw new Error(`Overpass request failed (${res.status})`);
  }

  const body = (await res.json()) as {
    elements: Array<{
      type: string;
      geometry?: Array<{ lat: number; lon: number }>;
    }>;
  };

  return body.elements
    .filter((el) => el.type === "way" && el.geometry && el.geometry.length >= 2)
    .map((el) => ({
      type: "LineString" as const,
      coordinates: el.geometry!.map((pt) => [pt.lon, pt.lat] as [number, number]),
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/geo-sampling && pnpm test overpass.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Write the failing test for point sampling**

```typescript
// packages/geo-sampling/src/sample.test.ts
import { describe, it, expect } from "vitest";
import * as turf from "@turf/turf";
import { samplePointsAlongStreets } from "./sample";
import type { LineStringGeoJSON } from "./overpass";

describe("samplePointsAlongStreets", () => {
  it("samples points every ~spacingMeters along a single straight line", () => {
    const start = turf.point([-122.42, 37.775]);
    const end = turf.destination(start, 0.1, 90, { units: "kilometers" }); // ~100m due east
    const line: LineStringGeoJSON = {
      type: "LineString",
      coordinates: [start.geometry.coordinates as [number, number], end.geometry.coordinates as [number, number]],
    };

    const points = samplePointsAlongStreets([line], 20);

    // A 100m line sampled every 20m yields points at 0,20,40,60,80,100 = 6.
    expect(points.length).toBe(6);
    expect(points[0].lat).toBeCloseTo(37.775, 3);
    expect(points[points.length - 1].lng).toBeCloseTo(end.geometry.coordinates[0], 3);
  });

  it("dedupes points that fall within 1 meter of each other across overlapping lines", () => {
    const shared: LineStringGeoJSON = {
      type: "LineString",
      coordinates: [
        [-122.42, 37.775],
        [-122.4198, 37.775],
      ],
    };
    // Same line supplied twice, simulating two overlapping ways from Overpass.
    const points = samplePointsAlongStreets([shared, shared], 20);
    const uniqueKeys = new Set(points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`));
    expect(uniqueKeys.size).toBe(points.length);
  });

  it("returns an empty array for an empty input", () => {
    expect(samplePointsAlongStreets([], 20)).toEqual([]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd packages/geo-sampling && pnpm test sample.test.ts`
Expected: FAIL — `Cannot find module './sample'`.

- [ ] **Step 7: Implement `sample.ts`**

```typescript
// packages/geo-sampling/src/sample.ts
import * as turf from "@turf/turf";
import type { LineStringGeoJSON } from "./overpass";
import type { SampledPoint } from "@netryx/shared-types";

/**
 * Samples a point every `spacingMeters` along each line, then dedupes points
 * that land within 1m of each other — overlapping Overpass "ways" (e.g. a
 * road split into two segments that share a stretch) would otherwise produce
 * near-duplicate capture points (spec §4 step 2).
 */
export function samplePointsAlongStreets(
  lines: LineStringGeoJSON[],
  spacingMeters: number
): SampledPoint[] {
  const seen = new Set<string>();
  const points: SampledPoint[] = [];

  for (const line of lines) {
    if (line.coordinates.length < 2) continue;

    const feature = turf.lineString(line.coordinates);
    const lengthMeters = turf.length(feature, { units: "kilometers" }) * 1000;

    for (let d = 0; d <= lengthMeters; d += spacingMeters) {
      const along = turf.along(feature, d / 1000, { units: "kilometers" });
      const [lng, lat] = along.geometry.coordinates;
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`; // ~1m precision at these latitudes
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ lat, lng });
    }
  }

  return points;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd packages/geo-sampling && pnpm test sample.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 9: Write the failing test for cost/limit checks**

```typescript
// packages/geo-sampling/src/cost.test.ts
import { describe, it, expect } from "vitest";
import { estimateIndexingCostUsd, assertAreaWithinSizeLimit } from "./cost";

describe("estimateIndexingCostUsd", () => {
  it("multiplies points × headings × price per image", () => {
    expect(estimateIndexingCostUsd(1000, 4, 0.007)).toBeCloseTo(28.0, 5);
  });
});

describe("assertAreaWithinSizeLimit", () => {
  it("does not throw when the area is within the limit", () => {
    expect(() => assertAreaWithinSizeLimit(4.2, 5)).not.toThrow();
  });

  it("throws a clear error when the area exceeds the limit", () => {
    expect(() => assertAreaWithinSizeLimit(12, 5)).toThrow(
      /12(\.0+)? km² exceeds the configured limit of 5 km²/
    );
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `cd packages/geo-sampling && pnpm test cost.test.ts`
Expected: FAIL — `Cannot find module './cost'`.

- [ ] **Step 11: Implement `cost.ts`**

```typescript
// packages/geo-sampling/src/cost.ts

/** Spec §12.1: nº puntos × nº headings × precio por imagen. */
export function estimateIndexingCostUsd(
  pointsEstimated: number,
  headingsCount: number,
  pricePerImageUsd: number
): number {
  return pointsEstimated * headingsCount * pricePerImageUsd;
}

/** Spec §12.2 MAX_AREA_KM2 — rejected in the UI/API before touching the backend job. */
export function assertAreaWithinSizeLimit(areaKm2: number, maxAreaKm2: number): void {
  if (areaKm2 > maxAreaKm2) {
    throw new Error(
      `Area of ${areaKm2} km² exceeds the configured limit of ${maxAreaKm2} km²`
    );
  }
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `cd packages/geo-sampling && pnpm test cost.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 13: Barrel export, package manifest, tsconfig**

```typescript
// packages/geo-sampling/src/index.ts
export * from "./overpass";
export * from "./sample";
export * from "./cost";
```

```json
// packages/geo-sampling/package.json
{
  "name": "@netryx/geo-sampling",
  "private": true,
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@netryx/shared-types": "workspace:*",
    "@turf/turf": "^7.1.0"
  },
  "devDependencies": {
    "vitest": "^2.0.5",
    "typescript": "^5.5.4"
  }
}
```

```json
// packages/geo-sampling/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 14: Reinstall and run the full package test suite**

Run: `pnpm install && cd packages/geo-sampling && pnpm test`
Expected: PASS — 8 tests green (2 Overpass + 3 sample + 3 cost).

- [ ] **Step 15: Commit**

```bash
git add packages/geo-sampling pnpm-lock.yaml
git commit -m "feat(geo-sampling): Overpass query, point sampling, and cost/size-limit checks (spec §4, §12)"
```

---

### Task 5: Worker scaffolding — DB pool and settings access

**Files:**
- Create: `apps/worker/src/db.ts`
- Create: `apps/worker/src/settings.ts`
- Modify: `apps/worker/package.json`

- [ ] **Step 1: Update `apps/worker/package.json` with the real dependencies this plan needs**

```json
// apps/worker/package.json
{
  "name": "@netryx/worker",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "start": "node --loader ts-node/esm src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@netryx/shared-types": "workspace:*",
    "@netryx/settings-repo": "workspace:*",
    "@netryx/geo-sampling": "workspace:*",
    "pg": "^8.12.0",
    "pg-boss": "^9.0.3",
    "p-limit": "^6.1.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.6",
    "@types/node": "^20.14.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `db.ts` (mirrors `apps/web/lib/db.ts` — trivial infra glue, not worth sharing)**

```typescript
// apps/worker/src/db.ts
import { Pool } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    });
  }
  return pool;
}
```

- [ ] **Step 3: Create `settings.ts` — no fallback path, fails loudly if misconfigured**

```typescript
// apps/worker/src/settings.ts
import { createSettingsRepo, type SettingsRepo } from "@netryx/settings-repo";
import { getPool } from "./db";

let singleton: SettingsRepo | undefined;

/**
 * Unlike apps/web/lib/settings-repo.ts, this has NO relative-path fallback.
 * The worker runs as a separate OS process from apps/web (possibly a
 * separate machine later); guessing a path relative to its own cwd would
 * silently create a SECOND encryption key and make every secret written by
 * the web app undecryptable here. Fail fast instead (spec §14.4/§14.5).
 */
export function getSettingsRepo(): SettingsRepo {
  if (!singleton) {
    const keyPath = process.env.SETTINGS_KEY_PATH;
    if (!keyPath) {
      throw new Error(
        "SETTINGS_KEY_PATH is required for apps/worker — it must point at the " +
          "same absolute path apps/web uses, so both processes decrypt the " +
          "same system_settings secrets (spec §14.4)."
      );
    }
    singleton = createSettingsRepo({ pool: getPool(), encryptionKeyPath: keyPath });
  }
  return singleton;
}
```

- [ ] **Step 4: Verify the workspace still installs cleanly**

Run: `pnpm install`
Expected: `@netryx/worker` resolves its new workspace deps (`@netryx/settings-repo`, `@netryx/geo-sampling`) with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/package.json apps/worker/src/db.ts apps/worker/src/settings.ts pnpm-lock.yaml
git commit -m "chore(worker): pg pool + settings repo access, no fallback key path"
```

---

### Task 6: Street View download — metadata, dedupe, concurrency, retry

**Files:**
- Create: `apps/worker/src/street-view.ts`
- Create: `apps/worker/src/street-view.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/worker/src/street-view.test.ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { downloadCaptures } from "./street-view";
import type { SampledPoint } from "@netryx/shared-types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function metadataResponse(panoId: string, ok = true) {
  return {
    ok: true,
    json: async () => (ok ? { status: "OK", pano_id: panoId, date: "2024-06" } : { status: "ZERO_RESULTS" }),
  };
}

function imageResponse(bodyByte: number, status = 200) {
  return {
    ok: status < 400,
    status,
    arrayBuffer: async () => new Uint8Array([bodyByte]).buffer,
  };
}

describe("downloadCaptures", () => {
  it("fetches metadata then the static image for each point/heading pair", async () => {
    const points: SampledPoint[] = [{ lat: 37.7749, lng: -122.4194 }];
    const fetchMock = vi
      .fn()
      // point 0 heading 0: metadata then image
      .mockResolvedValueOnce(metadataResponse("pano-a"))
      .mockResolvedValueOnce(imageResponse(1))
      // point 0 heading 90
      .mockResolvedValueOnce(metadataResponse("pano-a"))
      .mockResolvedValueOnce(imageResponse(2))
      // heading 180
      .mockResolvedValueOnce(metadataResponse("pano-a"))
      .mockResolvedValueOnce(imageResponse(3))
      // heading 270
      .mockResolvedValueOnce(metadataResponse("pano-a"))
      .mockResolvedValueOnce(imageResponse(4));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadCaptures(points, [0, 90, 180, 270], {
      apiKey: "test-key",
      maxConcurrent: 2,
      existingPanoHeadings: new Set(),
    });

    expect(result.captures).toHaveLength(4);
    expect(result.failedPoints).toBe(0);
    expect(result.captures.every((c) => c.panoId === "pano-a")).toBe(true);
    expect(new Set(result.captures.map((c) => c.heading))).toEqual(new Set([0, 90, 180, 270]));
  });

  it("skips a pano/heading pair already present in existingPanoHeadings without downloading the image", async () => {
    const points: SampledPoint[] = [{ lat: 1, lng: 1 }];
    const fetchMock = vi.fn().mockResolvedValueOnce(metadataResponse("pano-dup"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadCaptures(points, [0], {
      apiKey: "test-key",
      maxConcurrent: 2,
      existingPanoHeadings: new Set(["pano-dup:0"]),
    });

    expect(result.captures).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // metadata only, no static image fetch
  });

  it("counts a point with no coverage on any heading as failed, not throwing", async () => {
    const points: SampledPoint[] = [{ lat: 1, lng: 1 }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(metadataResponse("unused", false))
    );

    const result = await downloadCaptures(points, [0, 90, 180, 270], {
      apiKey: "test-key",
      maxConcurrent: 2,
      existingPanoHeadings: new Set(),
    });

    expect(result.captures).toHaveLength(0);
    expect(result.failedPoints).toBe(1);
  });

  it("retries a 500 once with backoff, then succeeds, and does not double-count it as failed", async () => {
    const points: SampledPoint[] = [{ lat: 1, lng: 1 }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(metadataResponse("pano-retry"))
      .mockResolvedValueOnce(imageResponse(0, 500)) // first attempt fails
      .mockResolvedValueOnce(imageResponse(9)); // retry succeeds
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadCaptures(points, [0], {
      apiKey: "test-key",
      maxConcurrent: 1,
      existingPanoHeadings: new Set(),
      retryBaseDelayMs: 1,
    });

    expect(result.captures).toHaveLength(1);
    expect(result.failedPoints).toBe(0);
  });

  it("never issues more than maxConcurrent in-flight point/heading downloads at once", async () => {
    const points: SampledPoint[] = Array.from({ length: 6 }, (_, i) => ({ lat: i, lng: i }));
    let inFlight = 0;
    let maxObservedInFlight = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        inFlight += 1;
        maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return url.includes("metadata")
          ? metadataResponse("pano-x")
          : imageResponse(1);
      })
    );

    await downloadCaptures(points, [0], {
      apiKey: "test-key",
      maxConcurrent: 2,
      existingPanoHeadings: new Set(),
    });

    expect(maxObservedInFlight).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && pnpm install && pnpm test street-view.test.ts`
Expected: FAIL — `Cannot find module './street-view'`.

- [ ] **Step 3: Implement `street-view.ts`**

```typescript
// apps/worker/src/street-view.ts
import pLimit from "p-limit";
import type { SampledPoint, StreetViewCapture } from "@netryx/shared-types";

const METADATA_ENDPOINT = "https://maps.googleapis.com/maps/api/streetview/metadata";
const STATIC_ENDPOINT = "https://maps.googleapis.com/maps/api/streetview";

export interface DownloadOptions {
  apiKey: string;
  maxConcurrent: number;
  /** Set of `${panoId}:${heading}` pairs already in indexed_images — skip these (spec §4 step 4, §6.2). */
  existingPanoHeadings: Set<string>;
  retries?: number;
  retryBaseDelayMs?: number;
}

export interface DownloadResult {
  captures: StreetViewCapture[];
  /** Points where every heading came back with no Street View coverage. */
  failedPoints: number;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  baseDelayMs: number
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

async function fetchMetadata(
  point: SampledPoint,
  heading: number,
  apiKey: string
): Promise<{ panoId: string; date: string | null } | null> {
  const url = `${METADATA_ENDPOINT}?location=${point.lat},${point.lng}&heading=${heading}&key=${apiKey}`;
  const res = await fetch(url);
  const body = (await res.json()) as { status: string; pano_id?: string; date?: string };
  if (body.status !== "OK" || !body.pano_id) return null;
  return { panoId: body.pano_id, date: body.date ?? null };
}

async function fetchImage(
  panoId: string,
  heading: number,
  apiKey: string,
  retries: number,
  retryBaseDelayMs: number
): Promise<string> {
  return withRetry(
    async () => {
      const url = `${STATIC_ENDPOINT}?pano=${panoId}&heading=${heading}&size=640x640&key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Street View Static API returned ${res.status} for pano ${panoId}`);
      }
      const buf = await res.arrayBuffer();
      return Buffer.from(buf).toString("base64");
    },
    retries,
    retryBaseDelayMs
  );
}

/**
 * Downloads Street View captures for every point × heading pair, deduping
 * against already-indexed pano/heading pairs and respecting a concurrency
 * cap (spec §4, §6.2, §12.2 MAX_CONCURRENT_REQUESTS). Metadata lookups
 * always run (they're how dedupe/coverage is determined); static image
 * downloads only run for pairs that are new and have coverage.
 */
export async function downloadCaptures(
  points: SampledPoint[],
  headings: readonly number[],
  options: DownloadOptions
): Promise<DownloadResult> {
  const limit = pLimit(options.maxConcurrent);
  const retries = options.retries ?? 1;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 200;
  const seenThisRun = new Set(options.existingPanoHeadings);

  let failedPoints = 0;

  const perPointResults = await Promise.all(
    points.map((point) =>
      limit(async () => {
        const captures: StreetViewCapture[] = [];
        let anyCoverage = false;

        for (const heading of headings) {
          const meta = await limit(() => fetchMetadata(point, heading, options.apiKey));
          if (!meta) continue;
          anyCoverage = true;

          const dedupeKey = `${meta.panoId}:${heading}`;
          if (seenThisRun.has(dedupeKey)) continue;
          seenThisRun.add(dedupeKey);

          const imageBase64 = await fetchImage(
            meta.panoId,
            heading,
            options.apiKey,
            retries,
            retryBaseDelayMs
          );

          captures.push({
            panoId: meta.panoId,
            heading,
            lat: point.lat,
            lng: point.lng,
            captureDate: meta.date,
            imageBase64,
          });
        }

        return { captures, failed: !anyCoverage };
      })
    )
  );

  const captures = perPointResults.flatMap((r) => r.captures);
  failedPoints = perPointResults.filter((r) => r.failed).length;

  return { captures, failedPoints };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && pnpm test street-view.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/street-view.ts apps/worker/src/street-view.test.ts
git commit -m "feat(worker): Street View download with metadata dedupe, concurrency limit, and retry (spec §4, §6.2, §12.2)"
```

---

### Task 7: Inference service HTTP client

**Files:**
- Create: `apps/worker/src/inference-client.ts`
- Create: `apps/worker/src/inference-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/worker/src/inference-client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { embedImages } from "./inference-client";

afterEach(() => vi.unstubAllGlobals());

describe("embedImages", () => {
  it("POSTs a batch of base64 images and returns their embeddings in order", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await embedImages(["aaaa", "bbbb"], "http://localhost:8000");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ images_base64: ["aaaa", "bbbb"] }),
      })
    );
    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it("throws a descriptive error when the service responds with a non-OK status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "model not loaded" })
    );

    await expect(embedImages(["aaaa"], "http://localhost:8000")).rejects.toThrow(
      /Inference service \/embed failed \(503\): model not loaded/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && pnpm test inference-client.test.ts`
Expected: FAIL — `Cannot find module './inference-client'`.

- [ ] **Step 3: Implement `inference-client.ts`**

```typescript
// apps/worker/src/inference-client.ts

export async function embedImages(
  imagesBase64: string[],
  inferenceBaseUrl: string
): Promise<number[][]> {
  const res = await fetch(`${inferenceBaseUrl}/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images_base64: imagesBase64 }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Inference service /embed failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { embeddings: number[][] };
  return body.embeddings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && pnpm test inference-client.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/inference-client.ts apps/worker/src/inference-client.test.ts
git commit -m "feat(worker): HTTP client for the inference service's /embed endpoint"
```

---

### Task 8: Progress writer

**Files:**
- Create: `apps/worker/src/progress.ts`
- Create: `apps/worker/src/progress.test.ts`

- [ ] **Step 1: Write the failing test (against the real test DB, same pattern as Foundation's settings-repo test)**

```typescript
// apps/worker/src/progress.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { updateAreaProgress, loadExistingPanoHeadings } from "./progress";

const connectionString =
  process.env.TEST_DATABASE_URL ?? "postgres://netryx:changeme@localhost:5432/netryx_test";
const pool = new Pool({ connectionString });
const AREA_ID = "00000000-0000-0000-0000-0000000000aa";

beforeEach(async () => {
  await pool.query("DELETE FROM indexed_images");
  await pool.query("DELETE FROM areas");
  await pool.query(
    `INSERT INTO areas (id, geometry, area_km2) VALUES ($1, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), 1.0)`,
    [AREA_ID]
  );
});

afterAll(async () => {
  await pool.end();
});

describe("updateAreaProgress", () => {
  it("updates only the provided columns", async () => {
    await updateAreaProgress(pool, AREA_ID, { status: "indexing", pointsEstimated: 500 });
    const { rows } = await pool.query("SELECT status, points_estimated, points_captured FROM areas WHERE id = $1", [AREA_ID]);
    expect(rows[0].status).toBe("indexing");
    expect(rows[0].points_estimated).toBe(500);
    expect(rows[0].points_captured).toBe(0); // untouched

    await updateAreaProgress(pool, AREA_ID, { pointsCaptured: 42, imagesEmbedded: 40 });
    const { rows: rows2 } = await pool.query(
      "SELECT status, points_captured, images_embedded FROM areas WHERE id = $1",
      [AREA_ID]
    );
    expect(rows2[0].status).toBe("indexing"); // untouched by the second call
    expect(rows2[0].points_captured).toBe(42);
    expect(rows2[0].images_embedded).toBe(40);
  });
});

describe("loadExistingPanoHeadings", () => {
  it("returns pano_id:heading pairs already present across all areas", async () => {
    await pool.query(
      `INSERT INTO indexed_images (area_id, pano_id, heading, location)
       VALUES ($1, 'pano-existing', 90, ST_GeogFromText('POINT(0 0)'))`,
      [AREA_ID]
    );

    const set = await loadExistingPanoHeadings(pool);
    expect(set.has("pano-existing:90")).toBe(true);
    expect(set.has("pano-existing:0")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test progress.test.ts`
Expected: FAIL — `Cannot find module './progress'`.

- [ ] **Step 3: Implement `progress.ts`**

```typescript
// apps/worker/src/progress.ts
import type { Pool } from "pg";
import type { AreaStatus } from "@netryx/shared-types";

export interface AreaProgressUpdate {
  status?: AreaStatus;
  pointsEstimated?: number;
  pointsCaptured?: number;
  pointsFailed?: number;
  imagesEmbedded?: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
}

const COLUMN_MAP: Record<keyof AreaProgressUpdate, string> = {
  status: "status",
  pointsEstimated: "points_estimated",
  pointsCaptured: "points_captured",
  pointsFailed: "points_failed",
  imagesEmbedded: "images_embedded",
  estimatedCostUsd: "estimated_cost_usd",
  actualCostUsd: "actual_cost_usd",
};

/** Writes only the provided fields onto the areas row — this is what /api/areas/:id/progress (Task 15) polls. */
export async function updateAreaProgress(
  pool: Pool,
  areaId: string,
  update: AreaProgressUpdate
): Promise<void> {
  const entries = Object.entries(update) as [keyof AreaProgressUpdate, unknown][];
  if (entries.length === 0) return;

  const setClauses = entries.map(([key], i) => `${COLUMN_MAP[key]} = $${i + 2}`);
  const values = entries.map(([, value]) => value);

  await pool.query(
    `UPDATE areas SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $1`,
    [areaId, ...values]
  );
}

/** Global dedupe set: which pano_id/heading pairs are already indexed, across ALL areas (spec §4 step 4). */
export async function loadExistingPanoHeadings(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ pano_id: string; heading: number }>(
    "SELECT pano_id, heading FROM indexed_images"
  );
  return new Set(rows.map((r) => `${r.pano_id}:${r.heading}`));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test progress.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/progress.ts apps/worker/src/progress.test.ts
git commit -m "feat(worker): area progress writer + global pano/heading dedupe lookup"
```

---

### Task 9: pg-boss queue wrapper

**Files:**
- Create: `apps/worker/src/queue.ts`

- [ ] **Step 1: Implement `queue.ts`**

No unit test here — `PgBoss` itself needs a live Postgres connection to do anything meaningful, and its own test suite already covers its internals. This is a thin, typed wrapper; it's verified via Task 11's manual end-to-end check instead.

```typescript
// apps/worker/src/queue.ts
import PgBoss from "pg-boss";
import { INDEX_AREA_JOB_NAME, type IndexAreaJobPayload } from "@netryx/shared-types";

export { INDEX_AREA_JOB_NAME };
export type { IndexAreaJobPayload };

let boss: PgBoss | undefined;

export async function getBoss(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    });
    await boss.start();
  }
  return boss;
}

/** Used by apps/web's POST /api/areas (Task 14) — enqueues and returns instantly. */
export async function enqueueIndexAreaJob(payload: IndexAreaJobPayload): Promise<string> {
  const client = await getBoss();
  const jobId = await client.send(INDEX_AREA_JOB_NAME, payload);
  if (!jobId) {
    throw new Error("pg-boss declined to enqueue the index-area job");
  }
  return jobId;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/worker && pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/queue.ts
git commit -m "feat(worker): pg-boss queue wrapper for the index-area job"
```

---

### Task 10: Job orchestration (`jobs/index-area.ts`)

This is where the full pipeline is wired together, with every dependency injected so the orchestration logic (order of operations, status transitions, partial-failure handling) can be tested without a real DB, real Overpass, real Street View, or real inference service.

**Files:**
- Create: `apps/worker/src/jobs/index-area.ts`
- Create: `apps/worker/src/jobs/index-area.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/worker/src/jobs/index-area.test.ts
import { describe, it, expect, vi } from "vitest";
import { runIndexAreaJob, type IndexAreaJobDeps } from "./index-area";
import type { AreaRow } from "@netryx/shared-types";

function makeDeps(overrides: Partial<IndexAreaJobDeps> = {}): IndexAreaJobDeps {
  const area: AreaRow = {
    id: "area-1",
    name: null,
    areaKm2: 2,
    status: "pending",
    pointsEstimated: 0,
    pointsCaptured: 0,
    pointsFailed: 0,
    imagesEmbedded: 0,
    estimatedCostUsd: null,
    actualCostUsd: null,
  };

  return {
    getArea: vi.fn().mockResolvedValue(area),
    getAreaPolygon: vi.fn().mockResolvedValue([[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]),
    fetchStreetGeometry: vi.fn().mockResolvedValue([
      { type: "LineString", coordinates: [[0, 0], [0, 0.001]] },
    ]),
    samplePointsAlongStreets: vi.fn().mockReturnValue([
      { lat: 0, lng: 0 },
      { lat: 0.0005, lng: 0 },
    ]),
    loadExistingPanoHeadings: vi.fn().mockResolvedValue(new Set<string>()),
    downloadCaptures: vi.fn().mockResolvedValue({
      captures: [
        { panoId: "p1", heading: 0, lat: 0, lng: 0, captureDate: "2024-01", imageBase64: "aaa" },
        { panoId: "p2", heading: 90, lat: 0.0005, lng: 0, captureDate: "2024-01", imageBase64: "bbb" },
      ],
      failedPoints: 0,
    }),
    embedImages: vi.fn().mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4],
    ]),
    insertIndexedImages: vi.fn().mockResolvedValue(undefined),
    updateAreaProgress: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn(async (key: string) => {
      const values: Record<string, string> = {
        GOOGLE_MAPS_API_KEY: "test-key",
        MAX_CONCURRENT_REQUESTS: "5",
        STREET_VIEW_PRICE_PER_IMAGE_USD: "0.007",
      };
      return values[key] ?? null;
    }),
    inferenceBaseUrl: "http://localhost:8000",
    ...overrides,
  };
}

describe("runIndexAreaJob", () => {
  it("walks the full pipeline and marks the area indexed", async () => {
    const deps = makeDeps();

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    expect(deps.fetchStreetGeometry).toHaveBeenCalledWith([[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]);
    expect(deps.downloadCaptures).toHaveBeenCalled();
    expect(deps.embedImages).toHaveBeenCalledWith(["aaa", "bbb"], "http://localhost:8000");
    expect(deps.insertIndexedImages).toHaveBeenCalledWith(
      "area-1",
      expect.arrayContaining([
        expect.objectContaining({ panoId: "p1", embedding: [0.1, 0.2] }),
        expect.objectContaining({ panoId: "p2", embedding: [0.3, 0.4] }),
      ])
    );

    const statusCalls = (deps.updateAreaProgress as any).mock.calls.map((c: any[]) => c[1]);
    expect(statusCalls[0]).toEqual(expect.objectContaining({ status: "indexing" }));
    expect(statusCalls[statusCalls.length - 1]).toEqual(
      expect.objectContaining({ status: "indexed", pointsCaptured: 2, imagesEmbedded: 2 })
    );
  });

  it("computes actual_cost_usd from the number of images actually downloaded, not the estimate", async () => {
    const deps = makeDeps();
    await runIndexAreaJob({ areaId: "area-1" }, deps);

    const finalUpdate = (deps.updateAreaProgress as any).mock.calls.at(-1)[1];
    expect(finalUpdate.actualCostUsd).toBeCloseTo(2 * 0.007, 5); // 2 images downloaded
  });

  it("marks the area failed (not indexed) and records points_failed when NO images were embedded at all", async () => {
    const deps = makeDeps({
      downloadCaptures: vi.fn().mockResolvedValue({ captures: [], failedPoints: 2 }),
    });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    const finalUpdate = (deps.updateAreaProgress as any).mock.calls.at(-1)[1];
    expect(finalUpdate.status).toBe("failed");
    expect(finalUpdate.pointsFailed).toBe(2);
    expect(deps.embedImages).not.toHaveBeenCalled();
  });

  it("still marks the area indexed (partial success) when some but not all points failed", async () => {
    const deps = makeDeps({
      downloadCaptures: vi.fn().mockResolvedValue({
        captures: [{ panoId: "p1", heading: 0, lat: 0, lng: 0, captureDate: null, imageBase64: "aaa" }],
        failedPoints: 1,
      }),
      embedImages: vi.fn().mockResolvedValue([[0.1, 0.2]]),
    });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    const finalUpdate = (deps.updateAreaProgress as any).mock.calls.at(-1)[1];
    expect(finalUpdate.status).toBe("indexed");
    expect(finalUpdate.pointsFailed).toBe(1);
    expect(finalUpdate.imagesEmbedded).toBe(1);
  });

  it("marks the area failed if the inference service throws, without insertIndexedImages ever running", async () => {
    const deps = makeDeps({
      embedImages: vi.fn().mockRejectedValue(new Error("inference service unreachable")),
    });

    await runIndexAreaJob({ areaId: "area-1" }, deps);

    expect(deps.insertIndexedImages).not.toHaveBeenCalled();
    const finalUpdate = (deps.updateAreaProgress as any).mock.calls.at(-1)[1];
    expect(finalUpdate.status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && pnpm test jobs/index-area.test.ts`
Expected: FAIL — `Cannot find module './index-area'`.

- [ ] **Step 3: Implement `index-area.ts`**

```typescript
// apps/worker/src/jobs/index-area.ts
import type { IndexAreaJobPayload, AreaRow, SampledPoint, StreetViewCapture } from "@netryx/shared-types";
import { STREET_VIEW_HEADINGS } from "@netryx/shared-types";
import type { LineStringGeoJSON } from "@netryx/geo-sampling";
import type { AreaProgressUpdate } from "../progress";

export interface IndexedImageInsert {
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  captureDate: string | null;
  embedding: number[];
}

export interface IndexAreaJobDeps {
  getArea: (areaId: string) => Promise<AreaRow>;
  getAreaPolygon: (areaId: string) => Promise<[number, number][]>;
  fetchStreetGeometry: (polygon: [number, number][]) => Promise<LineStringGeoJSON[]>;
  samplePointsAlongStreets: (lines: LineStringGeoJSON[], spacingMeters: number) => SampledPoint[];
  loadExistingPanoHeadings: () => Promise<Set<string>>;
  downloadCaptures: (
    points: SampledPoint[],
    headings: readonly number[],
    opts: { apiKey: string; maxConcurrent: number; existingPanoHeadings: Set<string> }
  ) => Promise<{ captures: StreetViewCapture[]; failedPoints: number }>;
  embedImages: (imagesBase64: string[], inferenceBaseUrl: string) => Promise<number[][]>;
  insertIndexedImages: (areaId: string, images: IndexedImageInsert[]) => Promise<void>;
  updateAreaProgress: (areaId: string, update: AreaProgressUpdate) => Promise<void>;
  getSetting: (key: string) => Promise<string | null>;
  inferenceBaseUrl: string;
}

const SAMPLING_SPACING_METERS = 18; // midpoint of the spec's "every ~15-20m" (spec §4 step 2)

export async function runIndexAreaJob(
  payload: IndexAreaJobPayload,
  deps: IndexAreaJobDeps
): Promise<void> {
  const { areaId } = payload;

  await deps.updateAreaProgress(areaId, { status: "indexing" });

  const [polygon, apiKey, maxConcurrentRaw, pricePerImageRaw, existingPanoHeadings] = await Promise.all([
    deps.getAreaPolygon(areaId),
    deps.getSetting("GOOGLE_MAPS_API_KEY"),
    deps.getSetting("MAX_CONCURRENT_REQUESTS"),
    deps.getSetting("STREET_VIEW_PRICE_PER_IMAGE_USD"),
    deps.loadExistingPanoHeadings(),
  ]);

  if (!apiKey) {
    await deps.updateAreaProgress(areaId, { status: "failed" });
    throw new Error("GOOGLE_MAPS_API_KEY is not configured — cannot index (spec §14.5)");
  }

  const maxConcurrent = Number(maxConcurrentRaw ?? 10);
  const pricePerImageUsd = Number(pricePerImageRaw ?? 0.007);

  const lines = await deps.fetchStreetGeometry(polygon);
  const points = deps.samplePointsAlongStreets(lines, SAMPLING_SPACING_METERS);

  await deps.updateAreaProgress(areaId, { pointsEstimated: points.length });

  const { captures, failedPoints } = await deps.downloadCaptures(points, STREET_VIEW_HEADINGS, {
    apiKey,
    maxConcurrent,
    existingPanoHeadings,
  });

  await deps.updateAreaProgress(areaId, {
    pointsCaptured: points.length - failedPoints,
    pointsFailed: failedPoints,
  });

  if (captures.length === 0) {
    await deps.updateAreaProgress(areaId, { status: "failed", pointsFailed: failedPoints });
    return;
  }

  let embeddings: number[][];
  try {
    embeddings = await deps.embedImages(
      captures.map((c) => c.imageBase64),
      deps.inferenceBaseUrl
    );
  } catch (err) {
    await deps.updateAreaProgress(areaId, { status: "failed", pointsFailed: failedPoints });
    throw err;
  }

  const inserts: IndexedImageInsert[] = captures.map((capture, i) => ({
    panoId: capture.panoId,
    heading: capture.heading,
    lat: capture.lat,
    lng: capture.lng,
    captureDate: capture.captureDate,
    embedding: embeddings[i],
  }));

  await deps.insertIndexedImages(areaId, inserts);

  const actualCostUsd = captures.length * pricePerImageUsd;

  await deps.updateAreaProgress(areaId, {
    status: "indexed",
    pointsFailed: failedPoints,
    imagesEmbedded: inserts.length,
    actualCostUsd,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/worker && pnpm test jobs/index-area.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/jobs
git commit -m "feat(worker): index-area job orchestration with DI, partial-failure and inference-failure handling (spec §4, §9.1, §12.3)"
```

---

### Task 11: Wire real dependencies + pg-boss consumer (`index.ts`)

**Files:**
- Modify: `apps/worker/src/index.ts`
- Create: `apps/worker/src/db-queries.ts`

- [ ] **Step 1: Create the real (non-mocked) DB query functions the job needs**

```typescript
// apps/worker/src/db-queries.ts
import type { Pool } from "pg";
import type { AreaRow } from "@netryx/shared-types";
import type { IndexedImageInsert } from "./jobs/index-area";

export async function getArea(pool: Pool, areaId: string): Promise<AreaRow> {
  const { rows } = await pool.query(
    `SELECT id, name, area_km2, status, points_estimated, points_captured,
            points_failed, images_embedded, estimated_cost_usd, actual_cost_usd
     FROM areas WHERE id = $1`,
    [areaId]
  );
  if (rows.length === 0) throw new Error(`Area ${areaId} not found`);
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    areaKm2: Number(r.area_km2),
    status: r.status,
    pointsEstimated: r.points_estimated,
    pointsCaptured: r.points_captured,
    pointsFailed: r.points_failed,
    imagesEmbedded: r.images_embedded,
    estimatedCostUsd: r.estimated_cost_usd === null ? null : Number(r.estimated_cost_usd),
    actualCostUsd: r.actual_cost_usd === null ? null : Number(r.actual_cost_usd),
  };
}

export async function getAreaPolygon(pool: Pool, areaId: string): Promise<[number, number][]> {
  const { rows } = await pool.query(
    `SELECT ST_AsGeoJSON(geometry) AS geojson FROM areas WHERE id = $1`,
    [areaId]
  );
  if (rows.length === 0) throw new Error(`Area ${areaId} not found`);
  const geojson = JSON.parse(rows[0].geojson) as { coordinates: [number, number][][] };
  return geojson.coordinates[0];
}

export async function insertIndexedImages(
  pool: Pool,
  areaId: string,
  images: IndexedImageInsert[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const img of images) {
      await client.query(
        `INSERT INTO indexed_images (area_id, pano_id, heading, location, street_view_date, embedding, embedded_at)
         VALUES ($1, $2, $3, ST_GeogFromText($4), $5, $6, now())
         ON CONFLICT (pano_id, heading) DO NOTHING`,
        [
          areaId,
          img.panoId,
          img.heading,
          `POINT(${img.lng} ${img.lat})`,
          img.captureDate ? `${img.captureDate}-01` : null,
          `[${img.embedding.join(",")}]`,
        ]
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

- [ ] **Step 2: Wire it all together in `index.ts`**

```typescript
// apps/worker/src/index.ts
import { getBoss, INDEX_AREA_JOB_NAME } from "./queue";
import { getPool } from "./db";
import { getSettingsRepo } from "./settings";
import { runIndexAreaJob } from "./jobs/index-area";
import { downloadCaptures } from "./street-view";
import { embedImages } from "./inference-client";
import { updateAreaProgress, loadExistingPanoHeadings } from "./progress";
import { fetchStreetGeometry, samplePointsAlongStreets } from "@netryx/geo-sampling";
import { getArea, getAreaPolygon, insertIndexedImages } from "./db-queries";

async function main() {
  const pool = getPool();
  const settingsRepo = getSettingsRepo();
  const boss = await getBoss();
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

  await boss.work(INDEX_AREA_JOB_NAME, async (job) => {
    await runIndexAreaJob(job.data, {
      getArea: (id) => getArea(pool, id),
      getAreaPolygon: (id) => getAreaPolygon(pool, id),
      fetchStreetGeometry,
      samplePointsAlongStreets: (lines, spacing) => samplePointsAlongStreets(lines, spacing),
      loadExistingPanoHeadings: () => loadExistingPanoHeadings(pool),
      downloadCaptures,
      embedImages,
      insertIndexedImages: (areaId, images) => insertIndexedImages(pool, areaId, images),
      updateAreaProgress: (areaId, update) => updateAreaProgress(pool, areaId, update),
      getSetting: (key) => settingsRepo.getSetting(key),
      inferenceBaseUrl,
    });
  });

  console.log(`netryx worker listening for "${INDEX_AREA_JOB_NAME}" jobs`);
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/worker && pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification (requires a running Postgres with the Foundation + Task 1 migrations applied)**

Run: `cd apps/worker && pnpm start`
Expected: logs `netryx worker listening for "index-area" jobs` and stays running without crashing (pg-boss auto-creates its own schema tables on first `start()`).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/db-queries.ts
git commit -m "feat(worker): wire real Postgres/Overpass/Street View/inference deps into the pg-boss consumer"
```

---

### Task 12: Inference service — settings + model loader

**Files:**
- Create: `services/inference/requirements.txt`
- Create: `services/inference/settings.py`
- Create: `services/inference/test_settings.py`
- Create: `services/inference/loader.py`
- Create: `services/inference/test_loader.py`

- [ ] **Step 1: Create `requirements.txt`**

```
# services/inference/requirements.txt
fastapi==0.111.0
uvicorn[standard]==0.30.1
torch==2.3.1
psycopg2-binary==2.9.9
pytest==8.2.2
httpx==0.27.0
```

- [ ] **Step 2: Write the failing test for settings**

```python
# services/inference/test_settings.py
from unittest.mock import MagicMock
from settings import get_active_model_ids


def _mock_conn(rows):
    conn = MagicMock()
    cursor = MagicMock()
    cursor.fetchall.return_value = rows
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn


def test_reads_retrieval_and_verification_model_from_system_settings():
    conn = _mock_conn(
        [("RETRIEVAL_MODEL", "lumi-preview"), ("VERIFICATION_MODEL", "laila")]
    )
    retrieval, verification = get_active_model_ids(conn)
    assert retrieval == "lumi-preview"
    assert verification == "laila"


def test_falls_back_to_defaults_when_settings_row_is_missing():
    conn = _mock_conn([])
    retrieval, verification = get_active_model_ids(conn)
    assert retrieval == "lumi-preview"
    assert verification == "laila"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/inference && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && pytest test_settings.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'settings'`.

- [ ] **Step 4: Implement `settings.py` (spec §14.5 — read once at startup, never per-request)**

```python
# services/inference/settings.py
"""
Reads RETRIEVAL_MODEL / VERIFICATION_MODEL directly from system_settings.
Called exactly once, at process startup (spec §14.5, §15.4) — this service
never re-reads system_settings on a per-/embed-request basis.

These two settings are never marked is_secret (see packages/shared-types/src/
settings.ts, spec §15.3), so no decryption is needed here — that keeps this
service free of any dependency on the Node-side AES-256-GCM key file.
"""

DEFAULT_RETRIEVAL_MODEL = "lumi-preview"
DEFAULT_VERIFICATION_MODEL = "laila"


def get_active_model_ids(conn) -> tuple[str, str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT key, value FROM system_settings WHERE key IN "
            "('RETRIEVAL_MODEL', 'VERIFICATION_MODEL')"
        )
        rows = dict(cur.fetchall())

    return (
        rows.get("RETRIEVAL_MODEL", DEFAULT_RETRIEVAL_MODEL),
        rows.get("VERIFICATION_MODEL", DEFAULT_VERIFICATION_MODEL),
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/inference && pytest test_settings.py`
Expected: PASS — 2 tests green.

- [ ] **Step 6: Write the failing test for the model loader**

```python
# services/inference/test_loader.py
import pytest
from unittest.mock import MagicMock
from loader import load_retrieval_model, UnknownModelError


def test_loads_lumi_preview_via_the_megaloc_torch_hub_repo(monkeypatch):
    mock_hub_load = MagicMock(return_value="fake-model-instance")
    monkeypatch.setattr("loader.torch.hub.load", mock_hub_load)

    model = load_retrieval_model("lumi-preview")

    mock_hub_load.assert_called_once_with("gmberton/MegaLoc", "get_trained_model")
    assert model == "fake-model-instance"


def test_raises_a_clear_error_for_an_id_not_in_the_registry():
    with pytest.raises(UnknownModelError, match="not-a-real-model"):
        load_retrieval_model("not-a-real-model")
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd services/inference && pytest test_loader.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'loader'`.

- [ ] **Step 8: Implement `loader.py`**

```python
# services/inference/loader.py
"""
Loads the frozen retrieval backbone selected in system_settings (spec §3.1,
§15.1, §15.3). No fine-tuning happens anywhere in this file — it only
resolves a registry id to a torch.hub call.
"""
import torch
from models.registry import RETRIEVAL_MODELS


class UnknownModelError(Exception):
    pass


def load_retrieval_model(model_id: str):
    entry = next((m for m in RETRIEVAL_MODELS if m["id"] == model_id), None)
    if entry is None:
        raise UnknownModelError(f"Unknown retrieval model id: {model_id}")

    if model_id == "lumi-preview":
        return torch.hub.load("gmberton/MegaLoc", "get_trained_model")

    raise UnknownModelError(f"No loader implemented for retrieval model id: {model_id}")
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd services/inference && pytest test_loader.py`
Expected: PASS — 2 tests green.

- [ ] **Step 10: Commit**

```bash
git add services/inference/requirements.txt services/inference/settings.py services/inference/test_settings.py services/inference/loader.py services/inference/test_loader.py
git commit -m "feat(inference): read active model ids from system_settings once at startup; torch.hub loader for Lumi Preview (spec §14.5, §15.1)"
```

---

### Task 13: FastAPI app — `/embed` endpoint

**Files:**
- Create: `services/inference/main.py`
- Create: `services/inference/test_main.py`

- [ ] **Step 1: Write the failing test**

The real MegaLoc model is never invoked in tests — `main.py` accepts an injectable model object via FastAPI's dependency-override mechanism, so tests exercise real request/response handling and real L2 normalization without downloading any weights.

```python
# services/inference/test_main.py
import base64
import numpy as np
from fastapi.testclient import TestClient
from main import app, get_retrieval_model


class FakeModel:
    """Returns a fixed, NON-unit-norm vector per image so the test can prove main.py normalizes it."""

    def __call__(self, batch):
        # batch: torch-like stand-in, len(batch) images -> one 4-d vector each
        return np.array([[3.0, 0.0, 4.0, 0.0] for _ in range(len(batch))])


def _override_model():
    return FakeModel()


app.dependency_overrides[get_retrieval_model] = _override_model
client = TestClient(app)


def _fake_image_base64() -> str:
    # 1x1 pixel PNG, content doesn't matter — main.py only needs valid image bytes to decode.
    png_1x1 = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
        "53de0000000c4944415478da6360606060000000050001a5f645400000000049454e44ae426082"
    )
    return base64.b64encode(png_1x1).decode("ascii")


def test_embed_returns_one_l2_normalized_vector_per_image():
    img = _fake_image_base64()
    res = client.post("/embed", json={"images_base64": [img, img]})

    assert res.status_code == 200
    body = res.json()
    assert len(body["embeddings"]) == 2
    for vec in body["embeddings"]:
        norm = sum(v * v for v in vec) ** 0.5
        assert abs(norm - 1.0) < 1e-6  # [3,0,4,0] has norm 5 -> normalized to unit length


def test_embed_rejects_an_empty_batch():
    res = client.post("/embed", json={"images_base64": []})
    assert res.status_code == 400


def test_embed_rejects_invalid_base64():
    res = client.post("/embed", json={"images_base64": ["not-valid-base64!!"]})
    assert res.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/inference && pytest test_main.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'main'`.

- [ ] **Step 3: Implement `main.py`**

```python
# services/inference/main.py
import base64
import binascii
import io

import numpy as np
from fastapi import Depends, FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel

from loader import load_retrieval_model
from settings import get_active_model_ids

app = FastAPI(title="netryx-fork inference service")

_model_holder: dict = {}


class EmbedRequest(BaseModel):
    images_base64: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]


def get_retrieval_model():
    """
    Overridden in tests via app.dependency_overrides. In production this is
    populated once at startup by the lifespan handler below — never per
    request (spec §6.2, §14.5, §15.4).
    """
    if "model" not in _model_holder:
        raise HTTPException(status_code=503, detail="Retrieval model not loaded yet")
    return _model_holder["model"]


@app.on_event("startup")
def load_model_once() -> None:
    import psycopg2
    import os

    conn = psycopg2.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        user=os.environ.get("POSTGRES_USER", "netryx"),
        password=os.environ.get("POSTGRES_PASSWORD", "changeme"),
        dbname=os.environ.get("POSTGRES_DB", "netryx_dev"),
    )
    try:
        retrieval_model_id, _verification_model_id = get_active_model_ids(conn)
    finally:
        conn.close()

    _model_holder["model"] = load_retrieval_model(retrieval_model_id)


def _decode_image(image_base64: str) -> np.ndarray:
    try:
        raw = base64.b64decode(image_base64, validate=True)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        return np.array(img)
    except (binascii.Error, ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {exc}") from exc


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest, model=Depends(get_retrieval_model)) -> EmbedResponse:
    if len(request.images_base64) == 0:
        raise HTTPException(status_code=400, detail="images_base64 must not be empty")

    batch = [_decode_image(img) for img in request.images_base64]
    raw_vectors = model(batch)

    embeddings = []
    for vec in raw_vectors:
        vec = np.asarray(vec, dtype=np.float64)
        norm = np.linalg.norm(vec)
        normalized = vec / norm if norm > 0 else vec
        embeddings.append(normalized.tolist())

    return EmbedResponse(embeddings=embeddings)
```

- [ ] **Step 4: Add `Pillow` to `requirements.txt`**

```
# services/inference/requirements.txt — append
Pillow==10.4.0
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/inference && pip install -r requirements.txt && pytest test_main.py`
Expected: PASS — 3 tests green.

- [ ] **Step 6: Manual verification (requires a real Postgres reachable + enough disk/network for torch.hub to fetch MegaLoc weights on first run)**

Run: `cd services/inference && uvicorn main:app --port 8000`
Expected: logs show FastAPI startup completing (model download may take a few minutes the first time); `curl http://localhost:8000/docs` returns the Swagger UI.

- [ ] **Step 7: Commit**

```bash
git add services/inference/main.py services/inference/test_main.py services/inference/requirements.txt
git commit -m "feat(inference): FastAPI /embed endpoint, model loaded once at startup via dependency injection (spec §3.1, §6.2)"
```

---

### Task 14: `POST /api/areas` (create + enqueue) and `GET /api/areas` (list)

**Files:**
- Create: `apps/web/app/api/areas/route.ts`
- Create: `apps/web/app/api/areas/route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/app/api/areas/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@netryx/geo-sampling", () => ({
  fetchStreetGeometry: vi.fn().mockResolvedValue([
    { type: "LineString", coordinates: [[0, 0], [0, 0.001]] },
  ]),
  samplePointsAlongStreets: vi.fn().mockReturnValue(
    Array.from({ length: 100 }, (_, i) => ({ lat: i, lng: 0 }))
  ),
  estimateIndexingCostUsd: vi.fn().mockReturnValue(2.8),
  assertAreaWithinSizeLimit: vi.fn(),
}));

vi.mock("../../../lib/settings-repo", () => ({
  getSettingsRepo: () => ({
    getSetting: vi.fn(async (key: string) => {
      const values: Record<string, string> = {
        MAX_AREA_KM2: "5",
        STREET_VIEW_PRICE_PER_IMAGE_USD: "0.007",
      };
      return values[key] ?? null;
    }),
  }),
}));

const insertedAreas: any[] = [];
const enqueuedJobs: any[] = [];

vi.mock("../../../lib/db", () => ({
  getPool: () => ({
    query: vi.fn(async (sql: string, params: any[]) => {
      if (sql.includes("INSERT INTO areas")) {
        const row = { id: "generated-area-id", ...params };
        insertedAreas.push(row);
        return { rows: [{ id: "generated-area-id" }] };
      }
      if (sql.includes("SELECT") && sql.includes("FROM areas")) {
        return { rows: insertedAreas };
      }
      return { rows: [] };
    }),
  }),
}));

vi.mock("../../../lib/queue", () => ({
  enqueueIndexAreaJob: vi.fn(async (payload: any) => {
    enqueuedJobs.push(payload);
    return "job-1";
  }),
}));

import { POST, GET } from "./route";

beforeEach(() => {
  insertedAreas.length = 0;
  enqueuedJobs.length = 0;
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/areas", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/areas", () => {
  const validPolygon = [[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]];

  it("rejects a polygon whose area exceeds MAX_AREA_KM2", async () => {
    const geoSampling = await import("@netryx/geo-sampling");
    (geoSampling.assertAreaWithinSizeLimit as any).mockImplementationOnce(() => {
      throw new Error("Area of 12 km² exceeds the configured limit of 5 km²");
    });

    const res = await POST(makeRequest({ polygon: validPolygon, areaKm2: 12 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/exceeds the configured limit/);
    expect(enqueuedJobs).toHaveLength(0);
  });

  it("creates the area row with an estimated cost and enqueues the indexing job", async () => {
    const res = await POST(makeRequest({ polygon: validPolygon, areaKm2: 2, name: "Test area" }));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.areaId).toBe("generated-area-id");
    expect(json.estimatedCostUsd).toBe(2.8);
    expect(json.pointsEstimated).toBe(100);

    expect(enqueuedJobs).toEqual([{ areaId: "generated-area-id" }]);
  });

  it("rejects a request missing polygon", async () => {
    const res = await POST(makeRequest({ areaKm2: 2 }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/areas", () => {
  it("returns 200 with an (empty) list", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.areas)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test app/api/areas/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Create `lib/queue.ts` re-export so `apps/web` can enqueue without depending on `apps/worker` directly**

```typescript
// apps/web/lib/queue.ts
import PgBoss from "pg-boss";
import { getPool } from "./db";

const INDEX_AREA_JOB_NAME = "index-area";

let boss: PgBoss | undefined;

async function getBoss(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss({
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    });
    await boss.start();
  }
  return boss;
}

export async function enqueueIndexAreaJob(payload: { areaId: string }): Promise<string> {
  const client = await getBoss();
  const jobId = await client.send(INDEX_AREA_JOB_NAME, payload);
  if (!jobId) throw new Error("pg-boss declined to enqueue the index-area job");
  return jobId;
}
```

Note: this duplicates `apps/worker/src/queue.ts`'s job name and connection setup rather than sharing it, because `pg-boss`'s `send()`/`work()` split is inherently a producer/consumer boundary — `apps/web` only ever calls `send`, never `work`, and pulling in the worker's full module would blur that boundary for no benefit. The job **name** (`"index-area"`) is still shared via `@netryx/shared-types`' `INDEX_AREA_JOB_NAME` to prevent it drifting between producer and consumer — use that constant instead of the local literal:

```typescript
// apps/web/lib/queue.ts — replace the literal with the shared constant
import { INDEX_AREA_JOB_NAME, type IndexAreaJobPayload } from "@netryx/shared-types";
// ...
export async function enqueueIndexAreaJob(payload: IndexAreaJobPayload): Promise<string> {
  const client = await getBoss();
  const jobId = await client.send(INDEX_AREA_JOB_NAME, payload);
  if (!jobId) throw new Error("pg-boss declined to enqueue the index-area job");
  return jobId;
}
```

- [ ] **Step 4: Add `pg-boss` and `@netryx/geo-sampling` to `apps/web/package.json`**

```json
// apps/web/package.json — add to "dependencies"
"@netryx/geo-sampling": "workspace:*",
"pg-boss": "^9.0.3",
```

- [ ] **Step 5: Implement `route.ts`**

```typescript
// apps/web/app/api/areas/route.ts
import { NextResponse } from "next/server";
import {
  fetchStreetGeometry,
  samplePointsAlongStreets,
  estimateIndexingCostUsd,
  assertAreaWithinSizeLimit,
} from "@netryx/geo-sampling";
import { STREET_VIEW_HEADINGS } from "@netryx/shared-types";
import { getSettingsRepo } from "../../../lib/settings-repo";
import { getPool } from "../../../lib/db";
import { enqueueIndexAreaJob } from "../../../lib/queue";

const SAMPLING_SPACING_METERS = 18;

interface CreateAreaBody {
  polygon?: [number, number][];
  areaKm2?: number;
  name?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateAreaBody;

  if (!body.polygon || !Array.isArray(body.polygon) || body.polygon.length < 4) {
    return NextResponse.json({ error: "polygon is required" }, { status: 400 });
  }
  if (typeof body.areaKm2 !== "number") {
    return NextResponse.json({ error: "areaKm2 is required" }, { status: 400 });
  }

  const repo = getSettingsRepo();
  const maxAreaKm2 = Number((await repo.getSetting("MAX_AREA_KM2")) ?? "5");
  const pricePerImageUsd = Number(
    (await repo.getSetting("STREET_VIEW_PRICE_PER_IMAGE_USD")) ?? "0.007"
  );

  try {
    assertAreaWithinSizeLimit(body.areaKm2, maxAreaKm2);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  let lines: Awaited<ReturnType<typeof fetchStreetGeometry>>;
  try {
    lines = await fetchStreetGeometry(body.polygon);
  } catch (err) {
    // Overpass is shared public infrastructure and does fail under load even
    // after fetchStreetGeometry's own retries are exhausted — surface a
    // clean, actionable error instead of an unhandled 500.
    return NextResponse.json(
      { error: `Could not reach the street data service — try again in a moment (${err instanceof Error ? err.message : String(err)})` },
      { status: 502 }
    );
  }

  const points = samplePointsAlongStreets(lines, SAMPLING_SPACING_METERS);
  const estimatedCostUsd = estimateIndexingCostUsd(
    points.length,
    STREET_VIEW_HEADINGS.length,
    pricePerImageUsd
  );

  const pool = getPool();
  const polygonWkt = `POLYGON((${body.polygon.map(([lng, lat]) => `${lng} ${lat}`).join(", ")}))`;
  const { rows } = await pool.query(
    `INSERT INTO areas (name, geometry, area_km2, status, points_estimated, estimated_cost_usd)
     VALUES ($1, ST_GeomFromText($2, 4326), $3, 'pending', $4, $5)
     RETURNING id`,
    [body.name ?? null, polygonWkt, body.areaKm2, points.length, estimatedCostUsd]
  );
  const areaId = rows[0].id as string;

  await enqueueIndexAreaJob({ areaId });

  return NextResponse.json(
    { areaId, pointsEstimated: points.length, estimatedCostUsd },
    { status: 201 }
  );
}

export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, name, area_km2, status, points_estimated, points_captured,
            points_failed, images_embedded, estimated_cost_usd, actual_cost_usd, created_at
     FROM areas ORDER BY created_at DESC`
  );
  return NextResponse.json({ areas: rows });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/web && pnpm install && pnpm test app/api/areas/route.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/areas/route.ts apps/web/app/api/areas/route.test.ts apps/web/lib/queue.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): POST /api/areas (validate, estimate cost, enqueue) and GET /api/areas (spec §9.1, §12.1)"
```

---

### Task 15: `GET /api/areas/:id/progress` (SSE)

**Files:**
- Create: `apps/web/app/api/areas/[id]/progress/route.ts`
- Create: `apps/web/app/api/areas/[id]/progress/route.test.ts`

- [ ] **Step 1: Write the failing test**

We test the pure formatting/polling-decision logic as an exported function, then wire it into the streaming `GET` handler — streaming responses themselves are awkward to assert on directly, but the decision of "what to send, and whether to keep polling" is exactly the part with real logic to get wrong.

```typescript
// apps/web/app/api/areas/[id]/progress/route.test.ts
import { describe, it, expect } from "vitest";
import { formatProgressEvent, isTerminalStatus } from "./route";

describe("formatProgressEvent", () => {
  it("formats an areas row as an SSE data event", () => {
    const event = formatProgressEvent({
      status: "indexing",
      points_estimated: 100,
      points_captured: 40,
      points_failed: 2,
      images_embedded: 38,
    });
    expect(event).toBe(
      'data: {"status":"indexing","pointsEstimated":100,"pointsCaptured":40,"pointsFailed":2,"imagesEmbedded":38}\n\n'
    );
  });
});

describe("isTerminalStatus", () => {
  it("treats indexed and failed as terminal", () => {
    expect(isTerminalStatus("indexed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
  });

  it("treats pending and indexing as non-terminal", () => {
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("indexing")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test app/api/areas/\[id\]/progress/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement `route.ts`**

```typescript
// apps/web/app/api/areas/[id]/progress/route.ts
import type { AreaStatus } from "@netryx/shared-types";
import { getPool } from "../../../../../lib/db";

interface AreaProgressRow {
  status: AreaStatus;
  points_estimated: number;
  points_captured: number;
  points_failed: number;
  images_embedded: number;
}

export function isTerminalStatus(status: AreaStatus): boolean {
  return status === "indexed" || status === "failed";
}

export function formatProgressEvent(row: AreaProgressRow): string {
  const payload = {
    status: row.status,
    pointsEstimated: row.points_estimated,
    pointsCaptured: row.points_captured,
    pointsFailed: row.points_failed,
    imagesEmbedded: row.images_embedded,
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const POLL_INTERVAL_MS = 1000;

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const pool = getPool();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      while (true) {
        const { rows } = await pool.query<AreaProgressRow>(
          `SELECT status, points_estimated, points_captured, points_failed, images_embedded
           FROM areas WHERE id = $1`,
          [params.id]
        );

        if (rows.length === 0) {
          controller.enqueue(encoder.encode(`event: error\ndata: area not found\n\n`));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(formatProgressEvent(rows[0])));

        if (isTerminalStatus(rows[0].status)) {
          controller.close();
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test app/api/areas/\[id\]/progress/route.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Manual verification**

Run: after creating an area via `POST /api/areas` and starting the worker, `curl -N http://localhost:3000/api/areas/<id>/progress`
Expected: a stream of `data: {...}` lines roughly once per second, ending after a final `status: "indexed"` or `"failed"` event.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/api/areas/[id]/progress"
git commit -m "feat(web): SSE progress endpoint polling the areas row (spec §6.2)"
```

---

## Self-Review

**1. Spec coverage:**
- §4 (grid via Overpass, 15-20m spacing, 4 headings, Street View Static API, metadata, MegaLoc embed) → Tasks 4, 6, 10, 12–13. ✔
- §6.1 (draw → area → job → progress → indexed) → Task 14 (create+enqueue) + Task 15 (progress) + Task 10 (job marks `indexed`). Drawing the polygon itself is Dashboard & Map UI plan; this plan accepts an already-computed polygon. ✔
- §6.2 (why not a Next.js API route — pg-boss, separate inference service with model loaded once, concurrent download with dedupe, batched inference, SSE progress) → Tasks 9, 12–13, 6, 10, 15. ✔
- §6.3 (Postgres + pgvector + PostGIS from the start) → already satisfied by Foundation; this plan's `insertIndexedImages` (Task 11) and `getAreaPolygon` (Task 11) are the first real consumers of those column types. ✔
- §7.0/§7.1 (pg-boss over Redis+BullMQ, native Windows) → Task 9 uses pg-boss exclusively; no Redis anywhere in this plan. ✔
- §9.1 (full indexing flow, dedupe by pano_id, concurrent download, batches to inference, insert, progress, final `indexed` status) → Tasks 6, 8, 10, 11, 14. ✔
- §12.1 (cost estimate before confirm) → Task 14's `POST /api/areas` computes and returns `estimatedCostUsd` before the job is even created. ✔
- §12.2 (MAX_AREA_KM2, MAX_CONCURRENT_REQUESTS hard limits) → Task 4 (`assertAreaWithinSizeLimit`), Task 6 (`maxConcurrent` respected via p-limit), Task 10 (reads `MAX_CONCURRENT_REQUESTS` from settings). `MAX_MONTHLY_BUDGET_USD` enforcement is intentionally **not** implemented here — see the note below. ⚠ (documented, not silently dropped)
- §12.3 (actual vs. estimated cost, retries not double-counted) → Task 10 computes `actualCostUsd` from images actually downloaded; Task 6's retry logic only counts a successful final attempt, never the failed ones, toward `captures`. Writing to the `api_usage` daily table is explicitly Cost tracking plan's job, not this one's. ✔ (by documented omission)
- §14.5 (worker reads `GOOGLE_MAPS_API_KEY`/limits from `system_settings`, short-TTL cache, no restart needed to pick up a new key) → Task 5 (`apps/worker/src/settings.ts` reuses the same `createSettingsRepo` with its 30s cache) + Task 10 (`getSetting` called fresh each job run). ✔
- §15.1/§15.3/§15.4 (Lumi Preview loaded via registry, once at startup, restart required to change) → Task 12 (`loader.py` reads the registry), Task 13 (`@app.on_event("startup")` loads exactly once; `/embed` never re-reads settings). ✔
- §8.3 (partial job failure, points failed count, overlap dedupe) → Task 1 (`points_failed` column), Task 10 (partial-failure test cases), Task 6 (per-point failure counting), Task 8/11 (global pano/heading dedupe across areas). ✔

**Note on the one intentional gap (`MAX_MONTHLY_BUDGET_USD`):** enforcing this meaningfully requires actual historical spend in `api_usage`, and *writing* to `api_usage` is explicitly scoped to the Cost tracking plan (per Foundation's own deferred list). Implementing a check against a table nothing writes to yet would be a check that always trivially passes — worse than not having it, because it would look enforced without being enforced. This plan leaves a clear seam: `apps/worker/src/jobs/index-area.ts`'s `IndexAreaJobDeps` already takes `getSetting`, so the Cost tracking plan can add a `checkMonthlyBudget` dependency and a call to it at the top of `runIndexAreaJob` without touching anything else in this file.

**2. Placeholder scan:** No "TBD"/"handle errors appropriately" in any step; every step shows real code or a real command with expected output. The one deliberately deferred item (`MAX_MONTHLY_BUDGET_USD`) is called out explicitly above, not hidden inside a vague step.

**3. Type consistency:** `IndexAreaJobDeps` (Task 10) is the single source of truth for what the job needs and is satisfied concretely in `index.ts` (Task 11) without redefinition. `AreaRow`/`AreaStatus`/`SampledPoint`/`StreetViewCapture`/`IndexAreaJobPayload` (Task 3) are imported everywhere, never redeclared with different shapes. `AreaProgressUpdate` (Task 8) is the same type used by both the job (Task 10) and would be reused by any future endpoint reading progress.

---

## Deferred to later plans (do not implement here)

- **Search & Refine Pipeline plan:** `/api/search`, `/api/search/:id/refine`, spatial clustering into regions, `POST /verify` (Laila/RoMa geometric verification) in the inference service (spec §9.2–§9.4).
- **Dashboard & Map UI plan:** `MapCanvas`, `IndexingDrawTool` (the actual polygon-drawing UI that produces the `polygon`/`areaKm2` this plan's `POST /api/areas` consumes), `JobProgressBar` (the UI client for Task 15's SSE stream), `/areas` and `/areas/[id]` pages, Zustand stores (spec §5, §8, §13).
- **Cost tracking plan:** `api_usage` daily writes, `MAX_MONTHLY_BUDGET_USD` enforcement (the seam is ready — see the Self-Review note above), estimated-vs-actual reconciliation across all areas (spec §12.1–§12.3).

---

**Next step:** once this plan and Dashboard & Map UI are both merged, the product has a working end-to-end indexing loop with a real UI. Search & Refine Pipeline is the natural plan after that, since it's the first thing that actually queries what this plan populates.
