# Weather Classifier + Batch Analysis Phase Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Wanda's `weather` facet into search the same way `time_of_day` already works, and show which coarse phase (embedding/searching/saving) an in-flight batch photo is in, inside the existing "Escaneando X/Y…" notification.

**Architecture:** Feature D (phase progress) is built first: `search_batches` gains a `current_phase` column, `runSearch` gains a fire-and-forget `reportPhase` dep called at three stage transitions, threaded from the worker's per-batch job through an optional `batchId` form field on the estimate request. Feature C (weather) then mirrors `time_of_day`'s already-proven wiring exactly: facet discovery → classify dep → `SearchResponse` field → store field → widget unlock.

**Tech Stack:** Next.js API routes, `pg-boss`-driven worker job, Zustand store, Vitest (mock-pool and mock-`fetch` patterns already established), Python FastAPI inference service (unchanged).

## Global Constraints

- Phase-reporting must never fail the actual search — `reportPhase` is fire-and-forget (`void`, not `Promise<void>`), errors swallowed at the call site.
- Weather classification failures degrade to `weather: null`, identical to `timeOfDay`'s existing handling — never fails the search.
- `weather` is never persisted to the DB — computed fresh per search, in-memory only, same rule as `timeOfDay`.
- A direct (non-batch) search has no `batchId` and must see zero behavior change — `reportPhase` is `undefined` in that case.
- Only three phase values are ever written: `"embedding"`, `"searching"`, `"saving"` — no DB-level enum constraint (matches `background_jobs.progress_phase`'s free-form `text`).
- UI-only components with no pure-function core (`WeatherEstimateWidget.tsx`, `ResultsPanel.tsx`, `BackgroundJobsTray.tsx`) get manual verification, no test file — matches this codebase's existing convention.

---

### Task 1: `search_batches.current_phase` + `reportBatchPhase`

**Files:**
- Create: `db/migrations/1721500000000_search_batches_phase.js`
- Create: `apps/web/lib/search/batch-phase.ts`
- Test: `apps/web/lib/search/batch-phase.test.ts`

**Interfaces:**
- Produces: `reportBatchPhase(pool: Pool, batchId: string, phase: "embedding" | "searching" | "saving"): Promise<void>` — Task 2 (`run-search.ts`) and Task 3 (the estimate route) use this.

- [ ] **Step 1: Write the migration**

```js
// db/migrations/1721500000000_search_batches_phase.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE search_batches ADD COLUMN current_phase text;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE search_batches DROP COLUMN current_phase;`);
};
```

- [ ] **Step 2: Run the migration**

Run: `cd db && pnpm migrate:up` (or whatever this repo's migration command is — check `db/package.json`'s scripts if unsure; the previous session used `pnpm --filter @netryx/db migrate:up` from the repo root).
Expected: migration applies; `docker exec netryx-db psql -U netryx -d netryx_dev -c "\d search_batches"` shows the new `current_phase` column.

- [ ] **Step 3: Write the failing test**

```ts
// apps/web/lib/search/batch-phase.test.ts
import { describe, it, expect, vi } from "vitest";
import { reportBatchPhase } from "./batch-phase";

function makePool(queryImpl: (sql: string, params: unknown[]) => Promise<{ rows: any[] }>) {
  return { query: vi.fn(queryImpl) } as any;
}

describe("reportBatchPhase", () => {
  it("writes current_phase and bumps updated_at", async () => {
    const pool = makePool(async (sql, params) => {
      expect(sql).toContain("UPDATE search_batches");
      expect(sql).toContain("current_phase = $2");
      expect(params).toEqual(["batch-1", "searching"]);
      return { rows: [] };
    });

    await reportBatchPhase(pool, "batch-1", "searching");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/search/batch-phase.test.ts`
Expected: FAIL — `Cannot find module './batch-phase'`.

- [ ] **Step 5: Implement it**

```ts
// apps/web/lib/search/batch-phase.ts
import type { Pool } from "pg";

export type BatchPhase = "embedding" | "searching" | "saving";

/** Reports which coarse phase of a single in-flight batch photo's analysis
 * is currently running — surfaced by the "Escaneando X/Y…" notification
 * (spec: docs/superpowers/specs/2026-07-21-weather-classifier-and-batch-
 * phase-design.md). Only ever called for a search that's part of a batch
 * (see the estimate route's optional batchId handling) — a direct UI
 * search never calls this at all. */
export async function reportBatchPhase(pool: Pool, batchId: string, phase: BatchPhase): Promise<void> {
  await pool.query(
    `UPDATE search_batches SET current_phase = $2, updated_at = now() WHERE id = $1`,
    [batchId, phase]
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/search/batch-phase.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/1721500000000_search_batches_phase.js apps/web/lib/search/batch-phase.ts apps/web/lib/search/batch-phase.test.ts
git commit -m "feat(web): add search_batches.current_phase and reportBatchPhase"
```

---

### Task 2: `RunSearchDeps.reportPhase`

**Files:**
- Modify: `apps/web/lib/search/run-search.ts`
- Modify: `apps/web/lib/search/run-search.test.ts`

**Interfaces:**
- Produces: `RunSearchDeps.reportPhase?: (phase: "embedding" | "searching" | "saving") => void` — Task 3 (the estimate route) constructs this dep using `reportBatchPhase` (Task 1).

- [ ] **Step 1: Write the failing test**

Add to `apps/web/lib/search/run-search.test.ts`:

```ts
  it("calls reportPhase at each stage transition, in order, when the dep is provided", async () => {
    const embedding = [1, 0];
    const retrieved: RetrievedCandidate[] = [
      { indexedImageId: "img-1", panoId: "p", heading: 0, lat: 1, lng: 2, similarity: 0.5, embedding },
    ];
    const regions: ClusteredRegion[] = [
      { centroid: { lat: 1, lng: 2 }, radiusM: 150, aggregateScore: 0.9, memberIds: ["img-1"] },
    ];
    const phasesReported: string[] = [];

    const deps = {
      newSearchId: () => "search-x",
      embedQuery: vi.fn().mockResolvedValue(embedding),
      retrieve: vi.fn().mockResolvedValue(retrieved),
      rerank: vi.fn().mockReturnValue(retrieved),
      cluster: vi.fn().mockReturnValue(regions),
      saveImage: vi.fn().mockResolvedValue("/tmp/search-x.jpg"),
      persist: vi.fn().mockResolvedValue({ searchId: "search-x", regions: [], candidatesByRegion: {}, timeOfDay: null }),
      reportPhase: vi.fn((phase: string) => phasesReported.push(phase)),
    };

    await runSearch(deps, { imageBase64: "aaaa", imageBytes: Buffer.from([1]), imageExt: "jpg" });

    expect(phasesReported).toEqual(["embedding", "searching", "saving"]);
  });

  it("never calls reportPhase when the dep is omitted", async () => {
    const embedding = [1, 0];
    const retrieved: RetrievedCandidate[] = [
      { indexedImageId: "img-1", panoId: "p", heading: 0, lat: 1, lng: 2, similarity: 0.5, embedding },
    ];
    const regions: ClusteredRegion[] = [
      { centroid: { lat: 1, lng: 2 }, radiusM: 150, aggregateScore: 0.9, memberIds: ["img-1"] },
    ];

    const deps = {
      newSearchId: () => "search-x",
      embedQuery: vi.fn().mockResolvedValue(embedding),
      retrieve: vi.fn().mockResolvedValue(retrieved),
      rerank: vi.fn().mockReturnValue(retrieved),
      cluster: vi.fn().mockReturnValue(regions),
      saveImage: vi.fn().mockResolvedValue("/tmp/search-x.jpg"),
      persist: vi.fn().mockResolvedValue({ searchId: "search-x", regions: [], candidatesByRegion: {}, timeOfDay: null }),
    };

    // No reportPhase in deps at all — runSearch must not throw calling an
    // undefined function.
    await expect(
      runSearch(deps, { imageBase64: "aaaa", imageBytes: Buffer.from([1]), imageExt: "jpg" })
    ).resolves.toBeDefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/search/run-search.test.ts`
Expected: FAIL — `deps.reportPhase` doesn't exist on the type, and `phasesReported` stays `[]` since `runSearch` never calls it.

- [ ] **Step 3: Implement it**

In `apps/web/lib/search/run-search.ts`, add to `RunSearchDeps` (after `classifyTimeOfDay`):

```ts
  /** Optional — omitted entirely for a direct (non-batch) search. Fire-
   * and-forget: returns void, not Promise<void>, so runSearch never awaits
   * it and a DB write failure inside it can't propagate into the search
   * itself (the caller building this dep is responsible for catching its
   * own errors — see estimate/route.ts). Called at the start of each of
   * the three coarse stages a batch-scan notification can meaningfully
   * show (spec: docs/superpowers/specs/2026-07-21-weather-classifier-and-
   * batch-phase-design.md). */
  reportPhase?: (phase: "embedding" | "searching" | "saving") => void;
```

Change `runSearch`'s body from:

```ts
export async function runSearch(deps: RunSearchDeps, input: RunSearchInput): Promise<SearchResponse> {
  const searchId = deps.newSearchId();
  const [queryEmbedding, timeOfDay] = await Promise.all([
    deps.embedQuery(input.imageBase64),
    deps.classifyTimeOfDay ? deps.classifyTimeOfDay(input.imageBase64) : Promise.resolve(null),
  ]);
  const retrieved = await deps.retrieve(queryEmbedding);
  const reranked = deps.rerank(queryEmbedding, retrieved);
  const regions = deps.cluster(reranked);
  const queryImagePath = await deps.saveImage(searchId, input.imageBytes, input.imageExt);
  return deps.persist({ queryImagePath, queryEmbedding, candidates: reranked, regions, timeOfDay });
}
```

to:

```ts
export async function runSearch(deps: RunSearchDeps, input: RunSearchInput): Promise<SearchResponse> {
  const searchId = deps.newSearchId();
  deps.reportPhase?.("embedding");
  const [queryEmbedding, timeOfDay] = await Promise.all([
    deps.embedQuery(input.imageBase64),
    deps.classifyTimeOfDay ? deps.classifyTimeOfDay(input.imageBase64) : Promise.resolve(null),
  ]);
  deps.reportPhase?.("searching");
  const retrieved = await deps.retrieve(queryEmbedding);
  const reranked = deps.rerank(queryEmbedding, retrieved);
  const regions = deps.cluster(reranked);
  deps.reportPhase?.("saving");
  const queryImagePath = await deps.saveImage(searchId, input.imageBytes, input.imageExt);
  return deps.persist({ queryImagePath, queryEmbedding, candidates: reranked, regions, timeOfDay });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/search/run-search.test.ts`
Expected: PASS, 5 tests (3 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/run-search.ts apps/web/lib/search/run-search.test.ts
git commit -m "feat(web): add reportPhase dep to runSearch, called at each stage transition"
```

---

### Task 3: wire `batchId` + `reportPhase` into the estimate route

**Files:**
- Modify: `apps/web/app/api/models/[modelId]/estimate/route.ts`
- Modify: `apps/web/app/api/models/[modelId]/estimate/route.test.ts`

**Interfaces:**
- Consumes: `reportBatchPhase` (Task 1), `RunSearchDeps.reportPhase` (Task 2).
- Produces: nothing further downstream for Feature D — this is where phase reporting becomes observable end-to-end (once Task 4 threads `batchId` from the worker).

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/app/api/models/[modelId]/estimate/route.test.ts`:

```ts
vi.mock("../../../../../lib/search/batch-phase", () => ({ reportBatchPhase: vi.fn() }));
```

(add alongside the other `vi.mock` calls at the top)

```ts
  it("builds a reportPhase dep when batchId is present in the form", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {}, timeOfDay: null, weather: null });

    const { POST } = await import("./route");
    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
    form.append("batchId", "batch-1");
    await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    const depsPassed = (runSearch as any).mock.calls[0][0];
    expect(depsPassed.reportPhase).toBeInstanceOf(Function);

    const { reportBatchPhase } = await import("../../../../../lib/search/batch-phase");
    depsPassed.reportPhase("searching");
    expect(reportBatchPhase).toHaveBeenCalledWith(expect.anything(), "batch-1", "searching");
  });

  it("omits reportPhase entirely when no batchId is present", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {}, timeOfDay: null, weather: null });

    const { POST } = await import("./route");
    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
    await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    const depsPassed = (runSearch as any).mock.calls[0][0];
    expect(depsPassed.reportPhase).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run "app/api/models/[modelId]/estimate/route.test.ts"`
Expected: FAIL — `depsPassed.reportPhase` is `undefined` in the first new test (the route doesn't build it yet).

- [ ] **Step 3: Implement it**

In `apps/web/app/api/models/[modelId]/estimate/route.ts`, add to the imports:

```ts
import { reportBatchPhase } from "../../../../../lib/search/batch-phase";
```

After the existing `const file = form.get("image");` / image validation block, and before `const pool = getPool();`, add:

```ts
  const batchIdField = form.get("batchId");
  const batchId = typeof batchIdField === "string" && batchIdField.length > 0 ? batchIdField : undefined;
```

In the `deps` object literal, add `reportPhase` alongside the existing `classifyTimeOfDay` spread (after `persist: (args) => persistSearch(pool, args),`):

```ts
    ...(batchId
      ? {
          reportPhase: (phase: "embedding" | "searching" | "saving") => {
            void reportBatchPhase(pool, batchId, phase).catch(() => {});
          },
        }
      : {}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run "app/api/models/[modelId]/estimate/route.test.ts"`
Expected: PASS, all tests (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/api/models/[modelId]/estimate/route.ts" "apps/web/app/api/models/[modelId]/estimate/route.test.ts"
git commit -m "feat(web): report analysis phase to search_batches when a batchId is present"
```

---

### Task 4: thread `batchId` from the worker into `analyzeOne`

**Files:**
- Modify: `apps/worker/src/jobs/analyze-image-batch.ts`
- Modify: `apps/worker/src/jobs/analyze-image-batch.test.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Produces: `AnalyzeImageBatchJobDeps.analyzeOne: (imageBytes: Buffer, modelId: string, batchId: string) => Promise<SearchResponse>` — the real worker (in `index.ts`) implements this by adding `batchId` as a form field on its POST to `/estimate`, which Task 3's route reads.

- [ ] **Step 1: Update the failing tests to assert `batchId` is threaded through**

In `apps/worker/src/jobs/analyze-image-batch.test.ts`, change the first test's assertion from:

```ts
    expect(analyzeOne).toHaveBeenCalledTimes(2);
```

to also assert the exact call arguments:

```ts
    expect(analyzeOne).toHaveBeenCalledTimes(2);
    expect(analyzeOne).toHaveBeenNthCalledWith(1, expect.any(Buffer), "lumi-preview", "b1");
    expect(analyzeOne).toHaveBeenNthCalledWith(2, expect.any(Buffer), "lumi-preview", "b1");
```

(Add these two lines right after the existing `expect(analyzeOne).toHaveBeenCalledTimes(2);` line in the first test — `"analyzes each image, reports progress, and marks the batch done with the first result"`. Leave the other three tests in this file unchanged; they don't assert `analyzeOne`'s call arguments.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/worker && npx vitest run src/jobs/analyze-image-batch.test.ts`
Expected: FAIL — `analyzeOne` was called with only 2 arguments (`bytes, modelId`), not 3.

- [ ] **Step 3: Implement it**

In `apps/worker/src/jobs/analyze-image-batch.ts`, change the `AnalyzeImageBatchJobDeps` interface's `analyzeOne` field from:

```ts
  analyzeOne: (imageBytes: Buffer, modelId: string) => Promise<SearchResponse>;
```

to:

```ts
  analyzeOne: (imageBytes: Buffer, modelId: string, batchId: string) => Promise<SearchResponse>;
```

And change the call site inside the `for` loop from:

```ts
        const one = await deps.analyzeOne(bytes, modelId);
```

to:

```ts
        const one = await deps.analyzeOne(bytes, modelId, batchId);
```

(`batchId` is already in scope from the `const { batchId, imageIds, modelId } = payload;` destructure at the top of the function.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/worker && npx vitest run src/jobs/analyze-image-batch.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Update the real worker's `analyzeOne` implementation**

In `apps/worker/src/index.ts`, change:

```ts
      analyzeOne: async (imageBytes, modelId) => {
        const form = new FormData();
        form.append("image", new Blob([imageBytes as unknown as BlobPart]), "batch-image");
        const res = await fetch(`${webBaseUrl}/api/models/${modelId}/estimate`, { method: "POST", body: form });
        if (!res.ok) throw new Error(`estimate failed with status ${res.status}`);
        return res.json();
      },
```

to:

```ts
      analyzeOne: async (imageBytes, modelId, batchId) => {
        const form = new FormData();
        form.append("image", new Blob([imageBytes as unknown as BlobPart]), "batch-image");
        form.append("batchId", batchId);
        const res = await fetch(`${webBaseUrl}/api/models/${modelId}/estimate`, { method: "POST", body: form });
        if (!res.ok) throw new Error(`estimate failed with status ${res.status}`);
        return res.json();
      },
```

- [ ] **Step 6: Run the full worker test suite and typecheck**

Run: `cd apps/worker && npx tsc --noEmit && npx vitest run`
Expected: no new failures.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/jobs/analyze-image-batch.ts apps/worker/src/jobs/analyze-image-batch.test.ts apps/worker/src/index.ts
git commit -m "feat(worker): thread batchId into analyzeOne's estimate call"
```

---

### Task 5: `GET /api/search/batch/active` returns `currentPhase`

**Files:**
- Modify: `apps/web/app/api/search/batch/active/route.ts`
- Modify: `apps/web/app/api/search/batch/active/route.test.ts`

**Interfaces:**
- Produces: `GET /api/search/batch/active` → `{ batch: { id, status, total, done, failed, currentPhase: string | null } | null }` — Task 6 (`BackgroundJobsTray.tsx`) consumes this.

- [ ] **Step 1: Update the failing tests**

Replace the full content of `apps/web/app/api/search/batch/active/route.test.ts` with:

```ts
// apps/web/app/api/search/batch/active/route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../../lib/db", () => ({ getPool: vi.fn() }));

describe("GET /api/search/batch/active", () => {
  it("returns the most recent non-terminal batch, including its current phase", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ id: "batch-1", status: "running", total: 5, done: 2, failed: 0, current_phase: "searching" }],
    });
    const { getPool } = await import("../../../../../lib/db");
    (getPool as any).mockReturnValue({ query });

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.batch).toEqual({ id: "batch-1", status: "running", total: 5, done: 2, failed: 0, currentPhase: "searching" });
    expect(query.mock.calls[0][0]).toContain("status IN ('pending', 'running')");
    expect(query.mock.calls[0][0]).toContain("current_phase");
  });

  it("returns currentPhase: null when no phase has been reported yet", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ id: "batch-1", status: "pending", total: 5, done: 0, failed: 0, current_phase: null }],
    });
    const { getPool } = await import("../../../../../lib/db");
    (getPool as any).mockReturnValue({ query });

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(json.batch.currentPhase).toBeNull();
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

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run app/api/search/batch/active/route.test.ts`
Expected: FAIL — `json.batch` still has `current_phase` (snake_case) instead of `currentPhase`, and the SQL doesn't select it yet.

- [ ] **Step 3: Implement it**

Replace `apps/web/app/api/search/batch/active/route.ts`'s `GET` function body:

```ts
export async function GET() {
  const { rows } = await getPool().query(
    `SELECT id, status, total, done, failed FROM search_batches
     WHERE status IN ('pending', 'running')
     ORDER BY id DESC LIMIT 1`
  );
  return NextResponse.json({ batch: rows[0] ?? null });
}
```

with:

```ts
export async function GET() {
  const { rows } = await getPool().query(
    `SELECT id, status, total, done, failed, current_phase FROM search_batches
     WHERE status IN ('pending', 'running')
     ORDER BY id DESC LIMIT 1`
  );
  const row = rows[0];
  const batch = row
    ? { id: row.id, status: row.status, total: row.total, done: row.done, failed: row.failed, currentPhase: row.current_phase }
    : null;
  return NextResponse.json({ batch });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run app/api/search/batch/active/route.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/search/batch/active/route.ts apps/web/app/api/search/batch/active/route.test.ts
git commit -m "feat(web): expose current_phase as currentPhase from GET /api/search/batch/active"
```

---

### Task 6: show the phase in `BackgroundJobsTray.tsx`

**Files:**
- Modify: `apps/web/app/components/BackgroundJobsTray.tsx`

**Interfaces:**
- Consumes: `GET /api/search/batch/active`'s `currentPhase` field (Task 5).

No test file — matches this file's existing convention.

- [ ] **Step 1: Add `currentPhase` to the `SearchBatch` interface and a phase label map**

Change:

```ts
interface SearchBatch {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  total: number;
  done: number;
  failed: number;
}
```

to:

```ts
interface SearchBatch {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  total: number;
  done: number;
  failed: number;
  currentPhase: string | null;
}
```

Add, alongside the existing `PHASE_VERB` constant:

```ts
const BATCH_PHASE_LABEL: Record<string, string> = {
  embedding: "Analizando…",
  searching: "Buscando coincidencias…",
  saving: "Guardando…",
};
```

- [ ] **Step 2: Show the phase as a second line in the batch card**

Change:

```tsx
      {batch && (
        <div className="flex w-[260px] items-center gap-2.5 rounded-lg border border-white/[.12] bg-panel/[.97] p-2.5 shadow-lg shadow-black/40">
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-medium text-fg">
              Escaneando {batch.done}/{batch.total}…
            </div>
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[.08]">
              <div
                className="h-full rounded-full bg-fg/60"
                style={{ width: `${batch.total > 0 ? Math.min(100, Math.round((batch.done / batch.total) * 100)) : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}
```

to:

```tsx
      {batch && (
        <div className="flex w-[260px] items-center gap-2.5 rounded-lg border border-white/[.12] bg-panel/[.97] p-2.5 shadow-lg shadow-black/40">
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-medium text-fg">
              Escaneando {batch.done}/{batch.total}…
            </div>
            {batch.currentPhase && BATCH_PHASE_LABEL[batch.currentPhase] && (
              <div className="mt-0.5 text-[9.5px] text-muted">{BATCH_PHASE_LABEL[batch.currentPhase]}</div>
            )}
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/[.08]">
              <div
                className="h-full rounded-full bg-fg/60"
                style={{ width: `${batch.total > 0 ? Math.min(100, Math.round((batch.done / batch.total) * 100)) : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Manual verification**

Run the dev server, trigger a batch search (multiple photos at once), and confirm: the bottom-right "Escaneando X/Y…" notification shows a second line ("Analizando…" → "Buscando coincidencias…" → "Guardando…") that changes as each photo moves through its analysis, and the notification still degrades gracefully (no second line, no crash) for a batch whose `current_phase` hasn't been set yet (e.g. right at batch creation, before the first phase report lands).

- [ ] **Step 4: Run the typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/BackgroundJobsTray.tsx
git commit -m "feat(web): show the current analysis phase in the batch-scan notification"
```

---

### Task 7: `SearchResponse.weather` field

**Files:**
- Modify: `packages/shared-types/src/search.ts:47-57`
- Modify: `apps/web/lib/search/get-search-result.ts:63`

**Interfaces:**
- Produces: `SearchResponse.weather: { label: string; score: number } | null` — every later task that constructs or consumes a `SearchResponse` uses this exact shape, mirroring `timeOfDay` exactly.

- [ ] **Step 1: Update the type**

In `packages/shared-types/src/search.ts`, change:

```ts
/** Response body of POST /api/search (Pass 1). */
export interface SearchResponse {
  searchId: string;
  regions: SearchRegion[];
  candidatesByRegion: Record<string, SearchCandidate[]>;
  /** Highest-scoring time_of_day facet label from Wanda (or any active
   * classifier serving that facet), or null if none is installed/active or
   * classification failed. Computed fresh per search — never persisted to
   * the DB (spec: docs/superpowers/specs/2026-07-21-results-layout-and-
   * time-of-day-design.md). */
  timeOfDay: { label: string; score: number } | null;
}
```

to:

```ts
/** Response body of POST /api/search (Pass 1). */
export interface SearchResponse {
  searchId: string;
  regions: SearchRegion[];
  candidatesByRegion: Record<string, SearchCandidate[]>;
  /** Highest-scoring time_of_day facet label from Wanda (or any active
   * classifier serving that facet), or null if none is installed/active or
   * classification failed. Computed fresh per search — never persisted to
   * the DB (spec: docs/superpowers/specs/2026-07-21-results-layout-and-
   * time-of-day-design.md). */
  timeOfDay: { label: string; score: number } | null;
  /** Same shape and same non-persistence rule as timeOfDay, for Wanda's
   * weather facet (spec: docs/superpowers/specs/2026-07-21-weather-
   * classifier-and-batch-phase-design.md). `label` is the raw HF label
   * (e.g. "rain/storm") — translation to Spanish happens at display time,
   * not stored translated. */
  weather: { label: string; score: number } | null;
}
```

- [ ] **Step 2: Fix the one other place that constructs a `SearchResponse` literal**

`apps/web/lib/search/get-search-result.ts` (reopening a past search) builds its `SearchResponse` directly, not via `persistSearch` — this was missed once already when `timeOfDay` was added and broke `next build`'s type-check, so check it explicitly this time. Change line 63 from:

```ts
  return { searchId, regions, candidatesByRegion, timeOfDay: null };
```

to:

```ts
  return { searchId, regions, candidatesByRegion, timeOfDay: null, weather: null };
```

(Same reasoning as `timeOfDay`: neither is ever persisted, so a reopened past search never had one to show.)

- [ ] **Step 3: Grep for any other `SearchResponse` literal and fix it too**

Run: `cd apps/web && grep -rn "searchId.*regions.*candidatesByRegion" --include=*.ts --include=*.tsx . | grep -v node_modules | grep -v .next | grep -v test`
Expected output: exactly two lines — `lib/search/persist.ts` (fixed in Task 9) and `lib/search/get-search-result.ts` (just fixed in Step 2). If the grep finds a third site, add `weather: null` (or a real value, if the test is specifically about weather) there too before moving on.

- [ ] **Step 4: Run the full typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: errors only in `useSearchStore.test.ts`'s `RESPONSE` fixture (fixed in Task 12) and `persist.ts`/`persist.test.ts` (fixed in Task 9) — nothing else. If anything unexpected shows up, fix it the same way (add `weather: null` to the literal).

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/search.ts apps/web/lib/search/get-search-result.ts
git commit -m "feat(shared-types): add SearchResponse.weather"
```

---

### Task 8: `spanishWeatherLabel`

**Files:**
- Create: `apps/web/lib/weather-label.ts`
- Test: `apps/web/lib/weather-label.test.ts`

**Interfaces:**
- Produces: `spanishWeatherLabel(label: string): string`. Task 13 (`WeatherEstimateWidget`/`ResultsPanel`) calls this with `weather.label` from the store.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/weather-label.test.ts
import { describe, it, expect } from "vitest";
import { spanishWeatherLabel } from "./weather-label";

describe("spanishWeatherLabel", () => {
  it("translates each of prithivMLmods/Weather-Image-Classification's five known labels", () => {
    expect(spanishWeatherLabel("cloudy/overcast")).toBe("Nublado");
    expect(spanishWeatherLabel("foggy/hazy")).toBe("Niebla");
    expect(spanishWeatherLabel("rain/storm")).toBe("Lluvia");
    expect(spanishWeatherLabel("snow/frosty")).toBe("Nieve");
    expect(spanishWeatherLabel("sun/clear")).toBe("Despejado");
  });

  it("falls back to the raw label for an unrecognized value", () => {
    expect(spanishWeatherLabel("some future model's different wording")).toBe("some future model's different wording");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/weather-label.test.ts`
Expected: FAIL — `Cannot find module './weather-label'`.

- [ ] **Step 3: Implement it**

```ts
// apps/web/lib/weather-label.ts

/** Wanda's weather facet (prithivMLmods/Weather-Image-Classification, an
 * HF image-classification pipeline) predicts exactly five fixed English
 * labels (confirmed via the model card) — this translates them for
 * display in an otherwise-Spanish UI. Unlike time_of_day's label→hour
 * mapping, there's no representative value to synthesize here (a weather
 * category doesn't reduce to a single number), so this is translation
 * only — an unrecognized label (a future model version) falls back to
 * showing itself rather than guessing or hiding the result. */
const WEATHER_LABEL_ES: Record<string, string> = {
  "cloudy/overcast": "Nublado",
  "foggy/hazy": "Niebla",
  "rain/storm": "Lluvia",
  "snow/frosty": "Nieve",
  "sun/clear": "Despejado",
};

export function spanishWeatherLabel(label: string): string {
  return WEATHER_LABEL_ES[label] ?? label;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/weather-label.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/weather-label.ts apps/web/lib/weather-label.test.ts
git commit -m "feat(web): add spanishWeatherLabel for Wanda's weather facet"
```

---

### Task 9: thread `weather` through `persistSearch`

**Files:**
- Modify: `apps/web/lib/search/persist.ts`
- Modify: `apps/web/lib/search/persist.test.ts`

**Interfaces:**
- Consumes: `SearchResponse.weather` (Task 7).
- Produces: `PersistSearchArgs.weather: { label: string; score: number } | null` — Task 10 (`run-search.ts`) passes this through when calling `persist(args)`.

- [ ] **Step 1: Write the failing test**

Add to the existing `d("persistSearch", ...)` block in `apps/web/lib/search/persist.test.ts`:

```ts
  it("passes weather through into the response without writing it anywhere", async () => {
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
      weather: { label: "rain/storm", score: 0.81 },
    });

    expect(res.weather).toEqual({ label: "rain/storm", score: 0.81 });
  });

  it("defaults weather to null when not provided", async () => {
    const res = await persistSearch(pool, {
      queryImagePath: "/tmp/q.jpg",
      queryEmbedding: new Array(8448).fill(0),
      candidates: [],
      regions: [],
    });

    expect(res.weather).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test npx vitest run lib/search/persist.test.ts`
Expected: FAIL — `weather` doesn't exist on `PersistSearchArgs` (TS error), or `res.weather` is `undefined`.

(If `TEST_DATABASE_URL` isn't set in this environment, this `describe` block is skipped — same caveat as the earlier `timeOfDay` task in the previous plan.)

- [ ] **Step 3: Implement it**

In `apps/web/lib/search/persist.ts`, change `PersistSearchArgs` from:

```ts
export interface PersistSearchArgs {
  queryImagePath: string;
  queryEmbedding: number[];
  candidates: RetrievedCandidate[]; // already re-ranked, best-first
  regions: ClusteredRegion[];
  /** Not persisted to the DB — passed straight through into the returned
   * SearchResponse (spec: docs/superpowers/specs/2026-07-21-results-
   * layout-and-time-of-day-design.md). */
  timeOfDay?: { label: string; score: number } | null;
}
```

to:

```ts
export interface PersistSearchArgs {
  queryImagePath: string;
  queryEmbedding: number[];
  candidates: RetrievedCandidate[]; // already re-ranked, best-first
  regions: ClusteredRegion[];
  /** Not persisted to the DB — passed straight through into the returned
   * SearchResponse (spec: docs/superpowers/specs/2026-07-21-results-
   * layout-and-time-of-day-design.md). */
  timeOfDay?: { label: string; score: number } | null;
  /** Same non-persistence rule as timeOfDay (spec: docs/superpowers/specs/
   * 2026-07-21-weather-classifier-and-batch-phase-design.md). */
  weather?: { label: string; score: number } | null;
}
```

And change the final return statement from:

```ts
    await client.query("COMMIT");
    return { searchId, regions: regionOut, candidatesByRegion, timeOfDay: args.timeOfDay ?? null };
```

to:

```ts
    await client.query("COMMIT");
    return {
      searchId,
      regions: regionOut,
      candidatesByRegion,
      timeOfDay: args.timeOfDay ?? null,
      weather: args.weather ?? null,
    };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test npx vitest run lib/search/persist.test.ts`
Expected: PASS, 5 tests (3 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/persist.ts apps/web/lib/search/persist.test.ts
git commit -m "feat(web): thread weather through persistSearch without persisting it"
```

---

### Task 10: `RunSearchDeps.classifyWeather`

**Files:**
- Modify: `apps/web/lib/search/run-search.ts`
- Modify: `apps/web/lib/search/run-search.test.ts`

**Interfaces:**
- Consumes: `PersistSearchArgs.weather` (Task 9).
- Produces: `RunSearchDeps.classifyWeather?: (imageBase64: string) => Promise<{ label: string; score: number } | null>` — Task 11 (the estimate route) constructs this dep, exactly mirroring `classifyTimeOfDay`.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/lib/search/run-search.test.ts`:

```ts
  it("calls classifyWeather concurrently with embedQuery/classifyTimeOfDay, and passes its result to persist", async () => {
    const embedding = [1, 0];
    const retrieved: RetrievedCandidate[] = [
      { indexedImageId: "img-1", panoId: "p", heading: 0, lat: 1, lng: 2, similarity: 0.5, embedding },
    ];
    const regions: ClusteredRegion[] = [
      { centroid: { lat: 1, lng: 2 }, radiusM: 150, aggregateScore: 0.9, memberIds: ["img-1"] },
    ];

    const deps = {
      newSearchId: () => "search-x",
      embedQuery: vi.fn().mockResolvedValue(embedding),
      retrieve: vi.fn().mockResolvedValue(retrieved),
      rerank: vi.fn().mockReturnValue(retrieved),
      cluster: vi.fn().mockReturnValue(regions),
      saveImage: vi.fn().mockResolvedValue("/tmp/search-x.jpg"),
      persist: vi.fn().mockResolvedValue({ searchId: "search-x", regions: [], candidatesByRegion: {}, timeOfDay: null, weather: null }),
      classifyWeather: vi.fn().mockResolvedValue({ label: "rain/storm", score: 0.81 }),
    };

    await runSearch(deps, { imageBase64: "aaaa", imageBytes: Buffer.from([1]), imageExt: "jpg" });

    expect(deps.classifyWeather).toHaveBeenCalledWith("aaaa");
    expect(deps.persist).toHaveBeenCalledWith(
      expect.objectContaining({ weather: { label: "rain/storm", score: 0.81 } })
    );
  });

  it("passes weather: null to persist when the classifyWeather dep is omitted", async () => {
    const embedding = [1, 0];
    const retrieved: RetrievedCandidate[] = [
      { indexedImageId: "img-1", panoId: "p", heading: 0, lat: 1, lng: 2, similarity: 0.5, embedding },
    ];
    const regions: ClusteredRegion[] = [
      { centroid: { lat: 1, lng: 2 }, radiusM: 150, aggregateScore: 0.9, memberIds: ["img-1"] },
    ];

    const deps = {
      newSearchId: () => "search-x",
      embedQuery: vi.fn().mockResolvedValue(embedding),
      retrieve: vi.fn().mockResolvedValue(retrieved),
      rerank: vi.fn().mockReturnValue(retrieved),
      cluster: vi.fn().mockReturnValue(regions),
      saveImage: vi.fn().mockResolvedValue("/tmp/search-x.jpg"),
      persist: vi.fn().mockResolvedValue({ searchId: "search-x", regions: [], candidatesByRegion: {}, timeOfDay: null, weather: null }),
    };

    await runSearch(deps, { imageBase64: "aaaa", imageBytes: Buffer.from([1]), imageExt: "jpg" });

    expect(deps.persist).toHaveBeenCalledWith(expect.objectContaining({ weather: null }));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/search/run-search.test.ts`
Expected: FAIL — `deps.classifyWeather` doesn't exist on the type, and `runSearch` never calls it.

- [ ] **Step 3: Implement it**

In `apps/web/lib/search/run-search.ts`, add to `RunSearchDeps` (after `classifyTimeOfDay`, before `reportPhase`):

```ts
  /** Same contract as classifyTimeOfDay — optional, must never reject, runs
   * concurrently with embedQuery/classifyTimeOfDay (spec: docs/superpowers/
   * specs/2026-07-21-weather-classifier-and-batch-phase-design.md). */
  classifyWeather?: (imageBase64: string) => Promise<{ label: string; score: number } | null>;
```

Change `runSearch`'s body from:

```ts
export async function runSearch(deps: RunSearchDeps, input: RunSearchInput): Promise<SearchResponse> {
  const searchId = deps.newSearchId();
  deps.reportPhase?.("embedding");
  const [queryEmbedding, timeOfDay] = await Promise.all([
    deps.embedQuery(input.imageBase64),
    deps.classifyTimeOfDay ? deps.classifyTimeOfDay(input.imageBase64) : Promise.resolve(null),
  ]);
  deps.reportPhase?.("searching");
  const retrieved = await deps.retrieve(queryEmbedding);
  const reranked = deps.rerank(queryEmbedding, retrieved);
  const regions = deps.cluster(reranked);
  deps.reportPhase?.("saving");
  const queryImagePath = await deps.saveImage(searchId, input.imageBytes, input.imageExt);
  return deps.persist({ queryImagePath, queryEmbedding, candidates: reranked, regions, timeOfDay });
}
```

to:

```ts
export async function runSearch(deps: RunSearchDeps, input: RunSearchInput): Promise<SearchResponse> {
  const searchId = deps.newSearchId();
  deps.reportPhase?.("embedding");
  const [queryEmbedding, timeOfDay, weather] = await Promise.all([
    deps.embedQuery(input.imageBase64),
    deps.classifyTimeOfDay ? deps.classifyTimeOfDay(input.imageBase64) : Promise.resolve(null),
    deps.classifyWeather ? deps.classifyWeather(input.imageBase64) : Promise.resolve(null),
  ]);
  deps.reportPhase?.("searching");
  const retrieved = await deps.retrieve(queryEmbedding);
  const reranked = deps.rerank(queryEmbedding, retrieved);
  const regions = deps.cluster(reranked);
  deps.reportPhase?.("saving");
  const queryImagePath = await deps.saveImage(searchId, input.imageBytes, input.imageExt);
  return deps.persist({ queryImagePath, queryEmbedding, candidates: reranked, regions, timeOfDay, weather });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/search/run-search.test.ts`
Expected: PASS, 7 tests (5 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/run-search.ts apps/web/lib/search/run-search.test.ts
git commit -m "feat(web): run classifyWeather concurrently with embedQuery/classifyTimeOfDay in runSearch"
```

---

### Task 11: wire weather into the estimate route

**Files:**
- Modify: `apps/web/app/api/models/[modelId]/estimate/route.ts`
- Modify: `apps/web/app/api/models/[modelId]/estimate/route.test.ts`

**Interfaces:**
- Consumes: `findActiveModelForFacet` (already exists, facet-agnostic — no changes to that function), `classifyQueryImage` (already exists, facet-agnostic), `RunSearchDeps.classifyWeather` (Task 10).

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/app/api/models/[modelId]/estimate/route.test.ts`, mirroring the existing `time_of_day` tests exactly:

```ts
  it("passes a classifyWeather dep to runSearch when an active model serves the weather facet", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {}, timeOfDay: null, weather: null });
    const { findActiveModelForFacet } = await import("../../../../../lib/model-catalog/classification-models");
    (findActiveModelForFacet as any).mockImplementation(async (_pool: unknown, facet: string) =>
      facet === "weather" ? { modelId: "wanda-v1" } : null
    );

    const { POST } = await import("./route");
    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
    await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    expect(findActiveModelForFacet).toHaveBeenCalledWith(expect.anything(), "weather");
    const depsPassed = (runSearch as any).mock.calls[0][0];
    expect(depsPassed.classifyWeather).toBeInstanceOf(Function);
  });

  it("omits classifyWeather entirely when no active model serves the facet", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {}, timeOfDay: null, weather: null });
    const { findActiveModelForFacet } = await import("../../../../../lib/model-catalog/classification-models");
    (findActiveModelForFacet as any).mockResolvedValue(null);

    const { POST } = await import("./route");
    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
    await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    const depsPassed = (runSearch as any).mock.calls[0][0];
    expect(depsPassed.classifyWeather).toBeUndefined();
  });

  it("classifyWeather dep resolves to the top weather label and never rejects on classify failure", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {}, timeOfDay: null, weather: null });
    const { findActiveModelForFacet } = await import("../../../../../lib/model-catalog/classification-models");
    (findActiveModelForFacet as any).mockImplementation(async (_pool: unknown, facet: string) =>
      facet === "weather" ? { modelId: "wanda-v1" } : null
    );
    const { classifyQueryImage } = await import("../../../../../lib/inference-client");

    const { POST } = await import("./route");
    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
    await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    const depsPassed = (runSearch as any).mock.calls[0][0];

    (classifyQueryImage as any).mockResolvedValue([
      { facet: "weather", labels: [{ name: "rain/storm", score: 0.81 }, { name: "cloudy/overcast", score: 0.12 }] },
    ]);
    await expect(depsPassed.classifyWeather("aaaa")).resolves.toEqual({ label: "rain/storm", score: 0.81 });

    (classifyQueryImage as any).mockRejectedValue(new Error("inference service down"));
    await expect(depsPassed.classifyWeather("aaaa")).resolves.toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run "app/api/models/[modelId]/estimate/route.test.ts"`
Expected: FAIL — `depsPassed.classifyWeather` is `undefined` in the first new test.

- [ ] **Step 3: Implement it**

In `apps/web/app/api/models/[modelId]/estimate/route.ts`, right after the existing `const timeOfDayModel = await findActiveModelForFacet(pool, "time_of_day");` line, add:

```ts
  const weatherModel = await findActiveModelForFacet(pool, "weather");
```

In the `deps` object literal, add a second spread alongside the existing `classifyTimeOfDay` one (after the `classifyTimeOfDay` spread block, still inside the same object literal):

```ts
    ...(weatherModel
      ? {
          classifyWeather: async (b64: string) => {
            try {
              const groups = await classifyQueryImage(b64, weatherModel.modelId, inferenceBaseUrl);
              const group = groups.find((g) => g.facet === "weather");
              const top = group?.labels[0];
              return top ? { label: top.name, score: top.score } : null;
            } catch {
              // Weather is decorative, not core — never fail the search
              // over a classify error (same rule as classifyTimeOfDay).
              return null;
            }
          },
        }
      : {}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run "app/api/models/[modelId]/estimate/route.test.ts"`
Expected: PASS, all tests (existing + 3 new).

- [ ] **Step 5: Run the full web test suite and typecheck**

Run: `cd apps/web && npx tsc --noEmit && npx vitest run`
Expected: no new failures beyond the two pre-existing, unrelated ones already known in this codebase (`lib/health.test.ts`'s two GPU-field assertions) and the possible flaky `app/api/health/logs/route.test.ts` case.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/api/models/[modelId]/estimate/route.ts" "apps/web/app/api/models/[modelId]/estimate/route.test.ts"
git commit -m "feat(web): classify weather during Pass 1 search when a model is active"
```

---

### Task 12: `useSearchStore.weather`

**Files:**
- Modify: `apps/web/app/stores/useSearchStore.ts`
- Modify: `apps/web/app/stores/useSearchStore.test.ts`

**Interfaces:**
- Consumes: `SearchResponse.weather` (Task 7).
- Produces: `useSearchStore` state field `weather: { label: string; score: number } | null` — Task 13 (`ResultsPanel.tsx`) reads this.

- [ ] **Step 1: Update the `RESPONSE` fixture (required for the file to even typecheck once `SearchResponse.weather` exists)**

In `apps/web/app/stores/useSearchStore.test.ts`, change:

```ts
const RESPONSE: SearchResponse = {
  searchId: "s1",
  regions: [
    { id: "r1", centroid: { lat: 37.3, lng: -121.9 }, radiusM: 150, aggregateScore: 0.83, candidateCount: 4 },
    { id: "r2", centroid: { lat: 37.5, lng: -122.3 }, radiusM: 150, aggregateScore: 0.68, candidateCount: 1 },
  ],
  candidatesByRegion: {
    r1: [
      { id: "c1", regionId: "r1", indexedImageId: "i1", panoId: "p1", heading: 0, lat: 37.3, lng: -121.9, similarityScore: 0.83, verificationScore: null, rank: 1, status: "unreviewed" },
    ],
  },
  timeOfDay: null,
};
```

to:

```ts
const RESPONSE: SearchResponse = {
  searchId: "s1",
  regions: [
    { id: "r1", centroid: { lat: 37.3, lng: -121.9 }, radiusM: 150, aggregateScore: 0.83, candidateCount: 4 },
    { id: "r2", centroid: { lat: 37.5, lng: -122.3 }, radiusM: 150, aggregateScore: 0.68, candidateCount: 1 },
  ],
  candidatesByRegion: {
    r1: [
      { id: "c1", regionId: "r1", indexedImageId: "i1", panoId: "p1", heading: 0, lat: 37.3, lng: -121.9, similarityScore: 0.83, verificationScore: null, rank: 1, status: "unreviewed" },
    ],
  },
  timeOfDay: null,
  weather: null,
};
```

- [ ] **Step 2: Write the failing test**

Add to the `describe("useSearchStore batchProgress", ...)` block (same block the existing `timeOfDay` test lives in):

```ts
  it("stores weather from the search response, and resets it on the next search", () => {
    useSearchStore.getState().setSearchResults(
      { ...RESPONSE, weather: { label: "rain/storm", score: 0.81 } },
      "IMG_1.jpg"
    );
    expect(useSearchStore.getState().weather).toEqual({ label: "rain/storm", score: 0.81 });

    useSearchStore.getState().setSearching("IMG_2.jpg");
    expect(useSearchStore.getState().weather).toBeNull();
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/stores/useSearchStore.test.ts`
Expected: FAIL — `useSearchStore.getState().weather` is `undefined`.

- [ ] **Step 4: Implement it**

In `apps/web/app/stores/useSearchStore.ts`, add to the `SearchState` interface (after `timeOfDay`):

```ts
  weather: { label: string; score: number } | null;
```

Add to `INITIAL` (after `timeOfDay`):

```ts
  weather: null as { label: string; score: number } | null,
```

In `setSearchResults`, change:

```ts
  setSearchResults: (res, queryImageName) => {
    const regions = [...res.regions].sort((a, b) => b.aggregateScore - a.aggregateScore);
    set({
      currentSearchId: res.searchId,
      queryImageName,
      regions,
      candidatesByRegion: res.candidatesByRegion,
      selectedRegionId: regions[0]?.id ?? null,
      refineStatus: "done",
      refineProgress: null,
      error: null,
      timeOfDay: res.timeOfDay,
    });
  },
```

to:

```ts
  setSearchResults: (res, queryImageName) => {
    const regions = [...res.regions].sort((a, b) => b.aggregateScore - a.aggregateScore);
    set({
      currentSearchId: res.searchId,
      queryImageName,
      regions,
      candidatesByRegion: res.candidatesByRegion,
      selectedRegionId: regions[0]?.id ?? null,
      refineStatus: "done",
      refineProgress: null,
      error: null,
      timeOfDay: res.timeOfDay,
      weather: res.weather,
    });
  },
```

(`setSearching`/`reset` already spread `INITIAL`, so `weather` resets to `null` automatically — no change needed to either, same as `timeOfDay`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/stores/useSearchStore.test.ts`
Expected: PASS, 8 tests (7 existing + 1 new).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/stores/useSearchStore.ts apps/web/app/stores/useSearchStore.test.ts
git commit -m "feat(web): store weather in useSearchStore"
```

---

### Task 13: connect `WeatherEstimateWidget.tsx` to real data

**Files:**
- Modify: `apps/web/app/components/widgets/WeatherEstimateWidget.tsx`
- Modify: `apps/web/app/components/ResultsPanel.tsx`

**Interfaces:**
- Consumes: `useSearchStore().weather` (Task 12), `spanishWeatherLabel` (Task 8).

No test file — matches this file's existing convention.

- [ ] **Step 1: Give `WeatherEstimateWidget` real props**

Replace the full content of `apps/web/app/components/widgets/WeatherEstimateWidget.tsx`:

```tsx
// apps/web/app/components/widgets/WeatherEstimateWidget.tsx
"use client";
import { InfoTooltip } from "../InfoTooltip";
import { spanishWeatherLabel } from "../../../lib/weather-label";

const WEATHER_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="9" cy="10" r="4" /><path d="M9 2v1.5M15.5 5l-1 1.3M2 10h1.5M4 5l1 1.3" /><path d="M5 18a4 4 0 0 1 4-4h6a3.5 3.5 0 0 1 0 7H8a3 3 0 0 1-3-3z" />
  </svg>
);
const LOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "jg-lock-breathe 2.6s ease-in-out infinite" }}>
    <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export function WeatherEstimateWidget({
  locked,
  weather,
  onInstall,
}: {
  locked: boolean;
  weather: { label: string; score: number } | null;
  onInstall: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className={locked ? "blur-[4px] opacity-50" : undefined}>
        <div className="mb-2.5 flex items-center gap-1.5">
          {WEATHER_ICON}
          <span className="flex-1 text-[10.5px] font-medium text-fg">Clima estimado</span>
          <InfoTooltip text="Clasificado a partir de la imagen (Wanda)" />
        </div>
        <div className="text-center text-[18px] font-semibold text-fg">
          {weather ? spanishWeatherLabel(weather.label) : "—"}
        </div>
        {weather && (
          <div className="mt-0.5 text-center text-[9.5px] text-muted">{Math.round(weather.score * 100)}% confianza</div>
        )}
      </div>
      {locked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0e0f11]/35">
          <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white/35">{LOCK_ICON}</div>
          <button
            onClick={onInstall}
            className="rounded-lg bg-accent px-2.5 py-1.5 text-[9.5px] font-medium text-black transition-transform hover:scale-105 active:scale-90"
          >
            Instalar Clima estimado
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire real data in `ResultsPanel.tsx`**

No new import is needed here — `spanishWeatherLabel` is called inside `WeatherEstimateWidget` itself (Step 1), not in `ResultsPanel.tsx`. `ResultsPanel.tsx` only needs to read `weather` from the store and pass it straight through as a prop.

Alongside the existing `const timeOfDay = useSearchStore((s) => s.timeOfDay);` line, add:

```ts
  const weather = useSearchStore((s) => s.weather);
```

Change the `weather` widget entry from:

```ts
    {
      id: "weather",
      title: "Clima estimado",
      icon: SEARCH_ICON,
      colSpan: 2,
      locked: true,
      defaultExpanded: false,
      render: () => <WeatherEstimateWidget onInstall={noop} />,
    },
```

to:

```ts
    {
      id: "weather",
      title: "Clima estimado",
      icon: SEARCH_ICON,
      colSpan: 2,
      locked: weather === null,
      defaultExpanded: weather !== null,
      render: () => <WeatherEstimateWidget locked={weather === null} weather={weather} onInstall={noop} />,
    },
```

- [ ] **Step 3: Manual verification**

With `wanda-v1` installed and active (already the case in this environment), run a real search and confirm: the "Clima estimado" widget is unlocked and shows the translated label (e.g. "Despejado") and a confidence percentage matching the real classification result. Deactivate/uninstall the classifier and run another search — confirm the widget falls back to locked with the same visual as before this change.

- [ ] **Step 4: Run the typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/widgets/WeatherEstimateWidget.tsx apps/web/app/components/ResultsPanel.tsx
git commit -m "feat(web): unlock Clima estimado widget with real weather data"
```

---

## Self-Review Notes

- **Spec coverage:** Feature D: migration + `reportBatchPhase` (Task 1), `RunSearchDeps.reportPhase` (Task 2), route wiring accepting `batchId` (Task 3), worker threading (Task 4), `GET .../batch/active` exposing `currentPhase` (Task 5), UI (Task 6). Feature C: `SearchResponse.weather` (Task 7), label translation (Task 8), `persistSearch` (Task 9), `RunSearchDeps.classifyWeather` (Task 10), route wiring (Task 11), store (Task 12), widget (Task 13). Every section of the spec has a task.
- **Non-goals respected:** no task adds per-image phase history (only the single in-flight `current_phase` per batch); `analyzeOne`'s `done`/`failed`/`status` counters are untouched by Task 4; `weather` is never written to any DB column (Task 9's docstring says so explicitly, mirroring `timeOfDay`); `DetectedObjectsWidget` is untouched.
- **Type consistency:** `{ label: string; score: number } | null` is the exact same shape for both `timeOfDay` and `weather` throughout — `SearchResponse` (Task 7), `PersistSearchArgs` (Task 9), `RunSearchDeps.classifyWeather`'s return type (Task 10), the estimate route's dep implementation (Task 11), `useSearchStore` (Task 12), and what `WeatherEstimateWidget` (Task 13) consumes. `"embedding" | "searching" | "saving"` is the exact same phase-string union in `RunSearchDeps.reportPhase` (Task 2), `reportBatchPhase` (Task 1), and the route's dep (Task 3) — no drift.
- **Task order:** Task 1 before Task 2 (needs `reportBatchPhase`); Task 2 before Task 3 (route needs the `reportPhase` dep type to exist); Task 3 before Task 4 (the route must accept `batchId` before the worker starts sending it, so a partial deploy degrades safely — worker sends `batchId`, route ignores an unrecognized-shape form field harmlessly either way, but implementing route-then-worker matches how the previous plan sequenced the equivalent time_of_day work: consumer-shape-first, producer-second); Task 5 depends on Task 1's migration (column must exist to `SELECT`); Task 6 depends on Task 5. Task 7 (shared type) before Tasks 9-13, mirroring exactly how the previous plan sequenced `timeOfDay`. Tasks 1-6 (Feature D) and Tasks 7-13 (Feature C) have no dependency on each other and could be done in either order or interleaved.
