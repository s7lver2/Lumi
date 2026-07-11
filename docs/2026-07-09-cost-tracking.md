# Cost Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the system enforce its own Street View spend: record every successful Street View image request in `api_usage`, block any indexing job whose projected cost would push the month over `MAX_MONTHLY_BUDGET_USD`, and surface the running monthly spend vs. budget in the UI (spec §12).

**Architecture:** A shared `@netryx/api-usage` package holds the pure budget guard plus two DB helpers (`recordStreetViewUsage` upsert-by-date, `getMonthlySpendUsd` month-to-date sum), so both `apps/worker` (authoritative enforcement + recording, spec §12.2/§12.3) and `apps/web` (reject-before-enqueue for fast feedback, plus a `GET /api/usage` the `/index` panel reads) share one implementation. The worker checks the budget after street sampling (when the projected cost is known) and before any paid download, then records `captures.length` successful requests once the downloads succeed. `areas.actual_cost_usd` is already written by the indexing job — this plan adds the cross-area `api_usage` ledger the per-area figure never covered.

**Tech Stack:** TypeScript, Postgres (`api_usage` table from Foundation), pg, vitest.

**Depends on:** Foundation (`api_usage` table, `system_settings`, `MAX_MONTHLY_BUDGET_USD`/`STREET_VIEW_PRICE_PER_IMAGE_USD` settings) and Indexing Pipeline (worker `runIndexAreaJob`, `POST /api/areas`) — merged. Independent of the Dashboard/Search UI plans (touches only the `/index` estimate panel, which the Dashboard Part 1 plan owns — see the note in Task 4).

**Out of scope:** per-area cost caps (spec §12.2 lists only the monthly global budget as a hard limit — a per-area limit is noted in §14.3 as a *future* setting the key-value schema allows, not built here); historical spend charts / analytics UI (only the current-month figure is surfaced); reconciling `estimated_cost_usd` in `api_usage` against actual Google billing (the ledger records the app's own count of served images, which is the estimate — matching spec §12.3's "estimado vs. real" being per-area via `actual_cost_usd`, not a billing integration).

## Global Constraints

- **Count only successful, served images** (spec §12.3): `api_usage.street_view_requests` increments by the number of images the Street View Static API actually returned (`captures.length`) — failed/retried requests that never served an image do not count. Metadata lookups are a separate free Google endpoint and are never counted.
- **One ledger row per calendar day** (`api_usage.date` is `UNIQUE`): all writes are upserts that add to that day's running totals.
- **Budget guard is `spent + projected > max`** — stricter than the spec's literal "already over", so a single large job can't blow far past the limit. A rejected job fails loudly with an explicit error (spec §12.2), never partially.
- **DRY:** the guard and ledger live in one shared package consumed by both apps; no duplicated SQL.
- **No path aliases** — relative imports. TDD: pure guard is unit-tested; DB helpers have integration tests gated on `TEST_DATABASE_URL` (matching the repo's existing pattern). Frequent commits.

---

## File Structure

```
netryx-fork/
├── packages/
│   └── api-usage/                                 # Task 1
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── budget.ts                          # pure guard + projected cost
│           ├── budget.test.ts
│           ├── usage-repo.ts                       # recordStreetViewUsage, getMonthlySpendUsd
│           ├── usage-repo.test.ts
│           └── index.ts
├── apps/
│   ├── worker/
│   │   ├── package.json                            # Modify (Task 2 — dep)
│   │   └── src/
│   │       ├── jobs/index-area.ts                  # Modify (Task 2)
│   │       ├── jobs/index-area.test.ts             # Modify (Task 2)
│   │       ├── db-queries.ts                        # Modify (Task 2 — usage query wiring)
│   │       └── index.ts                             # Modify (Task 2)
│   └── web/
│       ├── package.json                            # Modify (Task 3 — dep)
│       └── app/
│           ├── api/areas/route.ts                  # Modify (Task 3 — pre-check)
│           ├── api/usage/route.ts                  # Task 4
│           └── (protected)/index/page.tsx          # Modify (Task 4 — budget line)
```

---

### Task 1: `@netryx/api-usage` — budget guard + ledger

**Files:**
- Create: `packages/api-usage/package.json`, `tsconfig.json`, `src/index.ts`, `src/budget.ts`, `src/budget.test.ts`, `src/usage-repo.ts`, `src/usage-repo.test.ts`

**Interfaces:**
- Produces: `projectedCostUsd(pointsEstimated, headingsCount, pricePerImageUsd): number`; `assertWithinMonthlyBudget(spentUsd, projectedUsd, maxBudgetUsd): void` (throws `BudgetExceededError`); `recordStreetViewUsage(pool, requests, pricePerImageUsd): Promise<void>`; `getMonthlySpendUsd(pool): Promise<number>`; `BudgetExceededError`.

- [ ] **Step 1: Write the failing budget test**

```typescript
// packages/api-usage/src/budget.test.ts
import { describe, it, expect } from "vitest";
import { projectedCostUsd, assertWithinMonthlyBudget, BudgetExceededError } from "./budget";

describe("projectedCostUsd", () => {
  it("multiplies points × headings × price", () => {
    expect(projectedCostUsd(1000, 4, 0.007)).toBeCloseTo(28.0, 5);
  });
});

describe("assertWithinMonthlyBudget", () => {
  it("passes when spent + projected is within the budget", () => {
    expect(() => assertWithinMonthlyBudget(10, 15, 50)).not.toThrow();
  });
  it("throws BudgetExceededError when spent + projected exceeds the budget", () => {
    expect(() => assertWithinMonthlyBudget(40, 15, 50)).toThrow(BudgetExceededError);
    expect(() => assertWithinMonthlyBudget(40, 15, 50)).toThrow(/monthly budget/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api-usage && pnpm install && pnpm test budget.test.ts` (after Step 4 creates the manifest; if `pnpm test` can't resolve yet, this failing state is expected).
Expected: FAIL — `Cannot find module './budget'`.

- [ ] **Step 3: Implement `budget.ts`**

```typescript
// packages/api-usage/src/budget.ts
export class BudgetExceededError extends Error {
  constructor(spentUsd: number, projectedUsd: number, maxBudgetUsd: number) {
    super(
      `This job's estimated cost ($${projectedUsd.toFixed(2)}) plus this month's spend ` +
        `($${spentUsd.toFixed(2)}) would exceed the monthly budget of $${maxBudgetUsd.toFixed(2)}.`
    );
    this.name = "BudgetExceededError";
  }
}

/** Spec §12.1: points × headings × price per image. */
export function projectedCostUsd(
  pointsEstimated: number,
  headingsCount: number,
  pricePerImageUsd: number
): number {
  return pointsEstimated * headingsCount * pricePerImageUsd;
}

/** Spec §12.2 hard limit — throws if this job would push the month over budget. */
export function assertWithinMonthlyBudget(
  spentUsd: number,
  projectedUsd: number,
  maxBudgetUsd: number
): void {
  if (spentUsd + projectedUsd > maxBudgetUsd) {
    throw new BudgetExceededError(spentUsd, projectedUsd, maxBudgetUsd);
  }
}
```

- [ ] **Step 4: Create the package manifest, tsconfig, and barrel**

```json
// packages/api-usage/package.json
{
  "name": "@netryx/api-usage",
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
// packages/api-usage/tsconfig.json
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
// packages/api-usage/src/index.ts
export * from "./budget";
export * from "./usage-repo";
```

- [ ] **Step 5: Run the budget test to verify it passes**

Run: `pnpm install && cd packages/api-usage && pnpm test budget.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 6: Write the failing ledger integration test** (gated on `TEST_DATABASE_URL`)

```typescript
// packages/api-usage/src/usage-repo.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { recordStreetViewUsage, getMonthlySpendUsd } from "./usage-repo";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("usage-repo", () => {
  const pool = new Pool({ connectionString: url });

  beforeEach(async () => {
    // isolate: clear today's/this month's rows created by prior runs
    await pool.query(`DELETE FROM api_usage WHERE date >= date_trunc('month', current_date)`);
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM api_usage WHERE date >= date_trunc('month', current_date)`);
    await pool.end();
  });

  it("upserts today's row, accumulating requests and cost", async () => {
    await recordStreetViewUsage(pool, 100, 0.007);
    await recordStreetViewUsage(pool, 50, 0.007);
    const { rows } = await pool.query(
      `SELECT street_view_requests, estimated_cost_usd FROM api_usage WHERE date = current_date`
    );
    expect(rows[0].street_view_requests).toBe(150);
    expect(Number(rows[0].estimated_cost_usd)).toBeCloseTo(1.05, 5); // 150 * 0.007
  });

  it("sums month-to-date spend", async () => {
    await recordStreetViewUsage(pool, 200, 0.007);
    expect(await getMonthlySpendUsd(pool)).toBeCloseTo(1.4, 5); // 200 * 0.007
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd packages/api-usage && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test usage-repo.test.ts`
Expected: FAIL — `Cannot find module './usage-repo'`.

- [ ] **Step 8: Implement `usage-repo.ts`**

```typescript
// packages/api-usage/src/usage-repo.ts
import type { Pool } from "pg";

/**
 * Adds `requests` served images (and their cost) to today's api_usage row,
 * creating it if absent (spec §12.3). One row per calendar day (UNIQUE date).
 */
export async function recordStreetViewUsage(
  pool: Pool,
  requests: number,
  pricePerImageUsd: number
): Promise<void> {
  if (requests <= 0) return;
  const costUsd = requests * pricePerImageUsd;
  await pool.query(
    `INSERT INTO api_usage (date, street_view_requests, estimated_cost_usd)
     VALUES (current_date, $1, $2)
     ON CONFLICT (date) DO UPDATE
       SET street_view_requests = api_usage.street_view_requests + $1,
           estimated_cost_usd = api_usage.estimated_cost_usd + $2`,
    [requests, costUsd]
  );
}

/** Month-to-date Street View spend in USD (spec §12.2). */
export async function getMonthlySpendUsd(pool: Pool): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS spent
     FROM api_usage WHERE date >= date_trunc('month', current_date)`
  );
  return Number(rows[0].spent);
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd packages/api-usage && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test pnpm test`
Expected: PASS — budget + ledger tests green.

- [ ] **Step 10: Commit**

```bash
git add packages/api-usage pnpm-lock.yaml
git commit -m "feat(api-usage): shared budget guard + api_usage ledger (spec §12.2, §12.3)"
```

---

### Task 2: Worker — enforce budget + record usage

**Files:**
- Modify: `apps/worker/package.json` (add `@netryx/api-usage`)
- Modify: `apps/worker/src/jobs/index-area.ts`, `apps/worker/src/jobs/index-area.test.ts`, `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: `projectedCostUsd`, `assertWithinMonthlyBudget`, `BudgetExceededError`, `getMonthlySpendUsd`, `recordStreetViewUsage`.
- Produces: two new `IndexAreaJobDeps` — `getMonthlySpendUsd: () => Promise<number>` and `recordStreetViewUsage: (requests: number, pricePerImageUsd: number) => Promise<void>`.

- [ ] **Step 1: Add the dependency**

```json
// apps/worker/package.json — add to "dependencies"
"@netryx/api-usage": "workspace:*",
```
Run: `pnpm install`.

- [ ] **Step 2: Add a failing test — job rejects when over budget, records usage otherwise**

```typescript
// apps/worker/src/jobs/index-area.test.ts — add (extend makeDeps to accept the two new deps)
it("fails the area without downloading when the projected cost exceeds the monthly budget (spec §12.2)", async () => {
  const downloadCaptures = vi.fn();
  const deps = makeDeps({
    settings: { GOOGLE_MAPS_API_KEY: "k", MAX_MONTHLY_BUDGET_USD: "10", STREET_VIEW_PRICE_PER_IMAGE_USD: "0.007" },
    points: new Array(1000).fill({ lat: 1, lng: 2 }), // 1000 * 4 * 0.007 = $28 projected
    getMonthlySpendUsd: vi.fn().mockResolvedValue(0),
    downloadCaptures,
  });

  await runIndexAreaJob({ areaId: "area-1" }, deps);

  expect(downloadCaptures).not.toHaveBeenCalled();
  const statuses = deps.updateAreaProgress.mock.calls.map((c: any[]) => c[1].status).filter(Boolean);
  expect(statuses).toContain("failed");
});

it("records served-image usage after a successful download (spec §12.3)", async () => {
  const recordStreetViewUsage = vi.fn().mockResolvedValue(undefined);
  const deps = makeDeps({
    captures: [
      { panoId: "p", heading: 0, lat: 1, lng: 2, captureDate: null, imageBase64: "x" },
      { panoId: "p", heading: 90, lat: 1, lng: 2, captureDate: null, imageBase64: "y" },
    ],
    embeddings: [[1, 0], [0, 1]],
    getMonthlySpendUsd: vi.fn().mockResolvedValue(0),
    recordStreetViewUsage,
  });

  await runIndexAreaJob({ areaId: "area-1" }, deps);

  expect(recordStreetViewUsage).toHaveBeenCalledWith(2, 0.007); // 2 served images
});
```

> Extend `makeDeps` to default `getMonthlySpendUsd: vi.fn().mockResolvedValue(0)` and `recordStreetViewUsage: vi.fn().mockResolvedValue(undefined)`, and to let `settings`/`points` be overridden (if it doesn't already).

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/worker && pnpm test index-area.test.ts -t budget`
Expected: FAIL — no budget check; `downloadCaptures` is called.

- [ ] **Step 4: Wire the budget check + recording into `runIndexAreaJob`**

```typescript
// apps/worker/src/jobs/index-area.ts

// 1) add imports
import {
  projectedCostUsd,
  assertWithinMonthlyBudget,
  BudgetExceededError,
} from "@netryx/api-usage";

// 2) add to IndexAreaJobDeps
    getMonthlySpendUsd: () => Promise<number>;
    recordStreetViewUsage: (requests: number, pricePerImageUsd: number) => Promise<void>;

// 3) also read the budget setting in the initial Promise.all:
//    add deps.getSetting("MAX_MONTHLY_BUDGET_USD") and destructure maxBudgetRaw.
//    const maxMonthlyBudgetUsd = Number(maxBudgetRaw ?? 50);

// 4) AFTER sampling points and BEFORE downloadCaptures, guard the budget:
    const projected = projectedCostUsd(points.length, STREET_VIEW_HEADINGS.length, pricePerImageUsd);
    const spent = await deps.getMonthlySpendUsd();
    try {
      assertWithinMonthlyBudget(spent, projected, maxMonthlyBudgetUsd);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        await deps.updateAreaProgress(areaId, { status: "failed" });
        return; // reject cleanly, no paid download happened
      }
      throw err;
    }

// 5) AFTER `await deps.insertIndexedPoints(...)` (downloads succeeded), record usage:
    await deps.recordStreetViewUsage(captures.length, pricePerImageUsd);
```

- [ ] **Step 5: Wire the real deps in `apps/worker/src/index.ts`**

```typescript
// apps/worker/src/index.ts
import { getMonthlySpendUsd, recordStreetViewUsage } from "@netryx/api-usage";
// add to the deps object passed to runIndexAreaJob:
      getMonthlySpendUsd: () => getMonthlySpendUsd(pool),
      recordStreetViewUsage: (requests, price) => recordStreetViewUsage(pool, requests, price),
```

- [ ] **Step 6: Run the worker test suite**

Run: `cd apps/worker && pnpm test`
Expected: PASS — new budget/usage tests + all existing worker tests green.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/package.json apps/worker/src/jobs/index-area.ts apps/worker/src/jobs/index-area.test.ts apps/worker/src/index.ts pnpm-lock.yaml
git commit -m "feat(worker): enforce monthly budget + record served-image usage (spec §12.2, §12.3)"
```

---

### Task 3: Web — reject over-budget areas before enqueue

Fast feedback: `POST /api/areas` rejects with a clear error before creating the row/job, using the same guard (the worker still enforces authoritatively).

**Files:**
- Modify: `apps/web/package.json` (add `@netryx/api-usage`)
- Modify: `apps/web/app/api/areas/route.ts`

**Interfaces:**
- Consumes: `projectedCostUsd`, `assertWithinMonthlyBudget`, `BudgetExceededError`, `getMonthlySpendUsd`.

- [ ] **Step 1: Add the dependency**

```json
// apps/web/package.json — add to "dependencies"
"@netryx/api-usage": "workspace:*",
```
Run: `pnpm install`.

- [ ] **Step 2: Add the pre-check to `POST /api/areas`**

```typescript
// apps/web/app/api/areas/route.ts
// add imports:
import { assertWithinMonthlyBudget, BudgetExceededError, getMonthlySpendUsd } from "@netryx/api-usage";

// read the budget setting alongside the others:
const maxMonthlyBudgetUsd = Number((await repo.getSetting("MAX_MONTHLY_BUDGET_USD")) ?? "50");

// AFTER computing `estimatedCostUsd` (which already exists) and BEFORE the INSERT:
  const pool = getPool();
  try {
    const spent = await getMonthlySpendUsd(pool);
    assertWithinMonthlyBudget(spent, estimatedCostUsd, maxMonthlyBudgetUsd);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
```

> `getPool()` is currently called just before the INSERT; move that call above the budget check (or add a second `const pool = getPool()` — `getPool` memoizes, so a duplicate call is harmless) so the check can use it.

- [ ] **Step 3: Manual verification**

Set `MAX_MONTHLY_BUDGET_USD` low (e.g. `1`) via `/settings`, then `POST /api/areas` with a real polygon:
```bash
curl -s -X POST http://localhost:3000/api/areas -H 'content-type: application/json' \
  -d '{"polygon":[[-5.58,42.59],[-5.575,42.59],[-5.575,42.595],[-5.58,42.595],[-5.58,42.59]],"areaKm2":0.2}' -w '\n%{http_code}\n'
```
Expected: `400` with a "would exceed the monthly budget" message; no row is created. Raise the budget and it returns `201` again.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/app/api/areas/route.ts pnpm-lock.yaml
git commit -m "feat(web): reject over-budget areas before enqueue (spec §12.2)"
```

---

### Task 4: Web — surface monthly spend vs. budget

Expose the ledger and show it in the indexing panel next to the cost estimate.

**Files:**
- Create: `apps/web/app/api/usage/route.ts`
- Modify: `apps/web/app/(protected)/index/page.tsx`

**Interfaces:**
- Produces: `GET /api/usage` → `{ monthlySpendUsd, monthlyBudgetUsd, remainingUsd }`.

- [ ] **Step 1: Implement `GET /api/usage`**

```typescript
// apps/web/app/api/usage/route.ts
import { NextResponse } from "next/server";
import { getMonthlySpendUsd } from "@netryx/api-usage";
import { getPool } from "../../../lib/db";
import { getSettingsRepo } from "../../../lib/settings-repo";

export async function GET() {
  const pool = getPool();
  const monthlyBudgetUsd = Number((await getSettingsRepo().getSetting("MAX_MONTHLY_BUDGET_USD")) ?? "50");
  const monthlySpendUsd = await getMonthlySpendUsd(pool);
  return NextResponse.json({
    monthlySpendUsd,
    monthlyBudgetUsd,
    remainingUsd: Math.max(0, monthlyBudgetUsd - monthlySpendUsd),
  });
}
```

- [ ] **Step 2: Show the budget line in the `/index` estimate panel**

In `app/(protected)/index/page.tsx`, fetch usage on mount and render it under the cost estimate. Add near the top of the component:

```tsx
  const [usage, setUsage] = useState<{ monthlySpendUsd: number; monthlyBudgetUsd: number } | null>(null);
  useEffect(() => {
    fetch("/api/usage").then((r) => r.json()).then(setUsage).catch(() => setUsage(null));
  }, []);
```

Then, inside the estimate block (where `~${estimate.estimatedCostUsd.toFixed(2)}` is shown), add below it:

```tsx
  {usage && (
    <div className="mt-2 text-[11px] text-subtle">
      Presupuesto del mes: ${usage.monthlySpendUsd.toFixed(2)} / ${usage.monthlyBudgetUsd.toFixed(2)}
    </div>
  )}
```

> This is the one spot this plan touches Dashboard Part 1's file. If Part 1 isn't built yet, create the endpoint (Step 1) regardless and apply this snippet when `/index/page.tsx` exists — the endpoint is independently useful and the worker/`POST /api/areas` enforcement (Tasks 2–3) does not depend on it.

- [ ] **Step 3: Manual verification**

Run: `pnpm dev`, `curl -s http://localhost:3000/api/usage | jq` → `{ monthlySpendUsd, monthlyBudgetUsd, remainingUsd }`. After running an indexing job, `monthlySpendUsd` reflects `served images × price`. On `/index`, drawing a polygon and estimating shows the "Presupuesto del mes: $X / $Y" line under the estimate.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/usage/route.ts "apps/web/app/(protected)/index/page.tsx"
git commit -m "feat(web): GET /api/usage + monthly budget line in indexing panel (spec §12.1)"
```

---

## Self-Review

- **Spec coverage:** §12.1 estimate already exists; this plan adds the running budget line beside it ✔ (Task 4). §12.2 `MAX_MONTHLY_BUDGET_USD` hard limit — worker rejects over-budget jobs before any paid download ✔ (Task 2), web rejects before enqueue for fast feedback ✔ (Task 3), `MAX_CONCURRENT_REQUESTS` already enforced by `downloadCaptures`'s `p-limit` (Indexing plan) so untouched here. §12.3 each served image increments `api_usage` (upsert) ✔ (Tasks 1,2); retries that never served an image don't count because only `captures.length` (successful images) is recorded ✔; `areas.actual_cost_usd` already written by the job (Indexing plan) — the estimated-vs-actual per-area comparison it enables is unchanged.
- **DRY:** guard + ledger in one `@netryx/api-usage` package consumed by worker and web; no duplicated SQL or thresholds.
- **Type consistency:** `getMonthlySpendUsd(pool)` / `recordStreetViewUsage(pool, requests, price)` signatures identical across the worker deps (Task 2) and web routes (Tasks 3,4). The worker injects them as deps (testable); the web calls them directly with `getPool()`.
- **Deferred correctly:** per-area caps, spend-history UI, real-billing reconciliation — all noted, none silently dropped.
- **Ordering:** Task 1 (package) precedes its consumers (2–4). Tasks 2 and 3 are independent enforcement points; either can ship first.

---

## Execution Handoff

**Plan complete and saved to `docs/2026-07-09-cost-tracking.md`.**

Independent of the Search UI plan — can be executed in either order.

**Two execution options:**
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

**Which approach?**
