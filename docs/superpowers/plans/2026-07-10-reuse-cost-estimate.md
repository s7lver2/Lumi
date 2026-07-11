# Image Reuse Cost Estimate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user is about to index a new area, show them how many of the images they're about to pay for are actually already sitting in the database from an earlier, overlapping area — and only charge/estimate the remainder.

**Architecture:** The paid Google Street View *image* download is already deduped cross-area at the worker level (`apps/worker/src/street-view.ts`'s `existingPanoHeadings` gate, seeded from `apps/worker/src/db-queries.ts`'s `loadExistingPanoHeadings`) — money is already not being wasted there. The actual gap is informational: `POST /api/areas/estimate` and `POST /api/areas` compute cost as a flat `points × headings × price` with zero awareness that `indexed_images` might already cover part of the drawn polygon. This plan adds one spatial COUNT query (PostGIS `ST_Intersects` against the existing `geography(Point,4326)` column, the same pattern `apps/worker/src/db-queries.ts` already uses) and threads the resulting "reusable image" count through the existing cost-estimate function and the estimate panel UI. No new dedup mechanism is being built — the dedup already works; this plan makes it visible and reflected in the price shown to the user.

**Tech Stack:** PostGIS (`ST_Intersects`, `ST_GeogFromText` — both already used elsewhere in this codebase), existing `pg.Pool` (`apps/web/lib/db.ts`), Vitest.

## Global Constraints

- Do not touch `apps/worker/src/street-view.ts`'s existing `seenThisRun`/`existingPanoHeadings` dedup — it already works correctly and is out of scope.
- The reuse count is an **estimate**, not a guarantee — it counts `indexed_images` rows whose point falls inside the drawn polygon, not an exact match against this specific run's sampled points/headings (those aren't known until each point's Street View metadata call resolves a `pano_id` at job-run time, spec'd behavior in `street-view.ts`). Every place this count is surfaced (API response field name, UI copy) must call it an estimate, not a promise.
- `estimateIndexingCostUsd`'s existing 3-argument call form must keep working for any future caller that doesn't know about reuse — add `reusableImages` as an **optional 4th parameter defaulting to 0**, do not make it required.

---

### Task 1: `estimateIndexingCostUsd` accepts a reuse discount

**Files:**
- Modify: `packages/geo-sampling/src/cost.ts`
- Modify: `packages/geo-sampling/src/cost.test.ts`

**Interfaces:**
- Produces: `estimateIndexingCostUsd(pointsEstimated: number, headingsCount: number, pricePerImageUsd: number, reusableImages?: number): number` — consumed by Task 3/4's route changes.

- [ ] **Step 1: Write the failing tests**

Add to `packages/geo-sampling/src/cost.test.ts`, inside the existing `describe("estimateIndexingCostUsd", ...)` block:

```ts
  it("subtracts reusableImages from the billable image count when given", () => {
    // 1000 points * 4 headings = 4000 images; 300 already indexed -> 3700 billed
    expect(estimateIndexingCostUsd(1000, 4, 0.007, 300)).toBeCloseTo(3700 * 0.007, 5);
  });

  it("never bills a negative amount if reusableImages exceeds the potential image count", () => {
    expect(estimateIndexingCostUsd(10, 4, 0.007, 9999)).toBe(0);
  });

  it("defaults reusableImages to 0 when omitted, unchanged from before", () => {
    expect(estimateIndexingCostUsd(1000, 4, 0.007)).toBeCloseTo(28.0, 5);
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @netryx/geo-sampling exec vitest run src/cost.test.ts`
Expected: FAIL on the first two new tests (current implementation ignores a 4th argument and returns `4000 * 0.007` instead of `3700 * 0.007`; the third new test already passes since it matches current behavior).

- [ ] **Step 3: Implement**

```ts
// packages/geo-sampling/src/cost.ts

/**
 * Spec §12.1: nº puntos × nº headings × precio por imagen, menos las
 * imágenes ya indexadas de un área solapada anterior (reusableImages —
 * ver apps/web/lib/reuse-estimate.ts). reusableImages es una ESTIMACIÓN
 * (cuenta puntos ya indexados dentro del polígono, no un match exacto
 * pano/heading, que no se conoce hasta la llamada a metadata en el job real).
 */
export function estimateIndexingCostUsd(
  pointsEstimated: number,
  headingsCount: number,
  pricePerImageUsd: number,
  reusableImages = 0
): number {
  const potentialImages = pointsEstimated * headingsCount;
  const billableImages = Math.max(0, potentialImages - reusableImages);
  return billableImages * pricePerImageUsd;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/geo-sampling exec vitest run src/cost.test.ts`
Expected: PASS (5 tests total — 2 pre-existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add packages/geo-sampling/src/cost.ts packages/geo-sampling/src/cost.test.ts
git commit -m "feat(geo-sampling): let estimateIndexingCostUsd discount already-indexed images"
```

---

### Task 2: Spatial query for already-indexed images inside a polygon

**Files:**
- Create: `apps/web/lib/polygon-wkt.ts`
- Create: `apps/web/lib/polygon-wkt.test.ts`
- Create: `apps/web/lib/reuse-estimate.ts`
- Create: `apps/web/lib/reuse-estimate.test.ts`

**Interfaces:**
- Produces: `polygonToWkt(polygon: [number, number][]): string` (extracted from the inline template literal already duplicated in `apps/web/app/api/areas/route.ts:83` — Task 3 replaces that inline copy with this shared helper) and `countReusableImages(pool: Pick<import("pg").Pool, "query">, polygon: [number, number][]): Promise<number>`, both consumed by Task 3.

- [ ] **Step 1: Write the failing test for `polygonToWkt`**

```ts
// apps/web/lib/polygon-wkt.test.ts
import { describe, it, expect } from "vitest";
import { polygonToWkt } from "./polygon-wkt";

describe("polygonToWkt", () => {
  it("formats a [lng, lat][] ring as a POLYGON WKT string", () => {
    const polygon: [number, number][] = [
      [-3.7, 40.4],
      [-3.6, 40.4],
      [-3.6, 40.5],
      [-3.7, 40.5],
      [-3.7, 40.4],
    ];
    expect(polygonToWkt(polygon)).toBe(
      "POLYGON((-3.7 40.4, -3.6 40.4, -3.6 40.5, -3.7 40.5, -3.7 40.4))"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netryx/web exec vitest run app/lib/polygon-wkt.test.ts` (or `lib/polygon-wkt.test.ts` depending on vitest's configured root — match whichever glob the existing `apps/web` vitest config already picks up other `app/lib/*.test.ts` files with, e.g. `apps/web/app/lib/wsl-path.test.ts`)
Expected: FAIL — `Cannot find module './polygon-wkt'`

- [ ] **Step 3: Implement `polygonToWkt`**

```ts
// apps/web/lib/polygon-wkt.ts
// Extracted from the inline WKT-building template literal that was
// duplicated between apps/web/app/api/areas/route.ts and (this task) the
// new reuse-estimate query — same exact format Postgres/PostGIS's
// ST_GeomFromText/ST_GeogFromText expect, already proven working there.
export function polygonToWkt(polygon: [number, number][]): string {
  return `POLYGON((${polygon.map(([lng, lat]) => `${lng} ${lat}`).join(", ")}))`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: PASS

- [ ] **Step 5: Write the failing test for `countReusableImages`**

```ts
// apps/web/lib/reuse-estimate.test.ts
import { describe, it, expect, vi } from "vitest";
import { countReusableImages } from "./reuse-estimate";

describe("countReusableImages", () => {
  it("queries indexed_images with ST_Intersects against the polygon's geography and returns the row count", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: "42" }] });
    const pool = { query };
    const polygon: [number, number][] = [
      [-3.7, 40.4], [-3.6, 40.4], [-3.6, 40.5], [-3.7, 40.5], [-3.7, 40.4],
    ];

    const result = await countReusableImages(pool as any, polygon);

    expect(result).toBe(42);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/ST_Intersects/);
    expect(sql).toMatch(/indexed_images/);
    expect(params[0]).toBe("POLYGON((-3.7 40.4, -3.6 40.4, -3.6 40.5, -3.7 40.5, -3.7 40.4))");
  });

  it("returns 0 when no rows match", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: "0" }] });
    const result = await countReusableImages({ query } as any, [[-3.7, 40.4], [-3.6, 40.4], [-3.6, 40.5], [-3.7, 40.4]]);
    expect(result).toBe(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @netryx/web exec vitest run app/lib/reuse-estimate.test.ts`
Expected: FAIL — `Cannot find module './reuse-estimate'`

- [ ] **Step 7: Implement `countReusableImages`**

```ts
// apps/web/lib/reuse-estimate.ts
import type { Pool } from "pg";
import { polygonToWkt } from "./polygon-wkt";

/**
 * Counts indexed_images rows whose point already falls inside the given
 * polygon — an ESTIMATE of how many of this new area's images are already
 * paid for and stored from an earlier, overlapping area. Not an exact
 * pano_id/heading match (that's only known once each point's Street View
 * metadata call resolves at job-run time — see apps/worker/src/street-view.ts),
 * just "is there already indexed coverage here." Same ST_GeogFromText/
 * geography(Point,4326) pattern apps/worker/src/db-queries.ts's
 * insertIndexedImages already uses against the same column.
 */
export async function countReusableImages(
  pool: Pick<Pool, "query">,
  polygon: [number, number][]
): Promise<number> {
  const wkt = polygonToWkt(polygon);
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM indexed_images
     WHERE ST_Intersects(location, ST_GeogFromText($1))`,
    [wkt]
  );
  return Number(rows[0]?.count ?? "0");
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @netryx/web exec vitest run app/lib/reuse-estimate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/polygon-wkt.ts apps/web/lib/polygon-wkt.test.ts apps/web/lib/reuse-estimate.ts apps/web/lib/reuse-estimate.test.ts
git commit -m "feat(web): add a spatial query counting already-indexed images inside a polygon"
```

---

### Task 3: Wire reuse discount into both area routes

**Files:**
- Modify: `apps/web/app/api/areas/estimate/route.ts`
- Modify: `apps/web/app/api/areas/route.ts`
- Test: `apps/web/app/api/areas/route.test.ts`

**Interfaces:**
- Consumes: `countReusableImages` and `polygonToWkt` from Task 2, `estimateIndexingCostUsd`'s new 4th parameter from Task 1.
- Produces: both routes' JSON responses gain a `reusableImages: number` field, consumed by Task 4's UI.

- [ ] **Step 1: Read the existing `apps/web/app/api/areas/route.test.ts` to match its mocking conventions before editing**

This file already mocks `getPool`/`fetchStreetGeometry`/etc. for the `POST /api/areas` handler — follow its existing pattern exactly (same mock module paths, same `vi.mock` shape) rather than introducing a new one. Since its exact current contents aren't reproduced in this plan, the implementing engineer's first sub-step is to open it and confirm the mock scaffolding before writing new assertions, then add a case asserting `reusableImages` appears in the JSON body and that `countReusableImages`'s mock was called with the submitted polygon.

- [ ] **Step 2: Update `apps/web/app/api/areas/estimate/route.ts`**

```ts
// apps/web/app/api/areas/estimate/route.ts — add these imports
import { countReusableImages } from "../../../../lib/reuse-estimate";
```

Replace the cost-computation block (originally lines 58-63):

```ts
  const points = samplePointsAlongStreets(lines, SAMPLING_SPACING_METERS, body.polygon);
  const reusableImages = await countReusableImages(getPool(), body.polygon);
  const estimatedCostUsd = estimateIndexingCostUsd(
    points.length,
    STREET_VIEW_HEADINGS.length,
    pricePerImageUsd,
    reusableImages
  );
```

Add `reusableImages` to the final JSON response (also delete the unreachable dead `return` statement that already existed after the live one — line 77's `return NextResponse.json({ pointsEstimated: points.length, estimatedCostUsd });` can never execute, since the function already returns on the line above it):

```ts
  return NextResponse.json({
    pointsEstimated: points.length,
    estimatedCostUsd,            // gross, after reuse discount
    reusableImages,
    netCostUsd: net.netJobUsd,
    freeRemainingUsd: net.freeRemainingUsd,
  });
```

- [ ] **Step 3: Update `apps/web/app/api/areas/route.ts`**

```ts
// apps/web/app/api/areas/route.ts — add this import
import { countReusableImages } from "../../../lib/reuse-estimate";
import { polygonToWkt } from "../../../lib/polygon-wkt";
```

Replace the cost-computation block (originally lines 62-67):

```ts
  const points = samplePointsAlongStreets(lines, SAMPLING_SPACING_METERS, body.polygon);
  const reusableImages = await countReusableImages(getPool(), body.polygon);
  const estimatedCostUsd = estimateIndexingCostUsd(
    points.length,
    STREET_VIEW_HEADINGS.length,
    pricePerImageUsd,
    reusableImages
  );
```

`getPool()` is now called earlier than before (previously first introduced at the pre-existing `const pool = getPool();` line) — replace that later line with a reference to the same call instead of invoking `getPool()` twice:

```ts
  const pool = getPool(); // moved up: also used by countReusableImages above
```

(i.e. move the existing `const pool = getPool();` declaration up to before the `countReusableImages(getPool(), ...)` call and change that call site to `countReusableImages(pool, body.polygon)`, so there's exactly one `getPool()` call in this function — `getPool()` itself is a cached singleton (`apps/web/lib/db.ts:5-13`) so calling it twice was never incorrect, just redundant.)

Add `reusableImages` to the success response (originally line 94-97):

```ts
  return NextResponse.json(
    { areaId, pointsEstimated: points.length, estimatedCostUsd, reusableImages },
    { status: 201 }
  );
```

- [ ] **Step 4: Write/run the test added in Step 1, plus the existing suite for both files**

Run: `pnpm --filter @netryx/web exec vitest run app/api/areas/route.test.ts`
Expected: PASS, including the new `reusableImages` assertion.

There is no existing `estimate/route.test.ts` per the repo listing seen so far (only `apps/web/app/api/areas/route.test.ts` was found) — if that assumption turns out wrong when the implementing engineer greps for it, extend it the same way as Step 1; otherwise this route's coverage stays at the manual-verification level the rest of this task's Step 5 already covers.

- [ ] **Step 5: Manually verify against a real (or local) database**

With `pnpm db:up` running and at least one previously indexed area on the map, draw a new overlapping polygon in the UI and call `POST /api/areas/estimate` (or use the running dev UI once Task 4 lands) — confirm `reusableImages > 0` and `estimatedCostUsd` is lower than `pointsEstimated * 4 * pricePerImageUsd` would otherwise be. Draw a polygon far from any existing area and confirm `reusableImages === 0` with `estimatedCostUsd` unchanged from before this plan.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/areas/estimate/route.ts apps/web/app/api/areas/route.ts apps/web/app/api/areas/route.test.ts
git commit -m "feat(web): discount area cost estimates by already-indexed image coverage"
```

---

### Task 4: Surface the reuse discount in the estimate panel UI

**Files:**
- Modify: `apps/web/app/stores/useIndexingStore.ts`
- Modify: `apps/web/app/stores/useIndexingStore.test.ts`
- Modify: `apps/web/app/(protected)/index/page.tsx`

**Interfaces:**
- Consumes: the `reusableImages` field Task 3 added to `POST /api/areas/estimate`'s response.

- [ ] **Step 1: Write the failing test for the store's `Estimate` shape**

Add to `apps/web/app/stores/useIndexingStore.test.ts` (extend whatever existing `setEstimate` test is there with a reuse-aware case — the exact existing test names weren't re-derived in this research pass, so the implementing engineer should add this as a new `it(...)` inside the existing top-level `describe` block rather than assuming a specific prior test name):

```ts
  it("stores reusableImages alongside the rest of the estimate", () => {
    const { setEstimate } = useIndexingStore.getState();
    setEstimate({ pointsEstimated: 500, estimatedCostUsd: 10.5, reusableImages: 120 });
    expect(useIndexingStore.getState().estimate).toEqual({
      pointsEstimated: 500,
      estimatedCostUsd: 10.5,
      reusableImages: 120,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @netryx/web exec vitest run app/stores/useIndexingStore.test.ts`
Expected: FAIL — TypeScript error/type mismatch, since `Estimate` doesn't have `reusableImages` yet (vitest's esbuild transform surfaces this as the object not matching, or a type-check failure if `tsc --noEmit` gates the test run — either way, treat any failure here as confirming the field doesn't exist yet).

- [ ] **Step 3: Implement — widen the `Estimate` interface**

```ts
// apps/web/app/stores/useIndexingStore.ts
export interface Estimate {
  pointsEstimated: number;
  estimatedCostUsd: number;
  reusableImages: number;
}
```

(`setEstimate`'s signature (`(estimate: Estimate | null) => void`) and implementation don't need any other change — it already just does `set({ estimate })`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @netryx/web exec vitest run app/stores/useIndexingStore.test.ts`
Expected: PASS

- [ ] **Step 5: Update `handleEstimate` and the estimate panel to pass through and display `reusableImages`**

```tsx
// apps/web/app/(protected)/index/page.tsx — inside handleEstimate, replace:
    setEstimate({ pointsEstimated: json.pointsEstimated, estimatedCostUsd: json.estimatedCostUsd });
// with:
    setEstimate({
      pointsEstimated: json.pointsEstimated,
      estimatedCostUsd: json.estimatedCostUsd,
      reusableImages: json.reusableImages ?? 0,
    });
```

Add a line under the existing points/images summary (originally lines 255-258), right after the closing `</div>` of that block:

```tsx
                    <div className="mt-1 text-xs text-muted">
                      {estimate.pointsEstimated.toLocaleString()} puntos ·{" "}
                      {(estimate.pointsEstimated * 4).toLocaleString()} imágenes
                    </div>
                    {estimate.reusableImages > 0 && (
                      <div className="mt-1 text-xs text-accent-fg">
                        {estimate.reusableImages.toLocaleString()} imágenes ya indexadas de un área
                        solapada — no se vuelven a pagar (estimado).
                      </div>
                    )}
```

- [ ] **Step 6: Manually verify in the browser**

Start the dev server, draw a polygon overlapping a previously indexed area, click "Estimar coste", confirm the new green/accent-colored line appears with a plausible count and that the displayed `~$X.XX` total is lower than it would be without the discount. Draw a polygon somewhere untouched and confirm the line does NOT appear (since `reusableImages > 0` gates it) and the price matches the pre-existing flat calculation.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/stores/useIndexingStore.ts apps/web/app/stores/useIndexingStore.test.ts "apps/web/app/(protected)/index/page.tsx"
git commit -m "feat(web): show already-indexed image reuse savings in the area cost estimate"
```

---

## Self-Review

**1. Spec coverage:** "detecte si las imágenes de una zona ya las tiene, y pueden ser reutilizadas" → Task 2's spatial query (detection) plus the existing, unmodified worker-level dedup (reuse, already correct — confirmed by research, not re-implemented). "para reducir costes de api" → Task 1 (cost formula) + Task 3 (wired into both routes that actually price a job) + Task 4 (visible to the user, so the saving is legible, not just internally computed).

**2. Placeholder scan:** no TBD/TODO; Task 3 Step 1 and Task 4 Step 1 both flag genuine unknowns (exact pre-existing test scaffolding/names not re-derived during research) as an explicit first sub-step for the implementing engineer to resolve by reading the file, rather than guessing at code that might not match.

**3. Type consistency:** `Estimate` (`useIndexingStore.ts`) gains `reusableImages: number` matching the API's new field name exactly; `estimateIndexingCostUsd`'s 4th parameter is named `reusableImages` in both its Task 1 definition and every call site in Task 3 — no renaming drift.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-10-reuse-cost-estimate.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
