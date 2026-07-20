# Background Jobs Tray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dataset installs, model installs, and model uninstalls survive a page reload or navigation away, via a durable `background_jobs` table and a persistent notification tray mounted at the app-shell level.

**Architecture:** Each of the three routes keeps its existing synchronous validation, but the actual work (download/decrypt/unzip/DB writes/inference restart) moves into an exported, independently-testable async function that the route fires without awaiting, writing its outcome to a `background_jobs` row as it goes. A `BackgroundJobsTray` component in `AppShell` recovers active jobs on mount by querying the server (no localStorage) and polls each until terminal.

**Tech Stack:** Next.js App Router route handlers, `pg` (raw SQL, no ORM), `node-pg-migrate` migrations, Vitest + `vi.fn()` mock-pool tests, Zustand for client state, Tailwind for styling.

## Global Constraints

- New migration file: `db/migrations/1721300000000_background_jobs.js` (timestamp must sort after the existing latest, `1721200000000_installed_classification_models.js`).
- Migrations use raw `pgm.sql(...)` calls, not `pgm.createTable` — match the exact style of `db/migrations/1721200000000_installed_classification_models.js`.
- `background_jobs` must be added to `APPLICATION_TABLES` in `apps/web/lib/settings/db-backup.ts` so factory reset backs it up and truncates it like every other application table.
- Job recovery window: `listActiveJobs` returns rows where `status = 'running' OR updated_at > now() - interval '15 seconds'` (spec's exact value — a job that finishes right as the page reloads still shows its outcome once).
- Job `kind` values are exactly: `'dataset-install'`, `'model-install'`, `'model-uninstall'` (spec's exact strings — used both in the DB and in the tray's label-building logic).
- Synchronous validation errors (missing fields, release/model not found, malformed manifest, incompatible dataset without `forceInstall`) are unchanged — same 4xx status and body shape as today, returned before any job is created.
- No retry/cancel UI for jobs, no change to `ModelLoadNotification.tsx`'s other call sites (`SearchDashboard.tsx`, `JobProgressBar.tsx`, `ResetConfirmDialog.tsx`), no change to area indexing (`useIndexingStore`) — all explicitly out of scope per the spec's Non-goals.
- UI-heavy components with no pure-function core get manual verification only, no test file — matches this codebase's existing convention (no test file for `ModelLoadNotification.tsx` or the current `ModelosSection.tsx`/`DatasetsSection.tsx`). This applies to `BackgroundJobsTray.tsx` and the edits to `ModelosSection.tsx`/`DatasetsSection.tsx`.

---

### Task 1: `background_jobs` table + job helper library

**Files:**
- Create: `db/migrations/1721300000000_background_jobs.js`
- Modify: `apps/web/lib/settings/db-backup.ts` (add `"background_jobs"` to `APPLICATION_TABLES`)
- Create: `apps/web/lib/background-jobs.ts`
- Test: `apps/web/lib/background-jobs.test.ts`

**Interfaces:**
- Produces: `createJob(pool: Pool, kind: "dataset-install" | "model-install" | "model-uninstall", label: string): Promise<string>` (returns the new job's `id`), `completeJob(pool: Pool, id: string, result: unknown): Promise<void>`, `failJob(pool: Pool, id: string, error: string): Promise<void>`, `getJob(pool: Pool, id: string): Promise<BackgroundJob | null>`, `listActiveJobs(pool: Pool): Promise<BackgroundJob[]>`, and the `BackgroundJob` interface itself (`id`, `kind`, `label`, `status: "running" | "done" | "failed"`, `error: string | null`, `result: unknown | null`, `createdAt: string`, `updatedAt: string`).

- [ ] **Step 1: Write the migration**

```js
// db/migrations/1721300000000_background_jobs.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE background_jobs (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind         text NOT NULL,
      label        text NOT NULL,
      status       text NOT NULL DEFAULT 'running',
      error        text,
      result       jsonb,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE background_jobs;`);
};
```

- [ ] **Step 2: Run the migration**

Run: `cd apps/web && npx node-pg-migrate up` (or whatever migration command this repo's `package.json` scripts define — check `db/package.json`/`apps/web/package.json` for a `migrate` script and use that if present).
Expected: migration runs without error; `psql`/`docker exec netryx-db psql -U netryx -d netryx_dev -c "\d background_jobs"` shows the new table.

- [ ] **Step 3: Add `background_jobs` to `APPLICATION_TABLES`**

In `apps/web/lib/settings/db-backup.ts`, change:

```ts
export const APPLICATION_TABLES = [
  "api_usage",
  "areas",
  "background_jobs",
  "indexed_images",
  "indexed_points",
  "installed_classification_models",
  "search_batches",
  "search_candidates",
  "search_regions",
  "searches",
  "system_settings",
  "worker_heartbeat",
] as const;
```

(Inserted alphabetically between `"areas"` and `"indexed_images"`, matching the existing alphabetical ordering.)

- [ ] **Step 4: Write the failing tests for `background-jobs.ts`**

```ts
// apps/web/lib/background-jobs.test.ts
import { describe, it, expect, vi } from "vitest";
import { createJob, completeJob, failJob, getJob, listActiveJobs } from "./background-jobs";

function makePool(queryImpl: (sql: string, params: unknown[]) => Promise<{ rows: any[] }>) {
  return { query: vi.fn(queryImpl) } as any;
}

describe("createJob", () => {
  it("inserts a running job row and returns its id", async () => {
    const pool = makePool(async (sql, params) => {
      expect(sql).toContain("INSERT INTO background_jobs");
      expect(params).toEqual(["model-install", "Wanda v1.0"]);
      return { rows: [{ id: "job-1" }] };
    });

    const id = await createJob(pool, "model-install", "Wanda v1.0");
    expect(id).toBe("job-1");
  });
});

describe("completeJob", () => {
  it("sets status done, stores the result, and bumps updated_at", async () => {
    const pool = makePool(async (sql, params) => {
      expect(sql).toContain("UPDATE background_jobs");
      expect(sql).toContain("status = 'done'");
      expect(params).toEqual(["job-1", JSON.stringify({ ok: true, version: "1.0" })]);
      return { rows: [] };
    });

    await completeJob(pool, "job-1", { ok: true, version: "1.0" });
  });
});

describe("failJob", () => {
  it("sets status failed and stores the error message", async () => {
    const pool = makePool(async (sql, params) => {
      expect(sql).toContain("UPDATE background_jobs");
      expect(sql).toContain("status = 'failed'");
      expect(params).toEqual(["job-1", "disk full"]);
      return { rows: [] };
    });

    await failJob(pool, "job-1", "disk full");
  });
});

describe("getJob", () => {
  it("returns null when the job doesn't exist", async () => {
    const pool = makePool(async () => ({ rows: [] }));
    const job = await getJob(pool, "missing");
    expect(job).toBeNull();
  });

  it("maps a row to a BackgroundJob", async () => {
    const pool = makePool(async () => ({
      rows: [{
        id: "job-1", kind: "model-install", label: "Wanda v1.0", status: "done",
        error: null, result: { ok: true }, created_at: "2026-07-20T10:00:00.000Z",
        updated_at: "2026-07-20T10:00:01.000Z",
      }],
    }));

    const job = await getJob(pool, "job-1");
    expect(job).toEqual({
      id: "job-1", kind: "model-install", label: "Wanda v1.0", status: "done",
      error: null, result: { ok: true }, createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-20T10:00:01.000Z",
    });
  });
});

describe("listActiveJobs", () => {
  it("selects running jobs or ones finished within the last 15 seconds", async () => {
    const pool = makePool(async (sql) => {
      expect(sql).toContain("status = 'running'");
      expect(sql).toContain("interval '15 seconds'");
      return {
        rows: [{
          id: "job-1", kind: "dataset-install", label: "inigo/lumi-madrid@v1", status: "running",
          error: null, result: null, created_at: "2026-07-20T10:00:00.000Z",
          updated_at: "2026-07-20T10:00:00.000Z",
        }],
      };
    });

    const jobs = await listActiveJobs(pool);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("job-1");
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/background-jobs.test.ts`
Expected: FAIL — `Cannot find module './background-jobs'` (file doesn't exist yet).

- [ ] **Step 6: Implement `background-jobs.ts`**

```ts
// apps/web/lib/background-jobs.ts
import type { Pool } from "pg";

export type BackgroundJobKind = "dataset-install" | "model-install" | "model-uninstall";
export type BackgroundJobStatus = "running" | "done" | "failed";

export interface BackgroundJob {
  id: string;
  kind: BackgroundJobKind;
  label: string;
  status: BackgroundJobStatus;
  error: string | null;
  result: unknown | null;
  createdAt: string;
  updatedAt: string;
}

interface BackgroundJobRow {
  id: string;
  kind: BackgroundJobKind;
  label: string;
  status: BackgroundJobStatus;
  error: string | null;
  result: unknown | null;
  created_at: string;
  updated_at: string;
}

function toBackgroundJob(row: BackgroundJobRow): BackgroundJob {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    status: row.status,
    error: row.error,
    result: row.result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createJob(pool: Pool, kind: BackgroundJobKind, label: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO background_jobs (kind, label) VALUES ($1, $2) RETURNING id`,
    [kind, label]
  );
  return rows[0].id as string;
}

export async function completeJob(pool: Pool, id: string, result: unknown): Promise<void> {
  await pool.query(
    `UPDATE background_jobs SET status = 'done', result = $2, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(result)]
  );
}

export async function failJob(pool: Pool, id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE background_jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
    [id, error]
  );
}

export async function getJob(pool: Pool, id: string): Promise<BackgroundJob | null> {
  const { rows } = await pool.query(`SELECT * FROM background_jobs WHERE id = $1`, [id]);
  if (rows.length === 0) return null;
  return toBackgroundJob(rows[0] as BackgroundJobRow);
}

export async function listActiveJobs(pool: Pool): Promise<BackgroundJob[]> {
  const { rows } = await pool.query(
    `SELECT * FROM background_jobs
     WHERE status = 'running' OR updated_at > now() - interval '15 seconds'
     ORDER BY created_at DESC`
  );
  return (rows as BackgroundJobRow[]).map(toBackgroundJob);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/background-jobs.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 8: Commit**

```bash
git add db/migrations/1721300000000_background_jobs.js apps/web/lib/settings/db-backup.ts apps/web/lib/background-jobs.ts apps/web/lib/background-jobs.test.ts
git commit -m "feat(web): add background_jobs table and job tracking helpers"
```

---

### Task 2: `GET /api/jobs`, `GET /api/jobs/[id]`, `GET /api/search/batch/active`

**Files:**
- Create: `apps/web/app/api/jobs/route.ts`
- Create: `apps/web/app/api/jobs/route.test.ts`
- Create: `apps/web/app/api/jobs/[id]/route.ts`
- Create: `apps/web/app/api/jobs/[id]/route.test.ts`
- Create: `apps/web/app/api/search/batch/active/route.ts`
- Create: `apps/web/app/api/search/batch/active/route.test.ts`

**Interfaces:**
- Consumes: `listActiveJobs`, `getJob` from `../../../../lib/background-jobs` (Task 1); `getPool` from `../../../../lib/db`.
- Produces: `GET /api/jobs` → `{ jobs: BackgroundJob[] }`; `GET /api/jobs/:id` → `BackgroundJob` or 404 `{ error: string }`; `GET /api/search/batch/active` → `{ batch: { id: string; status: string; total: number; done: number; failed: number } | null }`.

- [ ] **Step 1: Write the failing test for `GET /api/jobs`**

```ts
// apps/web/app/api/jobs/route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../lib/background-jobs", () => ({ listActiveJobs: vi.fn() }));

describe("GET /api/jobs", () => {
  it("returns the active jobs list", async () => {
    const { listActiveJobs } = await import("../../../lib/background-jobs");
    (listActiveJobs as any).mockResolvedValue([
      { id: "job-1", kind: "model-install", label: "Wanda v1.0", status: "running", error: null, result: null, createdAt: "x", updatedAt: "x" },
    ]);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.jobs).toHaveLength(1);
    expect(json.jobs[0].id).toBe("job-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/api/jobs/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implement `GET /api/jobs`**

```ts
// apps/web/app/api/jobs/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../lib/db";
import { listActiveJobs } from "../../../lib/background-jobs";

export async function GET() {
  const jobs = await listActiveJobs(getPool());
  return NextResponse.json({ jobs });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/api/jobs/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for `GET /api/jobs/[id]`**

```ts
// apps/web/app/api/jobs/[id]/route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../lib/background-jobs", () => ({ getJob: vi.fn() }));

function makeRequest() {
  return new Request("http://localhost/api/jobs/job-1");
}

describe("GET /api/jobs/[id]", () => {
  it("returns the job when it exists", async () => {
    const { getJob } = await import("../../../../lib/background-jobs");
    (getJob as any).mockResolvedValue({
      id: "job-1", kind: "model-install", label: "Wanda v1.0", status: "done",
      error: null, result: { ok: true }, createdAt: "x", updatedAt: "x",
    });

    const { GET } = await import("./route");
    const res = await GET(makeRequest(), { params: { id: "job-1" } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.id).toBe("job-1");
  });

  it("404s when the job doesn't exist", async () => {
    const { getJob } = await import("../../../../lib/background-jobs");
    (getJob as any).mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET(makeRequest(), { params: { id: "missing" } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run app/api/jobs/[id]/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 7: Implement `GET /api/jobs/[id]`**

```ts
// apps/web/app/api/jobs/[id]/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";
import { getJob } from "../../../../lib/background-jobs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const job = await getJob(getPool(), params.id);
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  return NextResponse.json(job);
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run app/api/jobs/[id]/route.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 9: Write the failing tests for `GET /api/search/batch/active`**

```ts
// apps/web/app/api/search/batch/active/route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../../lib/db", () => ({ getPool: vi.fn() }));

describe("GET /api/search/batch/active", () => {
  it("returns the most recent non-terminal batch", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ id: "batch-1", status: "running", total: 5, done: 2, failed: 0 }],
    });
    const { getPool } = await import("../../../../../lib/db");
    (getPool as any).mockReturnValue({ query });

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.batch).toEqual({ id: "batch-1", status: "running", total: 5, done: 2, failed: 0 });
    expect(query.mock.calls[0][0]).toContain("status IN ('pending', 'running')");
  });

  it("returns { batch: null } when nothing is in flight", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const { getPool } = await import("../../../../../lib/db");
    (getPool as any).mockReturnValue({ query });

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json.batch).toBeNull();
  });
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run app/api/search/batch/active/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 11: Implement `GET /api/search/batch/active`**

```ts
// apps/web/app/api/search/batch/active/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";

export async function GET() {
  const { rows } = await getPool().query(
    `SELECT id, status, total, done, failed FROM search_batches
     WHERE status IN ('pending', 'running')
     ORDER BY id DESC LIMIT 1`
  );
  return NextResponse.json({ batch: rows[0] ?? null });
}
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run app/api/search/batch/active/route.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 13: Commit**

```bash
git add apps/web/app/api/jobs apps/web/app/api/search/batch/active
git commit -m "feat(web): add GET /api/jobs, /api/jobs/:id, and /api/search/batch/active"
```

---

### Task 3: Convert `POST /api/datasets/install` to fire a background job

**Files:**
- Modify: `apps/web/app/api/datasets/install/route.ts`
- Modify: `apps/web/app/api/datasets/install/route.test.ts`

**Interfaces:**
- Consumes: `createJob`, `completeJob`, `failJob` from `../../../../lib/background-jobs` (Task 1).
- Produces: an exported `runDatasetInstallJob(pool, jobId, args)` function later tasks don't depend on directly, but which Task 3's own tests exercise; `POST` now returns `202 { jobId }` on the path that used to return `201 { areaId, compatible }`. The 400/409/404 synchronous paths are unchanged.

This route currently does everything inline: validate → fetch release → download+decrypt metadata → check compatibility (this part stays synchronous, since a 409 needs to reach the client before any job starts) → download+decrypt+unzip bundle → stage images → insert `areas`/`indexed_images`/`indexed_points` → maybe enqueue an embed job (this part becomes the job).

- [ ] **Step 1: Read the current route in full**

Run: `sed -n '1,200p' apps/web/app/api/datasets/install/route.ts` and confirm line numbers match what's below before editing — the exact byte offsets may have shifted since this plan was written.

- [ ] **Step 2: Rewrite the route, extracting the post-compatibility-check work into `runDatasetInstallJob`**

Replace the full file with:

```ts
// apps/web/app/api/datasets/install/route.ts
import { NextResponse } from "next/server";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
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
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { createJob, completeJob, failJob } from "../../../../lib/background-jobs";

interface InstallBody {
  owner?: string;
  repo?: string;
  tag?: string;
  forceInstall?: boolean;
}

const KNOWN_MODEL_IDS = new Set(RETRIEVAL_MODELS.map((m) => m.id));

/** The actual dataset install work (download bundle, stage images, write
 * areas/indexed_images/indexed_points, maybe enqueue an embed job) — split
 * out of POST so it can run detached from the request and be driven
 * directly from route.test.ts without needing to await a fire-and-forget
 * promise the handler never returns to the caller. */
export async function runDatasetInstallJob(
  pool: Pool,
  jobId: string,
  args: {
    bundleAssetUrl: string;
    token: string | undefined;
    compatible: boolean;
  }
): Promise<void> {
  const stagingDir = await mkdtemp(join(tmpdir(), "lumi-dataset-"));
  const stagedImages: { panoId: string; heading: number; bytes: Buffer }[] = [];
  let decompressedTotal = 0;

  try {
    const bundleBytes = await downloadReleaseAsset(args.bundleAssetUrl, args.token);
    const decrypted = decryptBuffer(bundleBytes, DATASET_SHARED_KEY);
    assertCompressedSizeWithinLimit(decrypted.length);

    const zip = await JSZip.loadAsync(decrypted);
    assertFileCountWithinLimit(Object.keys(zip.files).length);
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) throw new Error("manifest.json missing from bundle");
    const manifest = validateDatasetManifest(JSON.parse(await manifestFile.async("string")), KNOWN_MODEL_IDS);
    if (manifest.areas.length !== 1) {
      throw new Error(`expected exactly 1 area in the bundle, got ${manifest.areas.length}`);
    }

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
      const { rows } = await pool.query(
        `INSERT INTO areas (name, geometry, area_km2, status, points_estimated, points_captured,
                            points_failed, images_embedded, estimated_cost_usd, actual_cost_usd)
         VALUES ($1, ST_GeomFromText($2, 4326), $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          area.name, area.geometryWkt, area.areaKm2,
          args.compatible ? area.status : "pending",
          area.pointsEstimated, area.pointsCaptured, area.pointsFailed,
          args.compatible ? area.imagesEmbedded : 0,
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
        const embeddingLiteral = args.compatible && img.embedding ? `[${img.embedding.join(",")}]` : null;
        await pool.query(
          `INSERT INTO indexed_images (area_id, pano_id, heading, location, street_view_date, embedding, image_path, embedded_at)
           VALUES ($1, $2, $3, ST_GeogFromText($4), $5, $6, $7, CASE WHEN $6 IS NOT NULL THEN now() ELSE NULL END)
           ON CONFLICT (pano_id, heading) DO NOTHING`,
          [areaId, img.panoId, img.heading, `POINT(${img.lng} ${img.lat})`, img.streetViewDate, embeddingLiteral, imagePath]
        );
      }

      for (const pt of area.points) {
        const embeddingLiteral = args.compatible && pt.embedding ? `[${pt.embedding.join(",")}]` : null;
        await pool.query(
          `INSERT INTO indexed_points (area_id, pano_id, location, embedding)
           VALUES ($1, $2, ST_GeogFromText($3), $4)
           ON CONFLICT (pano_id) DO NOTHING`,
          [areaId, pt.panoId, `POINT(${pt.lng} ${pt.lat})`, embeddingLiteral]
        );
      }
    }

    if (!args.compatible) {
      await enqueueEmbedPendingImagesJob({ areaId });
    }

    await completeJob(pool, jobId, { areaId, compatible: args.compatible });
  } catch (err) {
    await failJob(pool, jobId, err instanceof Error ? err.message : String(err));
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as InstallBody;
  if (!body.owner || !body.repo || !body.tag) {
    return NextResponse.json({ error: "owner, repo and tag are required" }, { status: 400 });
  }

  const token = (await getSettingsRepo().getSetting("GITHUB_TOKEN")) ?? undefined;
  const releases = await listReleasesForRepo(body.owner, body.repo, token);
  const release = releases.find((r) => r.tagName === body.tag);
  if (!release) {
    return NextResponse.json({ error: "release not found" }, { status: 404 });
  }

  const metadataAsset = release.assets.find((a) => a.name === METADATA_ASSET_NAME);
  const bundleAsset = release.assets.find((a) => a.name === BUNDLE_ASSET_NAME);
  if (!metadataAsset || !bundleAsset) {
    return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
  }

  let metadata: DatasetMetadata;
  let activeModel: Awaited<ReturnType<typeof getActiveModelTag>>;
  let compatible: boolean;
  try {
    const metadataBytes = await downloadReleaseAsset(metadataAsset.url, token);
    metadata = JSON.parse(decryptBuffer(metadataBytes, DATASET_SHARED_KEY).toString("utf8")) as DatasetMetadata;

    activeModel = await getActiveModelTag();
    compatible = isCompatible(metadata.model, activeModel);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  if (!compatible && !body.forceInstall) {
    return NextResponse.json({ compatible: false, datasetModel: metadata.model, activeModel }, { status: 409 });
  }

  const pool = getPool();
  const jobId = await createJob(pool, "dataset-install", `${body.owner}/${body.repo}@${body.tag}`);
  void runDatasetInstallJob(pool, jobId, { bundleAssetUrl: bundleAsset.url, token, compatible });

  return NextResponse.json({ jobId }, { status: 202 });
}
```

- [ ] **Step 3: Update the existing tests**

The three synchronous-path tests (`404s when the release/tag isn't found`, `409s on a model mismatch...`, `400s when the release is missing an expected asset`) are unchanged — keep them exactly as they are in the current `route.test.ts`, since that whole code path didn't move.

Replace the tests that exercised the old synchronous 201 success path with tests against `runDatasetInstallJob` directly, and add one test that `POST` returns `202 { jobId }` on success. Add these to `apps/web/app/api/datasets/install/route.test.ts` (keep the existing `vi.mock` calls and the three synchronous-path tests already in the file; add the following):

```ts
vi.mock("../../../../lib/background-jobs", () => ({
  createJob: vi.fn().mockResolvedValue("job-1"),
  completeJob: vi.fn(),
  failJob: vi.fn(),
}));

describe("POST /api/datasets/install — success path", () => {
  it("returns 202 with a jobId once compatibility passes", async () => {
    const { listReleasesForRepo, downloadReleaseAsset } = await import("../../../../lib/datasets/github");
    (listReleasesForRepo as any).mockResolvedValue([
      { tagName: "lumi-madrid-v1.0", name: "x", body: "", assets: [
        { name: "metadata.json.enc", url: "meta-url" },
        { name: "bundle.zip.enc", url: "bundle-url" },
      ] },
    ]);
    (downloadReleaseAsset as any).mockImplementation(async (url: string) => {
      if (url === "meta-url") return encryptedMetadata({ id: "lumi-preview", version: "1.0", embeddingDim: 8448 });
      throw new Error(`unexpected asset url in this test: ${url}`);
    });

    const { getActiveModelTag } = await import("../../../../lib/datasets/active-model");
    (getActiveModelTag as any).mockResolvedValue({ id: "lumi-preview", version: "1.0", embeddingDim: 8448 });

    const { createJob } = await import("../../../../lib/background-jobs");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-madrid", tag: "lumi-madrid-v1.0" }));
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json).toEqual({ jobId: "job-1" });
    expect(createJob).toHaveBeenCalledWith(expect.anything(), "dataset-install", "inigo/lumi-madrid@lumi-madrid-v1.0");
  });
});

describe("runDatasetInstallJob", () => {
  it("stages images, writes areas/indexed_images/indexed_points, and completes the job", async () => {
    const { runDatasetInstallJob } = await import("./route");
    const { downloadReleaseAsset } = await import("../../../../lib/datasets/github");
    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { DATASET_SHARED_KEY } = await import("../../../../lib/datasets/shared-key");
    const { completeJob } = await import("../../../../lib/background-jobs");

    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({
      areas: [{
        name: "Madrid", geometryWkt: "POLYGON((0 0,0 1,1 1,1 0,0 0))", areaKm2: 1, status: "indexed",
        pointsEstimated: 1, pointsCaptured: 1, pointsFailed: 0, imagesEmbedded: 0,
        estimatedCostUsd: 0, actualCostUsd: 0,
        images: [], points: [],
      }],
    }));
    const zipBytes = await zip.generateAsync({ type: "nodebuffer" });
    (downloadReleaseAsset as any).mockResolvedValue(encryptBuffer(zipBytes, DATASET_SHARED_KEY));

    const query = vi.fn().mockResolvedValue({ rows: [{ id: "area-1" }] });
    const pool = { query } as any;

    await runDatasetInstallJob(pool, "job-1", { bundleAssetUrl: "bundle-url", token: undefined, compatible: true });

    expect(query.mock.calls[0][0]).toContain("INSERT INTO areas");
    expect(completeJob).toHaveBeenCalledWith(pool, "job-1", { areaId: "area-1", compatible: true });
  });

  it("calls failJob instead of throwing when the bundle download fails", async () => {
    const { runDatasetInstallJob } = await import("./route");
    const { downloadReleaseAsset } = await import("../../../../lib/datasets/github");
    (downloadReleaseAsset as any).mockRejectedValue(new Error("network error"));
    const { failJob } = await import("../../../../lib/background-jobs");

    const pool = { query: vi.fn() } as any;
    await runDatasetInstallJob(pool, "job-1", { bundleAssetUrl: "bundle-url", token: undefined, compatible: true });

    expect(failJob).toHaveBeenCalledWith(pool, "job-1", "network error");
  });
});
```

Remove the old test(s) in the file that asserted a `201` status with an `{ areaId, compatible }` body from a single `POST` call (they tested behavior that's now split across `POST`'s 202 response and `runDatasetInstallJob`'s own outcome) — check the current file for a test titled along the lines of "successfully installs a compatible dataset" and delete it, since its assertions are now covered by the two new describe blocks above.

- [ ] **Step 4: Run the full test file**

Run: `cd apps/web && npx vitest run app/api/datasets/install/route.test.ts`
Expected: PASS, all tests (the untouched synchronous-path tests plus the new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/datasets/install/route.ts apps/web/app/api/datasets/install/route.test.ts
git commit -m "feat(web): run dataset install as a background job"
```

---

### Task 4: Convert `POST /api/model-catalog/install` to fire a background job

**Files:**
- Modify: `apps/web/app/api/model-catalog/install/route.ts`
- Modify: `apps/web/app/api/model-catalog/install/route.test.ts`

**Interfaces:**
- Consumes: `createJob`, `completeJob`, `failJob` from `../../../../lib/background-jobs` (Task 1).
- Produces: exported `runModelInstallJob(pool, jobId, args)` covering both the `generic-classifier` and `code-bundle` branches; `POST` returns `202 { jobId }` for both branches instead of the old `201`/`200` synchronous bodies. The 404/400 synchronous paths (release not found, missing assets) are unchanged.

- [ ] **Step 1: Rewrite the route**

```ts
// apps/web/app/api/model-catalog/install/route.ts
import { NextResponse } from "next/server";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import type { Pool } from "pg";
import JSZip from "jszip";
import { readdir, copyFile } from "node:fs/promises";
import { decryptBuffer } from "@netryx/settings-repo";
import { listReleasesForRepo, downloadReleaseAsset } from "../../../../lib/model-catalog/github";
import {
  validateModelCatalogManifest,
  BUNDLE_CODE_ASSET_NAME,
  MODEL_CATALOG_METADATA_ASSET_NAME,
  type ModelCatalogManifest,
} from "../../../../lib/model-catalog/manifest";
import { MODEL_CATALOG_SHARED_KEY } from "../../../../lib/model-catalog/shared-key";
import { backupInferenceCode, restoreInferenceCode, persistBackup } from "../../../../lib/model-catalog/backup";
import { PREVIOUS_CODE_DIR, readUninstallMeta, writeUninstallMeta } from "../../../../lib/model-catalog/uninstall-state";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { installClassificationModel } from "../../../../lib/model-catalog/classification-models";
import { getPool } from "../../../../lib/db";
import { createJob, completeJob, failJob } from "../../../../lib/background-jobs";

interface InstallBody {
  owner?: string;
  repo?: string;
  tag?: string;
}

const INFERENCE_DIR = resolve(process.cwd(), "..", "..", "services", "inference");
const INFERENCE_SERVICE_URL = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

function isManagedInferenceFile(name: string): boolean {
  return name.endsWith(".py") || name === "requirements.txt";
}

const READY_POLL_TIMEOUT_MS = Number(process.env.MODEL_CATALOG_READY_TIMEOUT_MS ?? 60_000);
const READY_POLL_INTERVAL_MS = Number(process.env.MODEL_CATALOG_READY_POLL_INTERVAL_MS ?? 1_000);

async function waitForInferenceReady(timeoutMs: number = READY_POLL_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${INFERENCE_SERVICE_URL}/docs`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
  }
  return false;
}

/** The actual install work for both strategies — split out of POST so it
 * can run detached from the request and be driven directly from
 * route.test.ts. `origin` is threaded through instead of derived from
 * `request.url`, since this runs after the request has already responded. */
export async function runModelInstallJob(
  pool: Pool,
  jobId: string,
  args: { manifest: ModelCatalogManifest; codeAssetUrl: string | undefined; origin: string }
): Promise<void> {
  const { manifest } = args;

  if (manifest.kind === "generic-classifier") {
    try {
      await installClassificationModel(pool, manifest);
      await completeJob(pool, jobId, { ok: true, modelId: manifest.modelId, version: manifest.version });
    } catch (err) {
      await failJob(pool, jobId, err instanceof Error ? err.message : String(err));
    }
    return;
  }

  if (!args.codeAssetUrl) {
    await failJob(pool, jobId, "release is missing expected assets");
    return;
  }

  const codeBytes = await downloadReleaseAsset(args.codeAssetUrl);
  const decrypted = decryptBuffer(codeBytes, MODEL_CATALOG_SHARED_KEY);

  const stagingDir = await mkdtemp(join(tmpdir(), "lumi-catalog-install-"));
  let backupDir: string | null = null;

  try {
    const zip = await JSZip.loadAsync(decrypted);
    for (const [relPath, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const baseName = relPath.split("/").pop() ?? relPath;
      if (!isManagedInferenceFile(baseName)) {
        throw new Error(`Unexpected file in release bundle (only .py and requirements.txt are allowed): ${relPath}`);
      }
      const destPath = join(stagingDir, relPath);
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, await entry.async("nodebuffer"));
    }

    backupDir = await backupInferenceCode(INFERENCE_DIR);

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

    const restartRes = await fetch(`${args.origin}/api/setup/run/restart-inference`, { method: "POST" });
    void restartRes;

    const ready = await waitForInferenceReady();
    if (!ready) {
      await restoreInferenceCode(INFERENCE_DIR, backupDir);
      await fetch(`${args.origin}/api/setup/run/restart-inference`, { method: "POST" });
      const restoredReady = await waitForInferenceReady();
      await failJob(
        pool,
        jobId,
        `No se pudo aplicar la versión ${manifest.version} — se restauró la versión anterior${restoredReady ? "" : " (el servicio de inferencia tampoco volvió a responder tras restaurar)"}`
      );
      return;
    }

    const priorMeta = await readUninstallMeta();
    await persistBackup(backupDir, PREVIOUS_CODE_DIR);
    await writeUninstallMeta({ currentVersion: manifest.version, previousVersion: priorMeta.currentVersion });

    const settingsRepo = getSettingsRepo();
    await settingsRepo.setSetting("RETRIEVAL_MODEL", manifest.bundleId, false);
    if (manifest.verificationModelId) {
      await settingsRepo.setSetting("VERIFICATION_MODEL", manifest.verificationModelId, false);
    }

    await completeJob(pool, jobId, { ok: true, version: manifest.version });
  } catch (err) {
    if (backupDir) await restoreInferenceCode(INFERENCE_DIR, backupDir);
    await failJob(pool, jobId, err instanceof Error ? err.message : String(err));
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
    if (backupDir) await rm(backupDir, { recursive: true, force: true });
  }
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
  if (!metadataAsset) {
    return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
  }

  const metadataBytes = await downloadReleaseAsset(metadataAsset.url);
  const manifest = validateModelCatalogManifest(
    JSON.parse(decryptBuffer(metadataBytes, MODEL_CATALOG_SHARED_KEY).toString("utf8"))
  );

  if (manifest.kind !== "generic-classifier") {
    const codeAsset = release.assets.find((a) => a.name === BUNDLE_CODE_ASSET_NAME);
    if (!codeAsset) {
      return NextResponse.json({ error: "release is missing expected assets" }, { status: 400 });
    }
  }

  const pool = getPool();
  const label =
    manifest.kind === "generic-classifier" ? `${manifest.modelId} v${manifest.version}` : `Lumi Preview v${manifest.version}`;
  const jobId = await createJob(pool, "model-install", label);

  const codeAssetUrl =
    manifest.kind === "generic-classifier"
      ? undefined
      : release.assets.find((a) => a.name === BUNDLE_CODE_ASSET_NAME)?.url;
  const origin = new URL(request.url).origin;
  void runModelInstallJob(pool, jobId, { manifest, codeAssetUrl, origin });

  return NextResponse.json({ jobId }, { status: 202 });
}
```

- [ ] **Step 2: Update the tests**

Keep the two synchronous-path tests unchanged (`404s when the release/tag isn't found`, `400s when the release is missing expected assets`). Replace every other test in `apps/web/app/api/model-catalog/install/route.test.ts` — they all asserted the old synchronous response bodies — with tests against `runModelInstallJob` directly, plus one test that `POST` returns 202. Add:

```ts
vi.mock("../../../../lib/background-jobs", () => ({
  createJob: vi.fn().mockResolvedValue("job-1"),
  completeJob: vi.fn(),
  failJob: vi.fn(),
}));

describe("POST /api/model-catalog/install — success path", () => {
  it("returns 202 with a jobId for a code-bundle release", async () => {
    await mockRelease();
    const { createJob } = await import("../../../../lib/background-jobs");

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "lumi-preview-v1.1" }));
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json).toEqual({ jobId: "job-1" });
    expect(createJob).toHaveBeenCalledWith(expect.anything(), "model-install", "Lumi Preview v1.1");
  });

  it("returns 202 with a jobId for a generic-classifier release", async () => {
    const { listReleasesForRepo, downloadReleaseAsset } = await import("../../../../lib/model-catalog/github");
    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { MODEL_CATALOG_SHARED_KEY } = await import("../../../../lib/model-catalog/shared-key");
    const manifest = {
      kind: "generic-classifier", modelId: "wanda-v1", version: "1.0",
      facets: [{ facet: "weather", hfModelId: "prithivMLmods/Weather-Image-Classification", strategy: "pipeline" }],
      benchmark: { sampleCount: 0, ranAt: "x", vramEstimateBytes: null }, description: "",
    };
    (listReleasesForRepo as any).mockResolvedValue([
      { tagName: "wanda-v1", name: "x", body: "", assets: [{ name: "metadata.json.enc", url: "meta-url" }] },
    ]);
    (downloadReleaseAsset as any).mockImplementation(async (url: string) => {
      if (url === "meta-url") return encryptBuffer(Buffer.from(JSON.stringify(manifest)), MODEL_CATALOG_SHARED_KEY);
      throw new Error(`unexpected asset url: ${url}`);
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ owner: "inigo", repo: "lumi-model-catalog", tag: "wanda-v1" }));
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json).toEqual({ jobId: "job-1" });
  });
});

describe("runModelInstallJob — generic-classifier", () => {
  it("installs and completes the job", async () => {
    const { runModelInstallJob } = await import("./route");
    const { installClassificationModel } = await import("../../../../lib/model-catalog/classification-models");
    const { completeJob } = await import("../../../../lib/background-jobs");
    const manifest = {
      kind: "generic-classifier" as const, modelId: "wanda-v1", version: "1.0",
      facets: [], benchmark: { sampleCount: 0, ranAt: "x", vramEstimateBytes: null }, description: "",
    };
    const pool = {} as any;

    await runModelInstallJob(pool, "job-1", { manifest, codeAssetUrl: undefined, origin: "http://localhost" });

    expect(installClassificationModel).toHaveBeenCalledWith(pool, manifest);
    expect(completeJob).toHaveBeenCalledWith(pool, "job-1", { ok: true, modelId: "wanda-v1", version: "1.0" });
  });
});

describe("runModelInstallJob — code-bundle", () => {
  it("backs up, swaps, restarts, confirms readiness, and completes the job", async () => {
    const { runModelInstallJob } = await import("./route");
    const { backupInferenceCode, restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    (backupInferenceCode as any).mockResolvedValue("/tmp/backup-1");
    const { downloadReleaseAsset } = await import("../../../../lib/model-catalog/github");
    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { MODEL_CATALOG_SHARED_KEY } = await import("../../../../lib/model-catalog/shared-key");
    const { completeJob } = await import("../../../../lib/background-jobs");

    const zip = new JSZip();
    zip.file("main.py", "print('v1.1')");
    const zipBytes = await zip.generateAsync({ type: "nodebuffer" });
    (downloadReleaseAsset as any).mockResolvedValue(encryptBuffer(zipBytes, MODEL_CATALOG_SHARED_KEY));

    const fsPromises = await import("node:fs/promises");
    (fsPromises.readdir as any).mockResolvedValue([{ name: "main.py", isDirectory: () => false }]);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("restart-inference")) return { ok: true } as Response;
      if (url.includes("/docs")) return { ok: true } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const manifest = {
      kind: "code-bundle" as const, bundleId: "lumi-preview", version: "1.1", backbones: [], description: "",
      benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x" },
      verificationModelId: "roma-verify",
    };
    const pool = {} as any;

    await runModelInstallJob(pool, "job-1", { manifest, codeAssetUrl: "code-url", origin: "http://localhost" });

    expect(backupInferenceCode).toHaveBeenCalledWith(expect.stringContaining("inference"));
    expect(restoreInferenceCode).not.toHaveBeenCalled();
    expect(completeJob).toHaveBeenCalledWith(pool, "job-1", { ok: true, version: "1.1" });
  });

  it("restores the backup and fails the job when the new version never becomes ready", async () => {
    const { runModelInstallJob } = await import("./route");
    const { backupInferenceCode, restoreInferenceCode } = await import("../../../../lib/model-catalog/backup");
    (backupInferenceCode as any).mockResolvedValue("/tmp/backup-1");
    const { downloadReleaseAsset } = await import("../../../../lib/model-catalog/github");
    const { encryptBuffer } = await import("@netryx/settings-repo");
    const { MODEL_CATALOG_SHARED_KEY } = await import("../../../../lib/model-catalog/shared-key");
    const { failJob } = await import("../../../../lib/background-jobs");

    const zip = new JSZip();
    zip.file("main.py", "print('v1.1')");
    const zipBytes = await zip.generateAsync({ type: "nodebuffer" });
    (downloadReleaseAsset as any).mockResolvedValue(encryptBuffer(zipBytes, MODEL_CATALOG_SHARED_KEY));

    const fsPromises = await import("node:fs/promises");
    (fsPromises.readdir as any).mockResolvedValue([{ name: "main.py", isDirectory: () => false }]);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("restart-inference")) return { ok: true } as Response;
      if (url.includes("/docs")) return { ok: false } as Response;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const manifest = {
      kind: "code-bundle" as const, bundleId: "lumi-preview", version: "1.1", backbones: [], description: "",
      benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x" },
    };
    const pool = {} as any;

    await runModelInstallJob(pool, "job-1", { manifest, codeAssetUrl: "code-url", origin: "http://localhost" });

    expect(restoreInferenceCode).toHaveBeenCalledWith(expect.stringContaining("inference"), "/tmp/backup-1");
    expect(failJob).toHaveBeenCalledWith(pool, "job-1", expect.stringContaining("se restauró la versión anterior"));
  });
});
```

Keep the existing `mockRelease()` helper and the file's existing top-level `vi.mock` calls (github, backup, uninstall-state, settings-repo, node:fs/promises, classification-models, db) — only remove tests that asserted the old synchronous success/failure response bodies for both branches, since those bodies moved into `completeJob`/`failJob` call assertions above.

- [ ] **Step 3: Run the full test file**

Run: `cd apps/web && npx vitest run app/api/model-catalog/install/route.test.ts`
Expected: PASS, all tests.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/model-catalog/install/route.ts apps/web/app/api/model-catalog/install/route.test.ts
git commit -m "feat(web): run model catalog install as a background job"
```

---

### Task 5: Convert `POST /api/model-catalog/uninstall` to fire a background job

**Files:**
- Modify: `apps/web/app/api/model-catalog/uninstall/route.ts`
- Modify: `apps/web/app/api/model-catalog/uninstall/route.test.ts`

**Interfaces:**
- Consumes: `createJob`, `completeJob`, `failJob` from `../../../../lib/background-jobs` (Task 1).
- Produces: exported `runModelUninstallJob(pool, jobId, args)` covering both branches (classifier vs. code-bundle); `POST` returns `202 { jobId }` for both branches. `GET` is completely unchanged.

- [ ] **Step 1: Rewrite the route**

```ts
// apps/web/app/api/model-catalog/uninstall/route.ts
import { NextResponse } from "next/server";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { restoreInferenceCode } from "../../../../lib/model-catalog/backup";
import { PREVIOUS_CODE_DIR, readUninstallMeta, writeUninstallMeta, clearPreviousBackup } from "../../../../lib/model-catalog/uninstall-state";
import { uninstallClassificationModel, getClassificationModelHistory } from "../../../../lib/model-catalog/classification-models";
import { getPool } from "../../../../lib/db";
import { createJob, completeJob, failJob } from "../../../../lib/background-jobs";

const INFERENCE_DIR = resolve(process.cwd(), "..", "..", "services", "inference");
const INFERENCE_SERVICE_URL = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
const READY_POLL_TIMEOUT_MS = Number(process.env.MODEL_CATALOG_READY_TIMEOUT_MS ?? 60_000);
const READY_POLL_INTERVAL_MS = Number(process.env.MODEL_CATALOG_READY_POLL_INTERVAL_MS ?? 1_000);

async function waitForInferenceReady(timeoutMs: number = READY_POLL_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${INFERENCE_SERVICE_URL}/docs`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
  }
  return false;
}

export async function GET(request: Request) {
  const modelId = new URL(request.url).searchParams.get("modelId");
  if (modelId) {
    const history = await getClassificationModelHistory(getPool(), modelId);
    return NextResponse.json(history);
  }

  const meta = await readUninstallMeta();
  return NextResponse.json({ available: meta.previousVersion !== null || meta.currentVersion !== null, previousVersion: meta.previousVersion });
}

/** The actual uninstall work for both strategies — split out of POST so it
 * can run detached from the request and be driven directly from
 * route.test.ts. */
export async function runModelUninstallJob(
  pool: Pool,
  jobId: string,
  args: { modelId: string | undefined; origin: string }
): Promise<void> {
  if (args.modelId) {
    try {
      const { restoredVersion } = await uninstallClassificationModel(pool, args.modelId);
      await completeJob(pool, jobId, { ok: true, version: restoredVersion });
    } catch (err) {
      await failJob(pool, jobId, err instanceof Error ? err.message : String(err));
    }
    return;
  }

  try {
    const meta = await readUninstallMeta();
    await restoreInferenceCode(INFERENCE_DIR, PREVIOUS_CODE_DIR);

    const restartRes = await fetch(`${args.origin}/api/setup/run/restart-inference`, { method: "POST" });
    void restartRes;

    const ready = await waitForInferenceReady();
    if (!ready) {
      await failJob(
        pool,
        jobId,
        `Se restauraron los archivos de la versión anterior (${meta.previousVersion ?? "estado original"}), pero el servicio de inferencia no volvió a estar disponible`
      );
      return;
    }

    await writeUninstallMeta({ currentVersion: meta.previousVersion, previousVersion: null });
    await clearPreviousBackup();

    await completeJob(pool, jobId, { ok: true, version: meta.previousVersion });
  } catch (err) {
    await failJob(pool, jobId, err instanceof Error ? err.message : String(err));
  }
}

interface UninstallBody {
  modelId?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as UninstallBody;

  if (!body.modelId) {
    const meta = await readUninstallMeta();
    if (meta.currentVersion === null) {
      return NextResponse.json({ error: "No hay ninguna versión instalada para desinstalar" }, { status: 400 });
    }
  }

  const pool = getPool();
  const jobId = await createJob(pool, "model-uninstall", body.modelId ?? "Lumi Preview");
  const origin = new URL(request.url).origin;
  void runModelUninstallJob(pool, jobId, { modelId: body.modelId, origin });

  return NextResponse.json({ jobId }, { status: 202 });
}
```

- [ ] **Step 2: Read the current test file and rewrite it**

Run: `cat apps/web/app/api/model-catalog/uninstall/route.test.ts` to see the exact current tests before editing (this file wasn't read in full during brainstorming — read it now).

Keep the `GET` describe block entirely unchanged (that handler didn't change). Keep the 400 "nothing installed" synchronous test unchanged. Replace every test that asserted the old synchronous 200/502 POST response bodies with tests against `runModelUninstallJob` directly, plus one test that `POST` returns 202, following the exact same restructuring pattern as Task 4 Step 2 (mock `../../../../lib/background-jobs` with `createJob` resolving `"job-1"`, `completeJob`/`failJob` as plain `vi.fn()`; assert `res.status === 202` and `json.jobId === "job-1"` for the `POST` success test; assert `completeJob`/`failJob` call arguments for the `runModelUninstallJob` tests, covering: classifier uninstall success, code-bundle uninstall success, and code-bundle uninstall where `waitForInferenceReady` never returns true).

- [ ] **Step 3: Run the full test file**

Run: `cd apps/web && npx vitest run app/api/model-catalog/uninstall/route.test.ts`
Expected: PASS, all tests.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/model-catalog/uninstall/route.ts apps/web/app/api/model-catalog/uninstall/route.test.ts
git commit -m "feat(web): run model catalog uninstall as a background job"
```

---

### Task 6: `useBackgroundJobsStore` + `BackgroundJobsTray` + mount in `AppShell`

**Files:**
- Create: `apps/web/app/stores/useBackgroundJobsStore.ts`
- Create: `apps/web/app/components/BackgroundJobsTray.tsx`
- Modify: `apps/web/app/components/AppShell.tsx`

**Interfaces:**
- Consumes: `fetchJson` from `../lib/fetch-json`; `GET /api/jobs?active=true`, `GET /api/jobs/:id`, `GET /api/search/batch/active` (Task 2); `BackgroundJob` type shape from Task 1 (duplicated locally as a client-side interface, matching the existing pattern where client components don't import server-only `lib/` types across the client/server boundary — see how `catalog-types.ts` defines its own `ModelCatalogItem` rather than importing a server type).
- Produces: `useBackgroundJobsStore` exposes `registerJob(jobId: string): void` — this is what `ModelosSection.tsx` and `DatasetsSection.tsx` (Tasks 7 and 8) call after a `202` response.

No test file for this task — `BackgroundJobsTray.tsx` is UI-heavy with no pure-function core, matching this codebase's convention (verify manually per Step 4 below).

- [ ] **Step 1: Create the store**

```ts
// apps/web/app/stores/useBackgroundJobsStore.ts
import { create } from "zustand";

interface BackgroundJobsState {
  trackedIds: string[];
  registerJob: (jobId: string) => void;
  untrackJob: (jobId: string) => void;
}

/** Just the set of job ids the tray should be polling — the tray itself
 * owns each job's actual status/label/result, fetched from the server.
 * Kept separate from BackgroundJobsTray so ModelosSection/DatasetsSection
 * can register a freshly created job without needing to import the tray
 * component itself (matches useIndexingStore's separation from
 * JobProgressBar). */
export const useBackgroundJobsStore = create<BackgroundJobsState>((set) => ({
  trackedIds: [],
  registerJob: (jobId) => set((s) => (s.trackedIds.includes(jobId) ? s : { trackedIds: [...s.trackedIds, jobId] })),
  untrackJob: (jobId) => set((s) => ({ trackedIds: s.trackedIds.filter((id) => id !== jobId) })),
}));
```

- [ ] **Step 2: Create the tray component**

```tsx
// apps/web/app/components/BackgroundJobsTray.tsx
"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "../lib/fetch-json";
import { useBackgroundJobsStore } from "../stores/useBackgroundJobsStore";

interface BackgroundJob {
  id: string;
  kind: "dataset-install" | "model-install" | "model-uninstall";
  label: string;
  status: "running" | "done" | "failed";
  error: string | null;
  result: unknown | null;
}

interface SearchBatch {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  total: number;
  done: number;
  failed: number;
}

const KIND_VERB: Record<BackgroundJob["kind"], string> = {
  "dataset-install": "Instalando dataset",
  "model-install": "Instalando",
  "model-uninstall": "Desinstalando",
};

function jobHeadline(job: BackgroundJob): string {
  if (job.status === "running") return `${KIND_VERB[job.kind]} ${job.label}…`;
  if (job.status === "done") return `${job.label}: listo`;
  return `${job.label}: ${job.error ?? "error"}`;
}

/**
 * Persistent bottom-right notification stack for background_jobs rows and
 * the current search batch, mounted once in AppShell (outside any route's
 * page tree) so it survives navigation between routes. Recovers active
 * work on mount by querying the server directly — no localStorage — since
 * background_jobs and search_batches are already the durable source of
 * truth for "is this still running" (spec: docs/superpowers/specs/
 * 2026-07-20-background-jobs-tray-design.md).
 */
export function BackgroundJobsTray() {
  const trackedIds = useBackgroundJobsStore((s) => s.trackedIds);
  const registerJob = useBackgroundJobsStore((s) => s.registerJob);
  const untrackJob = useBackgroundJobsStore((s) => s.untrackJob);
  const [jobs, setJobs] = useState<Record<string, BackgroundJob>>({});
  const [batch, setBatch] = useState<SearchBatch | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Recover whatever's already active on the server the moment this mounts
  // — including right after a reload, when trackedIds is empty because
  // this is a fresh client with no memory of what it started before.
  useEffect(() => {
    fetchJson<{ jobs: BackgroundJob[] }>("/api/jobs?active=true").then((r) => {
      for (const job of r.data?.jobs ?? []) registerJob(job.id);
    });
    fetchJson<{ batch: SearchBatch | null }>("/api/search/batch/active").then((r) => {
      if (r.data?.batch) setBatch(r.data.batch);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (trackedIds.length === 0) return;
    let cancelled = false;

    async function poll() {
      for (const id of trackedIds) {
        const { data } = await fetchJson<BackgroundJob>(`/api/jobs/${id}`);
        if (cancelled || !data) continue;
        setJobs((prev) => ({ ...prev, [id]: data }));
      }
    }

    poll();
    const interval = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [trackedIds]);

  useEffect(() => {
    if (!batch || batch.status === "done" || batch.status === "failed") return;
    let cancelled = false;
    const interval = setInterval(async () => {
      const { data } = await fetchJson<SearchBatch>(`/api/search/batch/active`);
      if (!cancelled) setBatch(data ?? null);
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [batch]);

  const visibleJobs = trackedIds.map((id) => jobs[id]).filter((j): j is BackgroundJob => Boolean(j) && !dismissedIds.has(j.id));

  if (visibleJobs.length === 0 && !batch) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2">
      {visibleJobs.map((job) => (
        <div
          key={job.id}
          className="flex w-[260px] items-center gap-2.5 rounded-lg border border-white/[.12] bg-panel/[.97] p-2.5 shadow-lg shadow-black/40"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-medium text-fg">{jobHeadline(job)}</div>
            {job.status === "running" && (
              <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[.08]">
                <div
                  className="h-full w-2/5 rounded-full bg-fg/60"
                  style={{ animation: "lumi-shimmer 1.6s ease-in-out infinite" }}
                />
              </div>
            )}
          </div>
          {job.status !== "running" && (
            <button
              onClick={() => {
                untrackJob(job.id);
                setDismissedIds((prev) => new Set(prev).add(job.id));
              }}
              className="text-subtle hover:text-fg"
              aria-label="Cerrar"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {batch && (
        <div className="flex w-[260px] items-center gap-2.5 rounded-lg border border-white/[.12] bg-panel/[.97] p-2.5 shadow-lg shadow-black/40">
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-medium text-fg">
              Escaneando {batch.done}/{batch.total}…
            </div>
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[.08]">
              <div
                className="h-full w-2/5 rounded-full bg-fg/60"
                style={{ animation: "lumi-shimmer 1.6s ease-in-out infinite" }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount the tray in `AppShell`**

In `apps/web/app/components/AppShell.tsx`, add the import and render it once, as a sibling of `<main>`:

```tsx
import { BackgroundJobsTray } from "./BackgroundJobsTray";
```

```tsx
      <main className="relative flex-1 overflow-hidden bg-surface">{children}</main>
      {catalogOpen && <CatalogBrowser onClose={() => setCatalogOpen(false)} />}
      <BackgroundJobsTray />
```

(Added as the last child of the outer `<div className="flex h-screen w-screen overflow-hidden">`, right after the existing `{catalogOpen && ...}` block.)

- [ ] **Step 4: Manual verification**

Run: `cd apps/web && npm run dev` (or whatever the dev script is), then:
1. Go to Ajustes → Modelos, click Instalar on a generic-classifier model. Confirm a bottom-right card appears reading "Instalando {modelId} v{version}…", then flips to "{label}: listo" within a second or two.
2. Reload the page mid-install of a code-bundle release (Lumi Preview) — before it finishes — and confirm the tray reappears after reload still tracking the same job (check Network tab for `GET /api/jobs?active=true` returning that job, then polling `GET /api/jobs/:id`).
3. Confirm dismissing a finished card (✕) removes it and it doesn't reappear after another reload (its `updated_at` will have aged past the 15-second recovery window by then).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/stores/useBackgroundJobsStore.ts apps/web/app/components/BackgroundJobsTray.tsx apps/web/app/components/AppShell.tsx
git commit -m "feat(web): add persistent background jobs notification tray"
```

---

### Task 7: Wire `ModelosSection.tsx` to the tray

**Files:**
- Modify: `apps/web/app/components/ModelosSection.tsx`

**Interfaces:**
- Consumes: `useBackgroundJobsStore` (Task 6) for `registerJob`; existing `refreshCatalog()`/`refreshUninstallInfo()` already defined in this file.

No test file — matches this file's existing convention (no test file today either).

- [ ] **Step 1: Replace `install()`/`uninstall()` and drop local progress state**

In `apps/web/app/components/ModelosSection.tsx`:

Remove these two lines (no longer needed — the tray shows progress instead):

```tsx
  const [uninstalling, setUninstalling] = useState(false);
  const [installing, setInstalling] = useState(false);
```

Add this import:

```tsx
import { useBackgroundJobsStore } from "../stores/useBackgroundJobsStore";
```

Inside the component body, add:

```tsx
  const registerJob = useBackgroundJobsStore((s) => s.registerJob);
```

Replace the whole `install()` function with:

```tsx
  async function install(item: ModelCatalogItem) {
    const { ok, data } = await fetchJson<{ jobId: string }>("/api/model-catalog/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: item.owner, repo: item.repo, tag: item.release.tag }),
    });
    if (ok && data?.jobId) {
      registerJob(data.jobId);
    } else {
      setStatus((data as { error?: string } | null)?.error ?? "No se pudo iniciar la instalación");
    }
  }
```

Replace the whole `uninstall()` function with:

```tsx
  async function uninstall() {
    if (!selected) return;
    const isClassifier = selected.release.kind === "generic-classifier";
    const { ok, data } = await fetchJson<{ jobId: string }>("/api/model-catalog/uninstall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(isClassifier ? { modelId: (selected.release as { modelId: string }).modelId } : {}),
    });
    if (ok && data?.jobId) {
      registerJob(data.jobId);
    } else {
      setStatus((data as { error?: string } | null)?.error ?? "No se pudo iniciar la desinstalación");
    }
  }
```

Every reference to `installing`/`uninstalling` elsewhere in the file's JSX (the `<ModelLoadNotification active={installing || uninstalling} .../>` render and the `uninstalling ? "Desinstalando…" : ...` label logic in `secondaryAction`) is removed:

- Delete the `<ModelLoadNotification .../>` element entirely (the tray now owns this).
- Delete the now-unused `ModelLoadNotification` import.
- In both `secondaryAction` blocks (code-bundle and generic-classifier detail panels), change:

```tsx
                      label: uninstalling
                        ? "Desinstalando…"
                        : uninstallInfo.previousVersion
                          ? `Desinstalar (volver a v${uninstallInfo.previousVersion})`
                          : "Desinstalar",
                      onClick: uninstall,
                      disabled: uninstalling || !uninstallInfo.available,
```

to:

```tsx
                      label: uninstallInfo.previousVersion
                        ? `Desinstalar (volver a v${uninstallInfo.previousVersion})`
                        : "Desinstalar",
                      onClick: uninstall,
                      disabled: !uninstallInfo.available,
```

- [ ] **Step 2: Refresh the catalog/uninstall-info once a registered job completes**

The old code called `refreshCatalog()`/`refreshUninstallInfo()` right after the install/uninstall `fetch` resolved. Now that resolution only means "the job started," not "the job finished" — the refresh needs to happen when the tray-tracked job transitions to `done`. Add a small effect that watches the store's tracked jobs and refreshes once a job this component started reaches a terminal `background_jobs` state, by polling the same `/api/jobs/:id` endpoint the tray already polls (this component doesn't need to share the tray's poll loop — it only needs to know when to refresh its own two lists):

```tsx
  const [watchedJobId, setWatchedJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!watchedJobId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      const { data } = await fetchJson<{ status: "running" | "done" | "failed" }>(`/api/jobs/${watchedJobId}`);
      if (cancelled || !data || data.status === "running") return;
      clearInterval(interval);
      setWatchedJobId(null);
      await refreshCatalog();
      refreshUninstallInfo(selected?.release ?? null);
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedJobId]);
```

And in both `install()` and `uninstall()`, alongside `registerJob(data.jobId)`, add `setWatchedJobId(data.jobId);`.

- [ ] **Step 3: Manual verification**

Run the dev server, install a generic-classifier model from Ajustes → Modelos, and confirm: the tray shows progress, the card flips to Instalada within ~1s of the job completing (no manual refresh needed), and the button label/disabled state updates correctly — the exact regression this component's previous session fix (`d1d55a6`) was guarding against, now driven by job completion instead of the fetch's own resolution.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/ModelosSection.tsx
git commit -m "feat(web): wire ModelosSection install/uninstall to the background jobs tray"
```

---

### Task 8: Wire `DatasetsSection.tsx` to the tray

**Files:**
- Modify: `apps/web/app/components/DatasetsSection.tsx`

**Interfaces:**
- Consumes: `useBackgroundJobsStore` (Task 6) for `registerJob`; existing `reload()` already defined in this file.

No test file — matches this file's existing convention.

- [ ] **Step 1: Replace `install()` and drop the local `status` string**

In `apps/web/app/components/DatasetsSection.tsx`:

Add the import:

```tsx
import { useEffect, useState } from "react";
import { useBackgroundJobsStore } from "../stores/useBackgroundJobsStore";
```

Inside the component, add:

```tsx
  const registerJob = useBackgroundJobsStore((s) => s.registerJob);
  const [watchedJobId, setWatchedJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!watchedJobId) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      const { data } = await fetchJson<{ status: "running" | "done" | "failed" }>(`/api/jobs/${watchedJobId}`);
      if (cancelled || !data || data.status === "running") return;
      clearInterval(interval);
      setWatchedJobId(null);
      reload();
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedJobId]);
```

Replace the whole `install()` function — note the existing `409`/mismatch branch is unchanged, since that's still a synchronous response from the route (Task 3 left it untouched):

```tsx
  async function install(item: DatasetCatalogItem, forceInstall: boolean) {
    const { ok, data } = await fetchJson<{ jobId: string }>("/api/datasets/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: item.owner, repo: item.repo, tag: item.release.tag, forceInstall }),
    });
    if (!ok && (data as { compatible?: boolean } | null)?.compatible === false && !forceInstall) {
      setPendingInstall(item);
      return;
    }
    if (ok && data?.jobId) {
      registerJob(data.jobId);
      setWatchedJobId(data.jobId);
    } else {
      setStatus((data as { error?: string } | null)?.error ?? "No se pudo iniciar la instalación");
    }
  }
```

Remove the now-stale `setStatus("Instalando…")` call that used to be the first line of `install()` — the tray shows "Instalando…" progress now, this component only needs `status` for its own synchronous error messages.

The existing `{status && <div className="px-5 pb-3 text-xs text-muted">{status}</div>}` render and the `status`/`setStatus` state declaration stay — they're still used for the synchronous-error case above.

- [ ] **Step 2: Manual verification**

Run the dev server, install a dataset from Ajustes → Datasets, and confirm: the tray shows "Instalando dataset {owner}/{repo}@{tag}…", the areas list (`reload()`) refreshes once the job completes, and reloading the page mid-install still shows the tray recovering the job.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/DatasetsSection.tsx
git commit -m "feat(web): wire DatasetsSection install to the background jobs tray"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), job helper library (Task 1), all three route conversions (Tasks 3–5), `GET /api/jobs`/`GET /api/jobs/:id`/`GET /api/search/batch/active` (Task 2), tray + store (Task 6), both call-site rewrites (Tasks 7–8), `APPLICATION_TABLES` update (Task 1) — every section of the spec has a task.
- **Non-goals respected:** no task touches `useIndexingStore`, `JobProgressBar.tsx`, or `ModelLoadNotification.tsx`'s other call sites in `SearchDashboard.tsx`/`ResetConfirmDialog.tsx`.
- **Type consistency:** `BackgroundJob`/`BackgroundJobKind`/`BackgroundJobStatus` from Task 1 match the shape re-declared client-side in Task 6's `BackgroundJobsTray.tsx` (client components don't import server `lib/` modules, matching the existing `catalog-types.ts` split). `registerJob(jobId: string)` signature is identical everywhere it's called (Tasks 6, 7, 8).
- Task order matters: Task 1 before Task 2 (routes need `background-jobs.ts`), Tasks 1–2 before Tasks 3–5 (routes import `createJob`/`completeJob`/`failJob`), Task 6 before Tasks 7–8 (both call sites import `useBackgroundJobsStore`).
