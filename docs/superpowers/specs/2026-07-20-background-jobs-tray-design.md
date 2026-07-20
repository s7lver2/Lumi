# Background jobs tray — design spec

Status: approved (design phase) — implementation not started.

## Context

Three long-running client actions currently track their progress in
component-local React state, with no server-side record of "this is still
running":

- `POST /api/datasets/install` (`DatasetsSection.tsx`) — runs synchronously
  inline in the request handler (download release, decrypt, unzip, write
  images, insert `areas`/`indexed_images` rows) and shows progress via a
  plain `status` string in the component.
- `POST /api/model-catalog/install` / `.../uninstall` (`ModelosSection.tsx`)
  — for `code-bundle` releases this is a multi-step process (backup
  `services/inference`, copy new code over it, restart the inference
  service, poll for readiness, roll back on failure); for
  `generic-classifier` releases it's a single metadata-only DB write.
  Progress shows via `ModelLoadNotification`, driven by local
  `installing`/`uninstalling` booleans.
- Search batches (`POST /api/search/batch`, `SearchDashboard.tsx`) are the
  one exception that's *already* durable — `search_batches` has
  `status`/`total`/`done`/`failed`/`result_json` columns and a dedicated SSE
  endpoint (`GET /api/search/batch/:id/progress`). The only missing piece is
  that the client has no way to learn a batch id exists after a reload.

Confirmed live: reloading the page or navigating away mid-install aborts the
browser's `fetch`, and the component holding the local `status`/`installing`
state unmounts — so the notification just disappears with no way to tell if
the operation actually finished. For dataset/model installs, the server was
never asked to keep going in a form the client could reconnect to.

## Goals

- A new `background_jobs` table becomes the durable source of truth for
  dataset installs and model install/uninstall.
- Those three routes return `202 { jobId }` immediately (validation errors
  still return synchronously) and do the actual work as a detached
  server-side task that updates the job row as it goes.
- A single persistent notification tray, mounted in `AppShell` (outside any
  route's page tree), recovers all active work on mount by querying the
  server — no client-side persistence (localStorage) needed, since the
  server already durably knows what's running.
- Search batches gain one recovery endpoint so the tray can reconnect to an
  in-flight batch after a reload; their existing table/SSE mechanism is
  otherwise unchanged.

## Non-goals

- Area indexing (`useIndexingStore`/`JobProgressBar`, driven by pg-boss's
  `INDEX_AREA_JOB_NAME`) has the same reload-loses-state gap — `activeJobId`
  is plain in-memory zustand state with no recovery-on-mount. It is a strong
  candidate for a follow-up migration onto this same tray, but is out of
  scope here: this spec covers only the three operations the user asked
  about (dataset install, model install, model uninstall), plus the
  already-partially-durable search batch case.
- No change to how any of the underlying operations work (GitHub download,
  decrypt, unzip, inference restart, classifier metadata write) — only how
  their progress is tracked and surfaced.
- No retry/cancel UI for background jobs. A failed job shows its error in
  the tray; retrying means clicking Instalar again.
- `ModelLoadNotification`'s other call sites (`SearchDashboard.tsx`'s
  searching/refining state, `JobProgressBar.tsx`'s "awaiting first
  progress" state, `ResetConfirmDialog.tsx`'s resetting state) are
  unaffected — those track live, single-page-lifetime activity, not
  something that needs to survive navigation away.

## Data model

New migration, `db/migrations/1721300000000_background_jobs.js`:

```sql
CREATE TABLE background_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,        -- 'dataset-install' | 'model-install' | 'model-uninstall'
  label         text NOT NULL,        -- human-readable, e.g. "Wanda v1.0"
  status        text NOT NULL DEFAULT 'running',  -- 'running' | 'done' | 'failed'
  error         text,
  result        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

`background_jobs` is added to `APPLICATION_TABLES`
(`apps/web/lib/settings/db-backup.ts`) so a factory reset backs it up and
truncates it like every other application table.

## Server: job helper

New `apps/web/lib/background-jobs.ts`:

```ts
export interface BackgroundJob {
  id: string;
  kind: "dataset-install" | "model-install" | "model-uninstall";
  label: string;
  status: "running" | "done" | "failed";
  error: string | null;
  result: unknown | null;
  createdAt: string;
  updatedAt: string;
}

export async function createJob(pool: Pool, kind: BackgroundJob["kind"], label: string): Promise<string>;
export async function completeJob(pool: Pool, id: string, result: unknown): Promise<void>;
export async function failJob(pool: Pool, id: string, error: string): Promise<void>;
export async function getJob(pool: Pool, id: string): Promise<BackgroundJob | null>;
export async function listActiveJobs(pool: Pool): Promise<BackgroundJob[]>;
```

`listActiveJobs` selects `status = 'running' OR updated_at > now() - interval '15 seconds'`
— this is what lets a job that finishes right as the page reloads still show
its outcome once, without needing a separate "dismissed" flag.

## Server: route changes

Each route keeps its existing validation and error-shape for problems it can
detect synchronously (missing fields, release/model not found, malformed
manifest) — those still return a 4xx immediately, no job is created. Once
validation passes and the route is about to start the actual work, it
instead:

1. Calls `createJob(pool, kind, label)`.
2. Fires the existing logic (already-written function body, unchanged)
   as a detached `void doWork().catch(...)` — not awaited by the handler.
3. Returns `NextResponse.json({ jobId }, { status: 202 })` immediately.

Inside the detached task: on success, call `completeJob(pool, id, result)`
with the same JSON shape the route used to return synchronously (e.g.
`{ ok: true, version: manifest.version }`) so the tray/frontend can reuse
existing result-handling code. On any thrown error, call `failJob(pool, id, message)`
using the same error-message extraction each route already does
(`err instanceof Error ? err.message : String(err)`).

This relies on the Node process staying alive after the response is sent —
true here because the app runs as a long-lived `next start` process (dist
packaging), the same assumption the existing SSE progress loops
(`GET /api/search/batch/:id/progress`) already make.

Affected routes:
- `apps/web/app/api/datasets/install/route.ts` — `kind: "dataset-install"`,
  label from the release tag (e.g. `owner/repo@tag`).
- `apps/web/app/api/model-catalog/install/route.ts` — `kind: "model-install"`,
  label from `manifest.modelId ?? "Lumi Preview"` + version.
- `apps/web/app/api/model-catalog/uninstall/route.ts` — `kind: "model-uninstall"`,
  same label convention.

## Server: new endpoints

- `GET /api/jobs?active=true` → `{ jobs: BackgroundJob[] }`, via
  `listActiveJobs`.
- `GET /api/jobs/:id` → single `BackgroundJob`, 404 if not found. Used for
  polling a job the tray is already tracking.
- `GET /api/search/batch/active` → the most recent `search_batches` row
  with `status IN ('pending', 'running')`, or `{ batch: null }`. Lets the
  tray recover an in-flight batch id after reload; the existing
  `GET /api/search/batch/:id/progress` SSE endpoint handles everything
  after that.

## Client: tray

New `apps/web/app/components/BackgroundJobsTray.tsx`, mounted once in
`AppShell.tsx` alongside existing children (so it survives route
navigation — `AppShell` wraps every route, only `main`'s children swap).

- On mount: `GET /api/jobs?active=true` and `GET /api/search/batch/active`,
  seed local state with whatever comes back.
- Exposes a `registerJob(jobId)` function (via a small module-level
  event emitter or a zustand store, matching the existing
  `useIndexingStore` pattern) that `ModelosSection.tsx`/`DatasetsSection.tsx`
  call immediately after their install/uninstall `fetch` resolves with a
  `jobId`, so a freshly started job appears without waiting for the next
  poll tick.
- Polls every job it knows about (both kinds) every ~1s via
  `GET /api/jobs/:id` (or the batch's own SSE endpoint for search batches)
  until terminal.
- Renders one card per active/recently-terminal job, stacked bottom-right,
  visually matching the existing `ModelLoadNotification` card (small
  spinner shimmer bar while running, checkmark/error icon once terminal).
  Terminal cards get a ✕ dismiss button (matching the existing error toast
  in `SearchDashboard.tsx`); running cards don't need one.

## Client: call-site changes

- `ModelosSection.tsx`: `install()`/`uninstall()` drop their local
  `installing`/`uninstalling`/`status` state and the `ModelLoadNotification`
  render. On the `fetch` resolving with `{ jobId }`, call
  `registerJob(jobId)` and nothing else — no more local polling, no more
  `refreshCatalog()` call from these functions directly. Instead, the tray
  (or a small hook watching a specific job id) triggers `refreshCatalog()`
  once that job reaches `status: 'done'`, so the catalog view still updates
  itself correctly (this is the fix from the previous session, now driven
  by job completion instead of the fetch's own resolution).
- `DatasetsSection.tsx`: same shape — drop the local `status` string, call
  `registerJob(jobId)`, refetch its own list on job completion.

## Error handling

- Synchronous validation errors (bad owner/repo/tag, release not found,
  manifest missing expected assets) are unchanged — same 4xx response,
  same shape, no job involved.
- Errors that only surface mid-work (GitHub download failure, corrupt zip,
  inference service failing to come back up, DB constraint violation) are
  caught in the detached task and written to the job's `error` field via
  `failJob`, then shown in the tray as a failed card with that message.
- If the Node process itself restarts mid-job (crash, manual restart), the
  job row is left permanently `status: 'running'` with no further updates.
  The tray's `listActiveJobs` query still returns it, so it would show as
  perpetually running until the user reloads far enough later that its
  `updated_at` falls outside recovery — this is a known limitation, not
  solved by this spec (matches the existing behavior of `search_batches`
  and pg-boss jobs, which have the same failure mode today).

## Testing

- `background-jobs.ts`: unit tests for `createJob`/`completeJob`/`failJob`/
  `getJob`/`listActiveJobs` against a mocked `pg` pool, following the exact
  mock-pool pattern in `classification-models.test.ts`.
- Route tests (`route.test.ts` for all three affected routes): update
  existing tests to assert `202 { jobId }` instead of the old synchronous
  response shape, and add a test that the detached task's eventual
  `completeJob`/`failJob` call carries the same result/error shape the old
  synchronous response used to return.
- `BackgroundJobsTray.tsx` and the `ModelosSection.tsx`/`DatasetsSection.tsx`
  rewrites get manual verification only, matching this codebase's existing
  convention for UI-heavy components with no pure-function core (no test
  file for `ModelLoadNotification.tsx` or the pre-existing
  `ModelosSection.tsx` either).
