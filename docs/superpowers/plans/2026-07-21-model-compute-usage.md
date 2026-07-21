# Model Compute Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track real inference compute time per model `kind` (retrieval / verification / classifier model_id) so a configurable $/hour rate per kind can produce an estimated cost, shown in a new Settings section.

**Architecture:** `services/inference/main.py` times just the model-invocation work in `/embed`, `/verify`, and `/models/{model_id}/classify` and returns `duration_ms` in each response. Four low-level TS HTTP client functions (2 in `apps/web`, 1 in `apps/web`, 1 in `apps/worker`) gain an extra `pool` parameter and record that duration into a new `model_usage` table (daily aggregate, keyed by `kind`) — fire-and-forget, never affecting the real result. A new `@netryx/model-usage` workspace package holds the recording/reading functions (mirrors `@netryx/api-usage`'s existing shape). A new Settings section reads a per-kind summary and lets the per-kind $/hour rate be edited.

**Tech Stack:** FastAPI/Python (services/inference), Next.js route handlers + Zustand-free plain React (apps/web), pg-boss worker (apps/worker), `pg` for Postgres, `node-pg-migrate` for schema.

## Global Constraints

- No tests in this plan — every task ends with implementation + a typecheck/import-check step + a commit. Do not write Vitest or pytest tests anywhere in this plan.
- Never change the existing return *type* of `embedImages`, `embedQueryImage`, `classifyQueryImage`, `verifyCandidates` as seen by their callers — only add a new trailing `pool` parameter. This is required so `apps/worker/src/jobs/index-area.ts` and `apps/worker/src/jobs/embed-pending-images.ts` (and their `Deps` interfaces) need zero changes.
- Recording usage must be fire-and-forget (`.catch(() => {})`) — a usage-tracking failure must never fail a real search/refine/embed/classify call.
- Commits use `git add <specific files>`, never `git add -A` or `git add .`.

---

### Task 1: `model_usage` / `model_usage_rates` migration

**Files:**
- Create: `db/migrations/1721600000000_model_usage.js`

**Interfaces:**
- Produces: tables `model_usage(id uuid pk, date date, kind text, call_count integer, total_duration_ms bigint, UNIQUE(date, kind))` and `model_usage_rates(kind text pk, rate_usd_per_hour numeric)` — every later task's SQL depends on these exact column names.

- [ ] **Step 1: Write the migration**

```js
// db/migrations/1721600000000_model_usage.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE model_usage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      kind TEXT NOT NULL,
      call_count INTEGER NOT NULL DEFAULT 0,
      total_duration_ms BIGINT NOT NULL DEFAULT 0,
      UNIQUE (date, kind)
    );
  `);
  pgm.sql(`
    CREATE TABLE model_usage_rates (
      kind TEXT PRIMARY KEY,
      rate_usd_per_hour NUMERIC NOT NULL DEFAULT 0
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE model_usage_rates;`);
  pgm.sql(`DROP TABLE model_usage;`);
};
```

- [ ] **Step 2: Run the migration**

```bash
cd /home/s7lver/Lumi/db && pnpm run migrate up
```

Expected: output ends with `> Migrating files:\n> 1721600000000_model_usage\n### MIGRATION 1721600000000_model_usage (UP) ###` and exit code 0.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/1721600000000_model_usage.js
git commit -m "feat(db): add model_usage and model_usage_rates tables"
```

---

### Task 2: `@netryx/model-usage` package

**Files:**
- Create: `packages/model-usage/package.json`
- Create: `packages/model-usage/tsconfig.json`
- Create: `packages/model-usage/src/index.ts`
- Create: `packages/model-usage/src/usage-repo.ts`

**Interfaces:**
- Consumes: the `model_usage` / `model_usage_rates` tables from Task 1.
- Produces: `recordModelUsage(pool: Pool, kind: string, durationMs: number): Promise<void>`, `getModelUsageSummary(pool: Pool): Promise<ModelUsageSummaryRow[]>` where `ModelUsageSummaryRow = { kind: string; totalCalls: number; totalDurationMs: number; rateUsdPerHour: number; estimatedCostUsd: number }`, `setModelUsageRate(pool: Pool, kind: string, rateUsdPerHour: number): Promise<void>` — every later task imports these three names from `@netryx/model-usage`.

- [ ] **Step 1: Write the package manifest**

```json
{
  "name": "@netryx/model-usage",
  "private": true,
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "pg": "^8.12.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.6",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 2: Write the tsconfig**

```json
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

- [ ] **Step 3: Write the repo functions**

```ts
// packages/model-usage/src/usage-repo.ts
import type { Pool } from "pg";

export interface ModelUsageSummaryRow {
  kind: string;
  totalCalls: number;
  totalDurationMs: number;
  rateUsdPerHour: number;
  estimatedCostUsd: number;
}

/**
 * Adds one call's duration to today's (date, kind) row, creating it if
 * absent — same daily-aggregate shape as packages/api-usage's
 * recordStreetViewUsage. Also ensures model_usage_rates has a row for
 * this kind (defaulting to a $0/hour rate) so the Settings UI can list
 * every kind ever seen without needing a hardcoded model list.
 */
export async function recordModelUsage(pool: Pool, kind: string, durationMs: number): Promise<void> {
  if (durationMs <= 0) return;
  await pool.query(
    `INSERT INTO model_usage (date, kind, call_count, total_duration_ms)
     VALUES (current_date, $1, 1, $2)
     ON CONFLICT (date, kind) DO UPDATE
       SET call_count = model_usage.call_count + 1,
           total_duration_ms = model_usage.total_duration_ms + $2`,
    [kind, Math.round(durationMs)]
  );
  await pool.query(
    `INSERT INTO model_usage_rates (kind, rate_usd_per_hour)
     VALUES ($1, 0)
     ON CONFLICT (kind) DO NOTHING`,
    [kind]
  );
}

/** All-time summary per kind, joined against its configured rate. */
export async function getModelUsageSummary(pool: Pool): Promise<ModelUsageSummaryRow[]> {
  const { rows } = await pool.query(
    `SELECT
       u.kind AS kind,
       SUM(u.call_count)::bigint AS total_calls,
       SUM(u.total_duration_ms)::bigint AS total_duration_ms,
       COALESCE(r.rate_usd_per_hour, 0) AS rate_usd_per_hour,
       (SUM(u.total_duration_ms)::numeric / 3600000) * COALESCE(r.rate_usd_per_hour, 0) AS estimated_cost_usd
     FROM model_usage u
     LEFT JOIN model_usage_rates r ON r.kind = u.kind
     GROUP BY u.kind, r.rate_usd_per_hour
     ORDER BY u.kind`
  );
  return rows.map((row) => ({
    kind: row.kind as string,
    totalCalls: Number(row.total_calls),
    totalDurationMs: Number(row.total_duration_ms),
    rateUsdPerHour: Number(row.rate_usd_per_hour),
    estimatedCostUsd: Number(row.estimated_cost_usd),
  }));
}

/** Upserts the $/hour rate for one kind (called from the Settings UI). */
export async function setModelUsageRate(pool: Pool, kind: string, rateUsdPerHour: number): Promise<void> {
  await pool.query(
    `INSERT INTO model_usage_rates (kind, rate_usd_per_hour)
     VALUES ($1, $2)
     ON CONFLICT (kind) DO UPDATE SET rate_usd_per_hour = $2`,
    [kind, rateUsdPerHour]
  );
}
```

- [ ] **Step 4: Write the barrel export**

```ts
// packages/model-usage/src/index.ts
export * from "./usage-repo";
```

- [ ] **Step 5: Register the package as a dependency**

Add `"@netryx/model-usage": "workspace:*"` to the `dependencies` object in both `apps/web/package.json` (alongside the existing `"@netryx/api-usage": "workspace:*"` line) and `apps/worker/package.json` (same).

- [ ] **Step 6: Install workspace links**

```bash
cd /home/s7lver/Lumi && pnpm install
```

Expected: exits 0, `node_modules/@netryx/model-usage` symlinks appear under `apps/web/node_modules/@netryx/` and `apps/worker/node_modules/@netryx/`.

- [ ] **Step 7: Typecheck the new package**

```bash
cd /home/s7lver/Lumi/packages/model-usage && npx tsc --noEmit
```

Expected: no output, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add packages/model-usage apps/web/package.json apps/worker/package.json pnpm-lock.yaml
git commit -m "feat(model-usage): add @netryx/model-usage package for per-kind compute tracking"
```

---

### Task 3: Time model invocations in `services/inference/main.py`

**Files:**
- Modify: `services/inference/main.py` (response models around lines 99-141, and the `embed`/`verify`/`classify` endpoint bodies around lines 351-445)

**Interfaces:**
- Consumes: nothing new.
- Produces: `EmbedResponse`, `VerifyResponse`, `ClassifyResponse` each gain a `duration_ms: float` field — every TS client function in Task 4 reads `body.duration_ms` from these three endpoints' JSON.

- [ ] **Step 1: Add `duration_ms` to the three response models**

```python
class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    duration_ms: float
```

```python
class VerifyResponse(BaseModel):
    results: list[VerifyResult]
    duration_ms: float
```

```python
class ClassifyResponse(BaseModel):
    groups: list[ClassifyGroup]
    duration_ms: float
```

- [ ] **Step 2: Time `embed()`'s model-invocation work**

Replace the whole `embed` function body with:

```python
@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest, model=Depends(get_retrieval_model)) -> EmbedResponse:
    if len(request.images_base64) == 0:
        raise HTTPException(status_code=400, detail="images_base64 must not be empty")

    images = [_decode_image(img) for img in request.images_base64]
    start = time.perf_counter()

    try:
        if request.augment:
            embeddings = []
            for img in images:
                variants = augment_variants(img)
                raw_vectors = _run_model(model, variants)
                embeddings.append(mean_normalize(raw_vectors).tolist())
            return EmbedResponse(embeddings=embeddings, duration_ms=(time.perf_counter() - start) * 1000)

        raw_vectors = _run_model(model, images)
    except torch.cuda.OutOfMemoryError as exc:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        raise HTTPException(status_code=503, detail=_OOM_INFERENCE_MESSAGE) from exc

    embeddings = []
    for vec in raw_vectors:
        vec = np.asarray(vec, dtype=np.float64)
        norm = np.linalg.norm(vec)
        normalized = vec / norm if norm > 0 else vec
        embeddings.append(normalized.tolist())
    return EmbedResponse(embeddings=embeddings, duration_ms=(time.perf_counter() - start) * 1000)
```

- [ ] **Step 3: Report `verify()`'s existing timer as `duration_ms`**

`verify()` already computes `request_start = time.perf_counter()` right before its loop and prints elapsed time at the end. Change only its final two lines from:

```python
    print(f"[verify] request completa: {total} candidatos en {time.perf_counter() - request_start:.2f}s")
    return VerifyResponse(results=results)
```

to:

```python
    total_elapsed_ms = (time.perf_counter() - request_start) * 1000
    print(f"[verify] request completa: {total} candidatos en {total_elapsed_ms / 1000:.2f}s")
    return VerifyResponse(results=results, duration_ms=total_elapsed_ms)
```

- [ ] **Step 4: Time `classify()`'s model-invocation work**

Replace the whole `classify` function body with:

```python
@app.post("/models/{model_id}/classify", response_model=ClassifyResponse)
def classify(model_id: str, request: ClassifyRequest) -> ClassifyResponse:
    conn = _connect_db()
    try:
        active_models = get_active_classification_models(conn)
    finally:
        conn.close()
    if model_id not in active_models:
        raise HTTPException(status_code=404, detail=f"Unknown or inactive classification model id: {model_id}")

    image = _decode_image(request.image_base64)
    classifier = _ensure_active_model(model_id)  # OOM during load already raises 503 inside _ensure_active_model
    start = time.perf_counter()
    try:
        groups = classifier.classify(image)
    except torch.cuda.OutOfMemoryError as exc:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        raise HTTPException(status_code=503, detail=_OOM_INFERENCE_MESSAGE) from exc
    duration_ms = (time.perf_counter() - start) * 1000

    return ClassifyResponse(
        groups=[ClassifyGroup(facet=g["facet"], labels=[ClassifyLabel(**l) for l in g["labels"]]) for g in groups],
        duration_ms=duration_ms,
    )
```

- [ ] **Step 5: Verify the file still imports cleanly**

```bash
cd /home/s7lver/Lumi/services/inference && venv/bin/python -c "import main"
```

Expected: no output, exit code 0 (a syntax or NameError would print a traceback here).

- [ ] **Step 6: Commit**

```bash
git add services/inference/main.py
git commit -m "feat(inference): report model-invocation duration_ms from /embed, /verify, /classify"
```

---

### Task 4: Extend the 4 TS inference clients to record usage

**Files:**
- Modify: `apps/web/lib/inference-client.ts`
- Modify: `apps/web/lib/verify-client.ts`
- Modify: `apps/worker/src/inference-client.ts`

**Interfaces:**
- Consumes: `recordModelUsage` from `@netryx/model-usage` (Task 2); `duration_ms` field from Task 3's responses.
- Produces: `embedQueryImage(imageBase64, inferenceBaseUrl, pool)`, `classifyQueryImage(imageBase64, modelId, inferenceBaseUrl, pool)`, `verifyCandidates(queryBase64, candidateBase64, inferenceBaseUrl, pool)`, `embedImages(imagesBase64, inferenceBaseUrl, pool)` — each keeps its existing return type, adds a trailing `pool: Pool` parameter. Task 5 wires real `pool` values into these new parameters.

- [ ] **Step 1: Rewrite `apps/web/lib/inference-client.ts`**

```ts
// apps/web/lib/inference-client.ts
import type { Pool } from "pg";
import { recordModelUsage } from "@netryx/model-usage";

/** Embeds a single query image with Lumi Preview TTA on (spec §15.1). */
export async function embedQueryImage(
  imageBase64: string,
  inferenceBaseUrl: string,
  pool: Pool
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

  const body = (await res.json()) as { embeddings: number[][]; duration_ms: number };
  recordModelUsage(pool, "retrieval", body.duration_ms).catch(() => {});
  return body.embeddings[0];
}

export interface ClassifyLabel {
  name: string;
  score: number;
}

export interface ClassifyGroup {
  facet: string;
  labels: ClassifyLabel[];
}

/** Runs one installed generic-classifier model's facets against a single
 * image (spec: docs/superpowers/specs/2026-07-21-results-layout-and-time-
 * of-day-design.md). Labels within each group are already sorted
 * descending by score by the inference service. */
export async function classifyQueryImage(
  imageBase64: string,
  modelId: string,
  inferenceBaseUrl: string,
  pool: Pool
): Promise<ClassifyGroup[]> {
  const res = await fetch(`${inferenceBaseUrl}/models/${modelId}/classify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64 }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Inference service /models/${modelId}/classify failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { groups: ClassifyGroup[]; duration_ms: number };
  recordModelUsage(pool, modelId, body.duration_ms).catch(() => {});
  return body.groups;
}
```

- [ ] **Step 2: Rewrite `apps/web/lib/verify-client.ts`**

```ts
// apps/web/lib/verify-client.ts
import type { Pool } from "pg";
import { recordModelUsage } from "@netryx/model-usage";

export interface VerifyResult {
  inliers: number;
  reprojError: number;
  score: number;
}

/** Calls the inference /verify endpoint (RoMa-based geometric verification) for one query vs. many candidates. */
export async function verifyCandidates(
  queryBase64: string,
  candidateBase64: string[],
  inferenceBaseUrl: string,
  pool: Pool
): Promise<VerifyResult[]> {
  const res = await fetch(`${inferenceBaseUrl}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query_image_base64: queryBase64,
      candidate_images_base64: candidateBase64,
    }),
    // RoMa (dense pairwise matching) is slow but bounded per single candidate
    // (run-refine.ts sends one at a time) — this is a safety net against a
    // genuinely stuck request (e.g. the inference process crashed but the
    // connection never closed), not a performance target. If this actually
    // fires, run-refine.ts's own retry-then-fall-back-to-unscored handling
    // (not a page reload) is what recovers the rest of the batch.
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Inference service /verify failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as {
    results: { inliers: number; reproj_error: number; score: number }[];
    duration_ms: number;
  };
  recordModelUsage(pool, "verification", body.duration_ms).catch(() => {});
  return body.results.map((r) => ({
    inliers: r.inliers,
    reprojError: r.reproj_error,
    score: r.score,
  }));
}
```

- [ ] **Step 3: Rewrite `apps/worker/src/inference-client.ts`**

```ts
// apps/worker/src/inference-client.ts
import type { Pool } from "pg";
import { recordModelUsage } from "@netryx/model-usage";

export async function embedImages(
  imagesBase64: string[],
  inferenceBaseUrl: string,
  pool: Pool
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

  const body = (await res.json()) as { embeddings: number[][]; duration_ms: number };
  recordModelUsage(pool, "retrieval", body.duration_ms).catch(() => {});
  return body.embeddings;
}
```

- [ ] **Step 4: Typecheck both packages**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
```

Expected: this WILL currently fail with "Expected 3-4 arguments, but got 2" at every existing call site of these four functions — that's expected and gets fixed in Task 5. Confirm the errors are only at call sites (not inside the files just edited), then proceed to Task 5 before committing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/inference-client.ts apps/web/lib/verify-client.ts apps/worker/src/inference-client.ts
git commit -m "feat(inference-clients): accept a pool param and record model usage per call"
```

---

### Task 5: Wire `pool` through at every real call site

**Files:**
- Modify: `apps/web/app/api/models/[modelId]/estimate/route.ts`
- Modify: `apps/web/app/api/models/[modelId]/refine/route.ts`
- Modify: `apps/web/app/api/model-catalog/publish/route.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: the 4 functions' new `pool` parameter from Task 4.
- Produces: nothing new — this task only threads an already-in-scope `pool` variable through to existing call sites, fixing the typecheck failures left by Task 4.

- [ ] **Step 1: `apps/web/app/api/models/[modelId]/estimate/route.ts`**

Change:

```ts
    embedQuery: (b64) => embedQueryImage(b64, inferenceBaseUrl),
```

to:

```ts
    embedQuery: (b64) => embedQueryImage(b64, inferenceBaseUrl, pool),
```

Change both:

```ts
              const groups = await classifyQueryImage(b64, timeOfDayModel.modelId, inferenceBaseUrl);
```

and:

```ts
              const groups = await classifyQueryImage(b64, weatherModel.modelId, inferenceBaseUrl);
```

to:

```ts
              const groups = await classifyQueryImage(b64, timeOfDayModel.modelId, inferenceBaseUrl, pool);
```

and:

```ts
              const groups = await classifyQueryImage(b64, weatherModel.modelId, inferenceBaseUrl, pool);
```

respectively (`pool` is already declared a few lines above via `const pool = getPool();`, in scope at both call sites).

- [ ] **Step 2: `apps/web/app/api/models/[modelId]/refine/route.ts`**

Change:

```ts
        verify: (q, cands) => verifyCandidates(q, cands, inferenceBaseUrl),
```

to:

```ts
        verify: (q, cands) => verifyCandidates(q, cands, inferenceBaseUrl, pool),
```

(`pool` is already declared above via `const pool = getPool();`.)

- [ ] **Step 3: `apps/web/app/api/model-catalog/publish/route.ts`**

Change:

```ts
        embedQuery: (imageBase64) => embedQueryImage(imageBase64, inferenceBaseUrl),
```

to:

```ts
        embedQuery: (imageBase64) => embedQueryImage(imageBase64, inferenceBaseUrl, pool),
```

Change:

```ts
        await verifyCandidates(queryBase64, [candidateBase64], inferenceBaseUrl);
```

to:

```ts
        await verifyCandidates(queryBase64, [candidateBase64], inferenceBaseUrl, pool);
```

(`pool` is already declared above via `const pool = getPool();`.)

- [ ] **Step 4: `apps/worker/src/index.ts`**

Change the first occurrence (inside the `INDEX_AREA_JOB_NAME` handler) of:

```ts
      embedImages,
```

to:

```ts
      embedImages: (base64s, url) => embedImages(base64s, url, pool),
```

Change the second occurrence (inside the `EMBED_PENDING_IMAGES_JOB_NAME` handler) of the same line the same way. (`pool` is already declared near the top of `main()` via `const pool = getPool();`, in scope in both handlers.)

- [ ] **Step 5: Typecheck both packages**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
```

Expected: no errors in either.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/models/\[modelId\]/estimate/route.ts apps/web/app/api/models/\[modelId\]/refine/route.ts apps/web/app/api/model-catalog/publish/route.ts apps/worker/src/index.ts
git commit -m "feat(web,worker): pass pool through to inference clients so usage gets recorded"
```

---

### Task 6: Settings API routes for reading/editing model usage

**Files:**
- Create: `apps/web/app/api/settings/model-usage/route.ts`
- Create: `apps/web/app/api/settings/model-usage/rate/route.ts`

**Interfaces:**
- Consumes: `getModelUsageSummary`, `setModelUsageRate` from `@netryx/model-usage` (Task 2).
- Produces: `GET /api/settings/model-usage` → `ModelUsageSummaryRow[]` JSON; `PATCH /api/settings/model-usage/rate` (body `{ kind: string; rateUsdPerHour: number }`) → `{ ok: true }` — Task 7's UI calls both.

- [ ] **Step 1: Write the summary route**

```ts
// apps/web/app/api/settings/model-usage/route.ts
import { NextResponse } from "next/server";
import { getModelUsageSummary } from "@netryx/model-usage";
import { getPool } from "../../../../lib/db";

export async function GET() {
  const pool = getPool();
  const summary = await getModelUsageSummary(pool);
  return NextResponse.json(summary);
}
```

- [ ] **Step 2: Write the rate-update route**

```ts
// apps/web/app/api/settings/model-usage/rate/route.ts
import { NextResponse } from "next/server";
import { setModelUsageRate } from "@netryx/model-usage";
import { getPool } from "../../../../../lib/db";

export async function PATCH(request: Request) {
  let body: { kind?: unknown; rateUsdPerHour?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON no válido" }, { status: 400 });
  }

  if (typeof body.kind !== "string" || body.kind.length === 0) {
    return NextResponse.json({ error: "kind es obligatorio" }, { status: 400 });
  }
  if (typeof body.rateUsdPerHour !== "number" || !Number.isFinite(body.rateUsdPerHour) || body.rateUsdPerHour < 0) {
    return NextResponse.json({ error: "rateUsdPerHour debe ser un número >= 0" }, { status: 400 });
  }

  const pool = getPool();
  await setModelUsageRate(pool, body.kind, body.rateUsdPerHour);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/settings/model-usage/route.ts apps/web/app/api/settings/model-usage/rate/route.ts
git commit -m "feat(web): add GET/PATCH routes for model usage summary and rates"
```

---

### Task 7: Settings UI section

**Files:**
- Create: `apps/web/app/components/ModelUsageSection.tsx`
- Modify: `apps/web/app/settings/page.tsx`

**Interfaces:**
- Consumes: `GET /api/settings/model-usage`, `PATCH /api/settings/model-usage/rate` (Task 6).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/ModelUsageSection.tsx
"use client";
import { useEffect, useState } from "react";

interface ModelUsageRow {
  kind: string;
  totalCalls: number;
  totalDurationMs: number;
  rateUsdPerHour: number;
  estimatedCostUsd: number;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function ModelUsageSection() {
  const [rows, setRows] = useState<ModelUsageRow[] | null>(null);

  function load() {
    fetch("/api/settings/model-usage")
      .then((res) => res.json())
      .then(setRows)
      .catch(() => setRows([]));
  }

  useEffect(() => {
    load();
  }, []);

  async function updateRate(kind: string, rateUsdPerHour: number) {
    await fetch("/api/settings/model-usage/rate", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, rateUsdPerHour }),
    });
    load();
  }

  if (rows === null) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-sm font-medium text-fg">Consumo de cómputo por modelo</h2>
      {rows.length === 0 ? (
        <div className="text-xs text-muted">Todavía no se ha registrado ninguna llamada a un modelo.</div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-subtle">
              <th className="pb-2">Modelo</th>
              <th className="pb-2">Llamadas</th>
              <th className="pb-2">Tiempo total</th>
              <th className="pb-2">Tarifa ($/hora)</th>
              <th className="pb-2">Costo estimado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.kind} className="border-t border-border">
                <td className="py-2 font-mono text-fg">{row.kind}</td>
                <td className="py-2 text-fg">{row.totalCalls}</td>
                <td className="py-2 text-fg">{formatDuration(row.totalDurationMs)}</td>
                <td className="py-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={row.rateUsdPerHour}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (Number.isFinite(value) && value >= 0) updateRate(row.kind, value);
                    }}
                    className="w-20 rounded border border-border bg-transparent px-1.5 py-0.5 text-fg"
                  />
                </td>
                <td className="py-2 text-fg">${row.estimatedCostUsd.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Mount it in the Settings page**

```tsx
// apps/web/app/settings/page.tsx
import { SettingsPanel } from "../components/SettingsPanel";
import { ModelUsageSection } from "../components/ModelUsageSection";

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-[1100px] p-8">
      <h1 className="mb-6 text-lg font-medium text-fg">Configuración</h1>
      <SettingsPanel />
      <ModelUsageSection />
    </main>
  );
}
```

- [ ] **Step 3: Typecheck and build**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit && npx next build
```

Expected: both succeed with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/ModelUsageSection.tsx apps/web/app/settings/page.tsx
git commit -m "feat(web): show per-model compute usage and editable rates in Settings"
```
