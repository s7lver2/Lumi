# Model Compute Usage — Design

## Goal

Track real compute time (not tokens — these are vision models, not LLMs) spent by every AI model Lumi runs, so a configurable per-model $/hour rate can turn that time into an estimated cost. This is deliberately separate from the existing `api_usage` table (Google Street View request costs) — different domain, different lifecycle, not merged.

## Why this works without hardcoding a model list

`services/inference/main.py` already has a single identifier that names every model call: `kind`. It's `"retrieval"` for the embedding model, `"verification"` for the RoMa geometric verifier, or a classification `model_id` (e.g. `"wanda-v1"`) for anything routed through `/models/{model_id}/classify`. Any classification model installed in the future automatically gets its own `kind` with zero code changes — the catalog is already DB-backed (`installed_classification_models`). This design keys everything off that same string.

## Where time is measured

`services/inference` (Python) is the only place that knows real inference time excluding model load (loading already happens before the handler body runs, via `Depends(...)` for retrieval/verification, or via `_ensure_active_model(model_id)` at the top of `classify()`). Each of the three endpoints starts a `time.perf_counter()` timer around just the model-invocation work and returns `duration_ms` in its JSON response:

- `/embed` — wrap the `_run_model(...)` + normalization work (both the `augment` and non-`augment` branches).
- `/verify` — reuse the `request_start` timer that already exists (added for the existing `[verify]` log lines); expose it as `duration_ms` on `VerifyResponse` instead of only printing it.
- `/models/{model_id}/classify` — wrap the `classifier.classify(image)` call.

`EmbedResponse`, `VerifyResponse`, and `ClassifyResponse` each gain a `duration_ms: float` field.

## Where it's stored

Two new tables, migrated via `db/migrations/`:

```sql
CREATE TABLE model_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  kind TEXT NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms BIGINT NOT NULL DEFAULT 0,
  UNIQUE (date, kind)
);

CREATE TABLE model_usage_rates (
  kind TEXT PRIMARY KEY,
  rate_usd_per_hour NUMERIC NOT NULL DEFAULT 0
);
```

`model_usage` mirrors `api_usage`'s own shape (one row per day, `UNIQUE (date, kind)`, incremented via `INSERT ... ON CONFLICT DO UPDATE`) — same pattern, different key (`kind` instead of nothing, since this table tracks multiple distinct things per day instead of one global counter). `model_usage_rates` holds one editable row per `kind` ever seen; rows are created on demand (upsert with a default of 0) the first time that `kind` is recorded, so the rates table's row set always matches what's actually been used — no need to pre-seed it with a fixed model list.

## Where it's read/written from

A new shared workspace package, `packages/model-usage` (mirrors `packages/api-usage`'s structure exactly — same kind of thin repo module, both `apps/web` and `apps/worker` depend on it):

- `recordModelUsage(pool, kind, durationMs): Promise<void>` — the upsert into `model_usage`.
- `getModelUsageSummary(pool): Promise<Array<{ kind, totalCalls, totalDurationMs, rateUsdPerHour, estimatedCostUsd }>>` — joins `model_usage` (summed across all dates) against `model_usage_rates` (left join, default rate 0), computes `estimatedCostUsd = (totalDurationMs / 3_600_000) * rateUsdPerHour`.
- `setModelUsageRate(pool, kind, rateUsdPerHour): Promise<void>` — upsert into `model_usage_rates`.

Call sites that read `duration_ms` off an inference response and call `recordModelUsage`:

- `apps/worker/src/inference-client.ts`'s `embedImages` → `kind: "retrieval"`.
- `apps/web/lib/inference-client.ts`'s `embedQueryImage` → `kind: "retrieval"`; `classifyQueryImage` → `kind: modelId`.
- `apps/web/lib/verify-client.ts`'s `verifyCandidates` → `kind: "verification"`.

Each of these already returns a parsed value to its caller today (an embeddings array, classify groups, or verify results) — each becomes `Promise<{ ...existing shape, durationMs: number }>` so the caller decides whether/how to record it, rather than the client function reaching into a DB pool itself (these are shared low-level HTTP clients; `apps/worker`'s and `apps/web`'s pools are different instances). The actual `recordModelUsage` call happens one level up, at each function's real call sites (worker's embed-pending-images job, web's `run-search.ts`/`run-refine.ts` orchestration), where a `pool` is already in scope. Recording is fire-and-forget (`.catch(() => {})`), same "decorative, never blocks the real work" principle already used for classification failures — a usage-tracking hiccup must never fail a real search.

## UI

New section in Settings (`apps/settings` route — same page that already configures `MAX_MONTHLY_BUDGET_USD` etc.): a table listing every `kind` from `getModelUsageSummary`, columns for total calls, total time (formatted as h/m/s), rate ($/hour, editable number input, `PATCH`es a new `/api/settings/model-usage-rates` route calling `setModelUsageRate`), and estimated cost. A `GET /api/settings/model-usage` route backs the table (calls `getModelUsageSummary`).

## Out of scope (deliberately)

- Per-facet breakdown within one classify call (a single `/models/{id}/classify` call can return multiple facet groups in one timed call — tracked as one `kind` entry, not split per facet).
- Per-call logging (only daily aggregates, per the "por día y modelo" choice).
- Retroactive backfill of historical usage before this ships — starts counting from zero going forward.
