# Widget Redesign + 2-Column Results Popup + Per-Candidate Refine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **No test steps in this plan** — explicit user instruction this session. Every task ends with implementation + `npx tsc --noEmit` + commit, nothing else.

**Goal:** Add real single-candidate refine (generalizing `persistRefine` to rank one re-verified candidate against the region's existing scores), relocate/relabel the refine triggers (zone-wide in `BottomSummaryBar`, per-candidate on non-top cards), and redesign the widget panel (real icons, no duplicated headers, shared lock overlay, fixed tooltip clipping) with a 2-column expand-to-popup view.

**Architecture:** The refine backend generalizes around one merge-then-rerank step in `persistRefine` so both "refine everyone" and "refine just this one" share the same ranking logic. `BottomSummaryBar` — currently dead code, never mounted anywhere — gets mounted in both places that render `ResultsPanel`. The widget system gains a `columns` mode on `WidgetGrid` and a `tooltip` field on `Widget`, letting a new popup component reuse the exact same widget array in a 2-column layout without duplicating any widget's internals.

**Tech Stack:** Next.js API routes (SSE streaming, unchanged transport), React/Zustand client state, `pg` raw SQL.

## Global Constraints

- No test files, no test code blocks, no test-running commands in any task — verify by typecheck (`npx tsc --noEmit`) and the manual-verification note at the end of UI tasks.
- `persistRefine`'s generalization must be a strict superset of today's behavior: when `scored` already covers the whole region (today's only call pattern), the result must be identical to today's.
- `BottomSummaryBar` and `ResultsPanel` are rendered from two independent component trees (`SearchDashboard.tsx` and `ResultsPageClient.tsx`) with their own separate `handleRefine`/`refining` state — do not attempt to unify them.
- `WidgetGrid`'s `columns: 1` mode must ignore `colSpan` entirely (always full-width rows) — the sidebar's single-column guarantee must not depend on `colSpan` values happening to add up right.

---

### Task 1: `RefineRequest.candidateId`

**Files:**
- Modify: `packages/shared-types/src/search.ts`

**Interfaces:**
- Produces: `RefineRequest.candidateId?: string` — Tasks 4 and 5 read this.

- [ ] **Step 1: Add the field**

In `packages/shared-types/src/search.ts`, change:

```ts
export interface RefineRequest {
  searchId: string;
  regionId: string;
}
```

to:

```ts
export interface RefineRequest {
  searchId: string;
  regionId: string;
  /** When present, refine verifies ONLY this one candidate instead of the
   * whole region (spec: docs/superpowers/specs/2026-07-21-results-widgets-
   * popup-and-per-candidate-refine-design.md). Absent = whole-region
   * refine, unchanged from before this field existed. */
  candidateId?: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (optional field, nothing currently constructs a `RefineRequest` object literal that would break).

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/search.ts
git commit -m "feat(shared-types): add optional RefineRequest.candidateId"
```

---

### Task 2: `expandOneCandidate`

**Files:**
- Modify: `apps/web/lib/search/refine-retrieval.ts`

**Interfaces:**
- Produces: `expandOneCandidate(pool: Pool, candidateId: string): Promise<RegionCandidate | null>` — Task 4 (`run-refine.ts`) and Task 5 (the refine route) use this.

- [ ] **Step 1: Add the function**

In `apps/web/lib/search/refine-retrieval.ts`, add after `expandRegionCandidates`:

```ts
/** Same shape as expandRegionCandidates, but for exactly one candidate,
 * looked up by search_candidates.id (NOT indexed_images.id — RegionCandidate's
 * own `indexedImageId` field refers to the latter) — used for per-candidate
 * refine (spec: docs/superpowers/specs/2026-07-21-results-widgets-popup-and-
 * per-candidate-refine-design.md). Returns null if the candidate doesn't
 * exist. */
export async function expandOneCandidate(
  pool: Pool,
  candidateId: string
): Promise<RegionCandidate | null> {
  const { rows } = await pool.query(
    `SELECT img.id, img.pano_id, img.heading,
            ST_Y(img.location::geometry) AS lat,
            ST_X(img.location::geometry) AS lng,
            img.image_path
     FROM search_candidates sc
     JOIN indexed_images img ON img.id = sc.indexed_image_id
     WHERE sc.id = $1`,
    [candidateId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    indexedImageId: r.id,
    panoId: r.pano_id,
    heading: r.heading,
    lat: Number(r.lat),
    lng: Number(r.lng),
    imagePath: r.image_path,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/search/refine-retrieval.ts
git commit -m "feat(web): add expandOneCandidate for per-candidate refine"
```

---

### Task 3: generalize `persistRefine`

**Files:**
- Modify: `apps/web/lib/search/refine-persist.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `persistRefine`'s behavior generalizes to rank the WHOLE region even when `args.scored` covers only some of it — Task 4 relies on this to make single-candidate refine rank correctly.

- [ ] **Step 1: Rewrite `persistRefine`**

Replace the full content of `apps/web/lib/search/refine-persist.ts`:

```ts
// apps/web/lib/search/refine-persist.ts
import type { Pool } from "pg";
import type { SearchCandidate } from "@netryx/shared-types";

export interface ScoredCandidate {
  indexedImageId: string;
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  similarityScore: number;
  verificationScore: number;
}

export interface PersistRefineArgs {
  searchId: string;
  regionId: string;
  scored: ScoredCandidate[];
  confirmThreshold: number;
}

interface ExistingRow {
  id: string;
  indexed_image_id: string;
  pano_id: string;
  heading: number;
  lat: number;
  lng: number;
  similarity_score: string;
  verification_score: string | null;
}

/**
 * Ranks and upserts the ENTIRE region's candidates, not just whatever was
 * just verified (spec: docs/superpowers/specs/2026-07-21-results-widgets-
 * popup-and-per-candidate-refine-design.md) — a naive "rank only args.scored"
 * approach is only correct when args.scored happens to cover the whole
 * region (true for a whole-zone refine, false for a single-candidate
 * refine, where a lone re-verified candidate would otherwise always land
 * at rank 1 regardless of how it compares to the rest). Fetches the
 * region's current rows, overlays args.scored's fresh verification scores
 * on top (fresh score wins for those; everyone else keeps their existing
 * similarity/verification score), ranks the union by
 * verificationScore ?? similarityScore, and writes rank/status for every
 * region row — but only overwrites verification_score for rows actually
 * in args.scored this call. A candidate becomes "confirmed" only at rank 1
 * AND with a real (non-null) verification score clearing confirmThreshold
 * — sorting to the top on similarity alone (never verified) doesn't
 * confirm it.
 *
 * When args.scored already covers the whole region (today's only call
 * pattern before per-candidate refine existed), the "existing rows not in
 * scored" set is empty and this behaves identically to the old
 * scored-only ranking.
 */
export async function persistRefine(
  pool: Pool,
  args: PersistRefineArgs
): Promise<SearchCandidate[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existingRows } = await client.query<ExistingRow>(
      `SELECT sc.id, sc.indexed_image_id, sc.similarity_score, sc.verification_score,
              img.pano_id, img.heading,
              ST_Y(img.location::geometry) AS lat, ST_X(img.location::geometry) AS lng
       FROM search_candidates sc
       JOIN indexed_images img ON img.id = sc.indexed_image_id
       WHERE sc.region_id = $1`,
      [args.regionId]
    );

    const scoredByImageId = new Map(args.scored.map((c) => [c.indexedImageId, c]));

    interface Merged {
      indexedImageId: string;
      panoId: string;
      heading: number;
      lat: number;
      lng: number;
      similarityScore: number;
      verificationScore: number | null;
      justScored: boolean;
    }

    const merged: Merged[] = existingRows.map((r) => {
      const fresh = scoredByImageId.get(r.indexed_image_id);
      return {
        indexedImageId: r.indexed_image_id,
        panoId: r.pano_id,
        heading: r.heading,
        lat: Number(r.lat),
        lng: Number(r.lng),
        similarityScore: fresh ? fresh.similarityScore : Number(r.similarity_score),
        verificationScore: fresh ? fresh.verificationScore : r.verification_score === null ? null : Number(r.verification_score),
        justScored: Boolean(fresh),
      };
    });

    // A scored candidate with no existing search_candidates row yet (can
    // happen for a brand-new candidate never persisted before) — add it too.
    for (const c of args.scored) {
      if (!merged.some((m) => m.indexedImageId === c.indexedImageId)) {
        merged.push({
          indexedImageId: c.indexedImageId,
          panoId: c.panoId,
          heading: c.heading,
          lat: c.lat,
          lng: c.lng,
          similarityScore: c.similarityScore,
          verificationScore: c.verificationScore,
          justScored: true,
        });
      }
    }

    const ranked = [...merged].sort(
      (a, b) => (b.verificationScore ?? b.similarityScore) - (a.verificationScore ?? a.similarityScore)
    );

    const out: SearchCandidate[] = [];

    for (let i = 0; i < ranked.length; i++) {
      const c = ranked[i];
      const rank = i + 1;
      const status =
        rank === 1 && c.verificationScore !== null && c.verificationScore >= args.confirmThreshold
          ? "confirmed"
          : "unreviewed";

      const existing = await client.query(
        `SELECT id FROM search_candidates WHERE search_id = $1 AND indexed_image_id = $2`,
        [args.searchId, c.indexedImageId]
      );

      let id: string;
      if (existing.rows.length > 0) {
        id = existing.rows[0].id;
        if (c.justScored) {
          await client.query(
            `UPDATE search_candidates
               SET region_id = $1, similarity_score = $2, verification_score = $3, rank = $4, status = $5
             WHERE id = $6`,
            [args.regionId, c.similarityScore, c.verificationScore, rank, status, id]
          );
        } else {
          await client.query(
            `UPDATE search_candidates SET rank = $1, status = $2 WHERE id = $3`,
            [rank, status, id]
          );
        }
      } else {
        const inserted = await client.query(
          `INSERT INTO search_candidates
             (search_id, region_id, indexed_image_id, similarity_score, verification_score, rank, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [args.searchId, args.regionId, c.indexedImageId, c.similarityScore, c.verificationScore, rank, status]
        );
        id = inserted.rows[0].id;
      }

      out.push({
        id,
        regionId: args.regionId,
        indexedImageId: c.indexedImageId,
        panoId: c.panoId,
        heading: c.heading,
        lat: c.lat,
        lng: c.lng,
        similarityScore: c.similarityScore,
        verificationScore: c.verificationScore,
        rank,
        status,
      });
    }

    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/search/refine-persist.ts
git commit -m "feat(web): generalize persistRefine to rank the whole region for any subset of scored candidates"
```

---

### Task 4: `runRefine` per-candidate mode

**Files:**
- Modify: `apps/web/lib/search/run-refine.ts`

**Interfaces:**
- Consumes: `expandOneCandidate` (Task 2).
- Produces: `RunRefineInput.candidateId?: string`, `RunRefineDeps.expandOneCandidate?: (candidateId: string) => Promise<RegionCandidate | null>` — Task 5 (the refine route) constructs these.

- [ ] **Step 1: Add the optional input field and dep**

In `apps/web/lib/search/run-refine.ts`, change:

```ts
export interface RunRefineInput {
  searchId: string;
  regionId: string;
}
```

to:

```ts
export interface RunRefineInput {
  searchId: string;
  regionId: string;
  candidateId?: string;
}
```

Change:

```ts
export interface RunRefineDeps {
  confirmThreshold: number;
  getQueryImagePath: (searchId: string) => Promise<string>;
  expandRegion: (regionId: string) => Promise<RegionCandidate[]>;
  readImage: (path: string) => Promise<string | null>;
  verify: (queryBase64: string, candidateBase64: string[]) => Promise<VerifyResult[]>;
  persist: (args: PersistRefineArgs) => Promise<SearchCandidate[]>;
  onProgress?: (verified: number, total: number) => void;
}
```

to:

```ts
export interface RunRefineDeps {
  confirmThreshold: number;
  getQueryImagePath: (searchId: string) => Promise<string>;
  expandRegion: (regionId: string) => Promise<RegionCandidate[]>;
  /** Only needed when input.candidateId is present. */
  expandOneCandidate?: (candidateId: string) => Promise<RegionCandidate | null>;
  readImage: (path: string) => Promise<string | null>;
  verify: (queryBase64: string, candidateBase64: string[]) => Promise<VerifyResult[]>;
  persist: (args: PersistRefineArgs) => Promise<SearchCandidate[]>;
  onProgress?: (verified: number, total: number) => void;
}
```

- [ ] **Step 2: Use `expandOneCandidate` when `candidateId` is present**

Change:

```ts
  const region = await deps.expandRegion(input.regionId);
```

to:

```ts
  const region: RegionCandidate[] = input.candidateId
    ? await (async () => {
        if (!deps.expandOneCandidate) {
          throw new Error("expandOneCandidate dep is required when input.candidateId is set");
        }
        const one = await deps.expandOneCandidate(input.candidateId);
        return one ? [one] : [];
      })()
    : await deps.expandRegion(input.regionId);
```

The rest of `runRefine` (the missing-image skip loop, the chunked verify-with-retry loop, `onProgress`, the final `persist` call) is unchanged — it already operates on whatever `region` array it's given, one item or many.

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/search/run-refine.ts
git commit -m "feat(web): runRefine supports refining a single candidate via expandOneCandidate"
```

---

### Task 5: wire `candidateId` into the refine route

**Files:**
- Modify: `apps/web/app/api/models/[modelId]/refine/route.ts`

**Interfaces:**
- Consumes: `expandOneCandidate` (Task 2), `RunRefineDeps.expandOneCandidate`/`RunRefineInput.candidateId` (Task 4).

- [ ] **Step 1: Import and wire it**

In `apps/web/app/api/models/[modelId]/refine/route.ts`, change the import:

```ts
import { expandRegionCandidates } from "../../../../../lib/search/refine-retrieval";
```

to:

```ts
import { expandRegionCandidates, expandOneCandidate } from "../../../../../lib/search/refine-retrieval";
```

Change:

```ts
        expandRegion: (regionId) => expandRegionCandidates(pool, regionId),
```

to:

```ts
        expandRegion: (regionId) => expandRegionCandidates(pool, regionId),
        expandOneCandidate: (candidateId) => expandOneCandidate(pool, candidateId),
```

Change:

```ts
        const result = await runRefine(deps, { searchId: body.searchId, regionId: body.regionId });
```

to:

```ts
        const result = await runRefine(deps, {
          searchId: body.searchId,
          regionId: body.regionId,
          candidateId: body.candidateId,
        });
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

With a real search open and a region that has 3+ candidates, POST to `/api/models/lumi-preview/refine` with `{ searchId, regionId, candidateId: "<one candidate's id>" }` (e.g. via the browser devtools or curl) and confirm via `docker exec netryx-db psql -U netryx -d netryx_dev -c "SELECT id, indexed_image_id, similarity_score, verification_score, rank, status FROM search_candidates WHERE region_id = '<regionId>' ORDER BY rank;"` that only the targeted candidate's `verification_score` changed, but `rank` was recomputed across the whole region.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/api/models/[modelId]/refine/route.ts"
git commit -m "feat(web): accept candidateId in the refine route for per-candidate refine"
```

---

### Task 6: `BottomSummaryBar` gets a zone-refine button and gets mounted

**Files:**
- Modify: `apps/web/app/components/BottomSummaryBar.tsx`
- Modify: `apps/web/app/components/SearchDashboard.tsx`
- Modify: `apps/web/app/components/ResultsPageClient.tsx`

**Interfaces:**
- Produces: `BottomSummaryBar({ onRefine, refining }: { onRefine: (regionId: string) => void; refining: boolean })` — a real, rendered component (currently dead code, imported but never mounted anywhere in the app).

- [ ] **Step 1: Give `BottomSummaryBar` the new props and button**

Replace the full content of `apps/web/app/components/BottomSummaryBar.tsx`:

```tsx
// apps/web/app/components/BottomSummaryBar.tsx
"use client";

import { useSearchStore } from "../stores/useSearchStore";
import { useReverseGeocode } from "../lib/useReverseGeocode";
import { formatCoords } from "../lib/coords";
import { streetViewMapsUrl } from "../lib/street-view-maps-url";

export function BottomSummaryBar({
  onRefine,
  refining,
}: {
  onRefine: (regionId: string) => void;
  refining: boolean;
}) {
  const { regions, selectedRegionId, candidatesByRegion } = useSearchStore();
  const region = regions.find((r) => r.id === selectedRegionId) ?? regions[0];
  const top = region ? candidatesByRegion[region.id]?.[0] : undefined;
  const place = useReverseGeocode(region?.centroid.lat ?? 0, region?.centroid.lng ?? 0);
  if (!region) return null;

  const confirmed = top?.status === "confirmed";
  const pct = Math.round((top?.verificationScore ?? region.aggregateScore) * 100);
  return (
    <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between border-t border-border bg-panel/80 px-6 py-3 backdrop-blur-md">
      <div className="flex gap-10">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-subtle">Identificado</div>
          <div className="mt-0.5 text-sm text-fg">{place ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-subtle">Coordenadas</div>
          {top ? (
            <a
              href={streetViewMapsUrl(top.panoId, top.heading)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block font-mono text-sm text-fg hover:underline"
              title="Abrir en Google Maps (Street View, mismo ángulo de la foto)"
            >
              {formatCoords(top.lat, top.lng)}
            </a>
          ) : (
            <div className="mt-0.5 font-mono text-sm text-fg">
              {region ? formatCoords(region.centroid.lat, region.centroid.lng) : "—"}
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-subtle">Radio de búsqueda</div>
          <div className="mt-0.5 text-sm text-fg">~{(region.radiusM / 1000).toFixed(2)} km</div>
        </div>
        <div className="flex flex-col justify-center">
          <button
            onClick={() => onRefine(region.id)}
            disabled={refining}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
          >
            {refining ? "Refinando…" : "Refinar toda esta zona"}
          </button>
        </div>
      </div>
      <div className="text-right">
        <div className="text-2xl font-medium text-accent-fg">{pct}%</div>
        <div className="text-[10px] uppercase tracking-wider text-subtle">
          {confirmed ? "confirmado" : "coincidencia"}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `SearchDashboard.tsx`**

Find this block (around line 335-344):

```tsx
      {regions.length > 0 && (
        <div className="absolute right-0 top-0 h-full w-[520px]">
          <ResultsPanel
            queryImageUrl={queryImageUrl}
            queryImageId={queryImageId}
            onRefine={handleRefine}
            refining={refining}
          />
        </div>
      )}
```

Change it to:

```tsx
      {regions.length > 0 && (
        <>
          <div className="absolute right-0 top-0 h-full w-[520px]">
            <ResultsPanel
              queryImageUrl={queryImageUrl}
              queryImageId={queryImageId}
              onRefine={handleRefine}
              refining={refining}
            />
          </div>
          <BottomSummaryBar onRefine={handleRefine} refining={refining} />
        </>
      )}
```

(`BottomSummaryBar` is already imported at the top of this file — the import just wasn't used until now.)

- [ ] **Step 3: Mount it in `ResultsPageClient.tsx`**

Add the import:

```ts
import { BottomSummaryBar } from "./BottomSummaryBar";
```

Change:

```tsx
      {regions.length > 0 && (
        <div className="absolute right-0 top-0 h-full w-[520px]">
          <ResultsPanel
            queryImageUrl={`/api/images/query/${searchId}`}
            queryImageId={null}
            onRefine={handleRefine}
            refining={refining}
          />
        </div>
      )}
```

to:

```tsx
      {regions.length > 0 && (
        <>
          <div className="absolute right-0 top-0 h-full w-[520px]">
            <ResultsPanel
              queryImageUrl={`/api/images/query/${searchId}`}
              queryImageId={null}
              onRefine={handleRefine}
              refining={refining}
            />
          </div>
          <BottomSummaryBar onRefine={handleRefine} refining={refining} />
        </>
      )}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run a real search in both flows this app has (the live dashboard, and a shared `/results/[searchId]` link) and confirm `BottomSummaryBar` now actually renders at the bottom of the screen (it never did before this task), showing the selected region's info plus the new "Refinar toda esta zona" button, and that clicking it refines the region exactly like the old per-candidate button used to.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/BottomSummaryBar.tsx apps/web/app/components/SearchDashboard.tsx apps/web/app/components/ResultsPageClient.tsx
git commit -m "feat(web): mount BottomSummaryBar with a zone-wide refine button"
```

---

### Task 7: `CandidateComparisonCard` splits into zone-refine vs. per-candidate-refine

**Files:**
- Modify: `apps/web/app/components/CandidateComparisonCard.tsx`

**Interfaces:**
- Produces: new props `showZoneRefine: boolean`, `onRefineCandidate: (candidateId: string, regionId: string) => void` (replacing the unconditional `onRefine` usage for the button specifically — `onRefine` itself is no longer a prop this component needs at all, since the zone-wide trigger moved to `BottomSummaryBar`). Task 8 (`ResultsPanel.tsx`, `OtherCandidatesList.tsx`) wires these at each call site.

- [ ] **Step 1: Rewrite the props and the button block**

Replace the full content of `apps/web/app/components/CandidateComparisonCard.tsx`:

```tsx
"use client";
import { RingGauge } from "./RingGauge";
import { Badge } from "./Badge";
import { PhotoComparison } from "./PhotoComparison";
import { formatCoords } from "../lib/coords";
import { streetViewMapsUrl } from "../lib/street-view-maps-url";
import { useReverseGeocode } from "../lib/useReverseGeocode";
import type { SearchCandidate } from "@netryx/shared-types";

export function CandidateComparisonCard({
  candidate,
  queryImageUrl,
  showZoneRefine,
  onRefineCandidate,
  refining,
}: {
  candidate: SearchCandidate;
  queryImageUrl: string | null;
  /** True only for the top candidate's card — the zone-wide "Refinar toda
   * esta zona" trigger lives in BottomSummaryBar instead, so this card
   * renders no refine button of its own in that case. False for every
   * other candidate, which gets its own "Refinar este candidato" button. */
  showZoneRefine: boolean;
  onRefineCandidate: (candidateId: string, regionId: string) => void;
  refining: boolean;
}) {
  const place = useReverseGeocode(candidate.lat, candidate.lng);
  const verified = candidate.verificationScore != null;
  const score = candidate.verificationScore ?? candidate.similarityScore;

  return (
    <div className="rounded-card border border-border bg-elevated p-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <RingGauge value={score} tone={candidate.status === "confirmed" ? "accent" : "muted"} />
          <div>
            <div className="text-sm text-fg">{place ?? "Localizando…"}</div>
            <div className="text-[11px] text-muted">
              {Math.round(score * 100)}% {verified ? "verificación" : "similitud"}
            </div>
          </div>
        </div>
        <Badge tone={candidate.status === "confirmed" ? "accent" : "muted"}>
          {candidate.status === "confirmed" ? "confirmado" : "sin verificar"}
        </Badge>
      </div>

      {queryImageUrl && (
        <PhotoComparison
          queryImageUrl={queryImageUrl}
          candidateImageUrl={`/api/images/indexed/${candidate.indexedImageId}`}
        />
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <a
          href={streetViewMapsUrl(candidate.panoId, candidate.heading)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-xs text-muted hover:text-fg hover:underline"
          title="Abrir en Google Maps (Street View, mismo ángulo de la foto)"
        >
          {formatCoords(candidate.lat, candidate.lng)}
        </a>
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(formatCoords(candidate.lat, candidate.lng));
          }}
          className="text-subtle hover:text-fg"
          title="Copiar coordenadas"
          aria-label="Copiar coordenadas"
        >
          ⧉
        </button>
      </div>

      {!showZoneRefine && candidate.regionId && !verified && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRefineCandidate(candidate.id, candidate.regionId!);
          }}
          disabled={refining}
          className="mt-2 w-full rounded-md bg-accent py-2 text-xs font-medium text-black disabled:opacity-50"
        >
          {refining ? "Refinando…" : "Refinar este candidato"}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: errors in `ResultsPanel.tsx` and `OtherCandidatesList.tsx` (Task 8 fixes these — they still pass the old `onRefine` prop this component no longer accepts).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/CandidateComparisonCard.tsx
git commit -m "feat(web): CandidateComparisonCard shows per-candidate refine only for non-top candidates"
```

(Committing here is intentional even though the typecheck has known, already-anticipated errors in two other files — Task 8 fixes them immediately next; this keeps each commit's diff focused on one file's actual change.)

---

### Task 8: thread `onRefineCandidate` through `ResultsPanel.tsx` and `OtherCandidatesList.tsx`

**Files:**
- Modify: `apps/web/app/components/ResultsPanel.tsx`
- Modify: `apps/web/app/components/OtherCandidatesList.tsx`
- Modify: `apps/web/app/components/SearchDashboard.tsx`
- Modify: `apps/web/app/components/ResultsPageClient.tsx`

**Interfaces:**
- Consumes: `CandidateComparisonCard`'s new `showZoneRefine`/`onRefineCandidate` props (Task 7).
- Produces: `ResultsPanel`'s prop signature gains `onRefineCandidate: (candidateId: string, regionId: string) => void`; `SearchDashboard.tsx` and `ResultsPageClient.tsx` each implement a `handleRefineCandidate` sibling to their existing `handleRefine`.

- [ ] **Step 1: `OtherCandidatesList.tsx` — accept and thread `onRefineCandidate`, drop `onRefine`**

Replace the full content of `apps/web/app/components/OtherCandidatesList.tsx`:

```tsx
// apps/web/app/components/OtherCandidatesList.tsx
"use client";
import { useEffect, useState } from "react";
import { RingGauge } from "./RingGauge";
import { Badge } from "./Badge";
import { CandidateComparisonCard } from "./CandidateComparisonCard";
import type { SearchCandidate } from "@netryx/shared-types";

const PAGE_SIZE = 6;

export function OtherCandidatesList({
  candidates,
  queryImageUrl,
  onRefineCandidate,
  refining,
}: {
  candidates: SearchCandidate[];
  queryImageUrl: string | null;
  onRefineCandidate: (candidateId: string, regionId: string) => void;
  refining: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));

  useEffect(() => {
    setPage(0);
    setExpandedId(null);
  }, [candidates]);

  if (candidates.length === 0) return null;

  const start = page * PAGE_SIZE;
  const pageItems = candidates.slice(start, start + PAGE_SIZE);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10.5px] uppercase tracking-wide text-subtle">
          Otros ángulos en esta zona · {candidates.length}
        </span>
        {pageCount > 1 && (
          <span className="text-[10px] text-subtle">
            {start + 1}–{Math.min(start + PAGE_SIZE, candidates.length)} de {candidates.length}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {pageItems.map((c) => {
          const isExpanded = expandedId === c.id;
          const score = c.verificationScore ?? c.similarityScore;
          return isExpanded ? (
            <div key={c.id} onClick={() => setExpandedId(null)} className="cursor-pointer">
              <CandidateComparisonCard
                candidate={c}
                queryImageUrl={queryImageUrl}
                showZoneRefine={false}
                onRefineCandidate={onRefineCandidate}
                refining={refining}
              />
            </div>
          ) : (
            <div
              key={c.id}
              onClick={() => setExpandedId(c.id)}
              className="flex cursor-pointer items-center gap-2.5 rounded-card border border-border p-2.5 transition-colors hover:border-white/20 hover:bg-white/[.03]"
            >
              <img
                src={`/api/images/indexed/${c.indexedImageId}`}
                alt=""
                className="h-11 w-11 shrink-0 rounded-md object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <RingGauge value={score} size={16} tone={c.status === "confirmed" ? "accent" : "muted"} />
                  <Badge tone={c.status === "confirmed" ? "accent" : "muted"}>
                    {c.status === "confirmed" ? "confirmado" : "sin verificar"}
                  </Badge>
                </div>
                <span className="truncate text-[12.5px] text-fg">
                  {Math.round(score * 100)}% {c.verificationScore != null ? "verificación" : "similitud"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="mt-2.5 flex items-center justify-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPage((p) => Math.max(0, p - 1));
            }}
            disabled={page === 0}
            className="rounded-md px-2 py-1 text-[11px] text-muted hover:text-fg disabled:opacity-30 disabled:hover:text-muted"
          >
            ← Anterior
          </button>
          <span className="text-[10.5px] text-subtle">
            Página {page + 1} de {pageCount}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPage((p) => Math.min(pageCount - 1, p + 1));
            }}
            disabled={page >= pageCount - 1}
            className="rounded-md px-2 py-1 text-[11px] text-muted hover:text-fg disabled:opacity-30 disabled:hover:text-muted"
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `ResultsPanel.tsx` — accept `onRefineCandidate`, pass `showZoneRefine={true}` to the top candidate, thread `onRefineCandidate` to `OtherCandidatesList`**

In `apps/web/app/components/ResultsPanel.tsx`, change the component's prop signature from:

```tsx
export function ResultsPanel({
  queryImageUrl,
  queryImageId,
  onRefine,
  refining = false,
}: {
  queryImageUrl: string | null;
  queryImageId: string | null;
  onRefine: (regionId: string) => void;
  refining?: boolean;
}) {
```

to:

```tsx
export function ResultsPanel({
  queryImageUrl,
  queryImageId,
  onRefineCandidate,
  refining = false,
}: {
  queryImageUrl: string | null;
  queryImageId: string | null;
  onRefineCandidate: (candidateId: string, regionId: string) => void;
  refining?: boolean;
}) {
```

Change the top-candidate's `CandidateComparisonCard` usage from:

```tsx
          {top && (
            <CandidateComparisonCard
              candidate={top}
              queryImageUrl={queryImageUrl}
              onRefine={onRefine}
              refining={refining}
            />
          )}
          <OtherCandidatesList
            candidates={rest}
            queryImageUrl={queryImageUrl}
            onRefine={onRefine}
            refining={refining}
          />
```

to:

```tsx
          {top && (
            <CandidateComparisonCard
              candidate={top}
              queryImageUrl={queryImageUrl}
              showZoneRefine={true}
              onRefineCandidate={onRefineCandidate}
              refining={refining}
            />
          )}
          <OtherCandidatesList
            candidates={rest}
            queryImageUrl={queryImageUrl}
            onRefineCandidate={onRefineCandidate}
            refining={refining}
          />
```

(`showZoneRefine={true}` on the top candidate means its card renders no refine button of its own at all — per Task 7's `CandidateComparisonCard`, the button only appears when `!showZoneRefine`. The zone-wide trigger for the top candidate's region lives in `BottomSummaryBar` now, per Task 6.)

- [ ] **Step 3: `SearchDashboard.tsx` — add `handleRefineCandidate`, update `ResultsPanel` usage**

Add a new function alongside the existing `handleRefine` (mirror its exact SSE-parsing structure, just with `candidateId` in the body and no `region`/`flyToPoint` side effect at the end — that navigation-on-confirm behavior stays specific to whole-zone refine):

```ts
  async function handleRefineCandidate(candidateId: string, regionId: string) {
    if (!currentSearchId) return;
    selectRegion(regionId);
    setRefining();

    const res = await fetch(`/api/models/${activeModelId}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ searchId: currentSearchId, regionId, candidateId }),
    });
    if (!res.ok || !res.body) return setError(`El refinado falló (HTTP ${res.status})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const raw = part.replace(/^data: /, "");
        if (!raw) continue;
        const event = JSON.parse(raw) as
          | { type: "progress"; verified: number; total: number; etaMs: number | null }
          | { type: "done"; result: { candidates: import("@netryx/shared-types").SearchCandidate[] } }
          | { type: "error"; message: string };
        if (event.type === "progress") {
          setRefineProgress({ verified: event.verified, total: event.total, etaMs: event.etaMs });
        } else if (event.type === "done") {
          setRefineResults(regionId, event.result.candidates);
        } else if (event.type === "error") {
          setError(event.message);
        }
      }
    }
  }
```

Change the `ResultsPanel` usage:

```tsx
          <ResultsPanel
            queryImageUrl={queryImageUrl}
            queryImageId={queryImageId}
            onRefine={handleRefine}
            refining={refining}
          />
```

to:

```tsx
          <ResultsPanel
            queryImageUrl={queryImageUrl}
            queryImageId={queryImageId}
            onRefineCandidate={handleRefineCandidate}
            refining={refining}
          />
```

- [ ] **Step 4: `ResultsPageClient.tsx` — same pair of changes**

Add, alongside the existing `handleRefine`:

```ts
  async function handleRefineCandidate(candidateId: string, regionId: string) {
    selectRegion(regionId);
    setRefining();
    setRefiningLocal(true);

    const res = await fetch(`/api/models/${activeModelId}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ searchId, regionId, candidateId }),
    });
    if (!res.ok || !res.body) {
      setRefiningLocal(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const raw = part.replace(/^data: /, "");
        if (!raw) continue;
        const event = JSON.parse(raw);
        if (event.type === "done") setRefineResults(regionId, event.result.candidates);
      }
    }
    setRefiningLocal(false);
  }
```

Change the `ResultsPanel` usage:

```tsx
            <ResultsPanel
              queryImageUrl={`/api/images/query/${searchId}`}
              queryImageId={null}
              onRefine={handleRefine}
              refining={refining}
            />
```

to:

```tsx
            <ResultsPanel
              queryImageUrl={`/api/images/query/${searchId}`}
              queryImageId={null}
              onRefineCandidate={handleRefineCandidate}
              refining={refining}
            />
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (this resolves the errors anticipated at the end of Task 7).

- [ ] **Step 6: Manual verification**

Run a real search with a region that has 3+ candidates. Expand a non-top candidate — confirm it shows "Refinar este candidato" (not "Refinar aquí"). Click it, confirm only that candidate gets a fresh `verification_score` in the DB (same query as Task 5's verification step) while the rest of the region's ranks update around it.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/components/ResultsPanel.tsx apps/web/app/components/OtherCandidatesList.tsx apps/web/app/components/SearchDashboard.tsx apps/web/app/components/ResultsPageClient.tsx
git commit -m "feat(web): wire per-candidate refine end to end from non-top candidate cards"
```

---

### Task 9: `WidgetGrid` gains a `columns` mode, `Widget` gains `tooltip`

**Files:**
- Modify: `apps/web/app/components/WidgetGrid.tsx`
- Modify: `apps/web/app/components/widgets/types.ts`

**Interfaces:**
- Produces: `WidgetGrid({ widgets, columns = 1 }: { widgets: Widget[]; columns?: 1 | 2 })`; `Widget.tooltip?: string`. Task 11 (`ResultsPanel.tsx`) and Task 12 (`ResultsWidgetsPopup.tsx`) both use `columns`; Task 10's three widget files stop needing their own internal tooltip once `WidgetGrid` renders it from `Widget.tooltip`.

- [ ] **Step 1: Add `tooltip` to `Widget`**

In `apps/web/app/components/widgets/types.ts`, change:

```ts
export interface Widget {
  id: string;
  title: string;
  icon: JSX.Element;
  colSpan: 1 | 2 | 4;
  locked: boolean;
  defaultExpanded: boolean;
  render: () => JSX.Element;
}
```

to:

```ts
export interface Widget {
  id: string;
  title: string;
  icon: JSX.Element;
  colSpan: 1 | 2 | 4;
  locked: boolean;
  defaultExpanded: boolean;
  render: () => JSX.Element;
  /** Shown as an InfoTooltip next to the title in WidgetGrid's own header
   * row — widgets themselves no longer render their own internal
   * icon+title+tooltip header (spec: docs/superpowers/specs/2026-07-21-
   * results-widgets-popup-and-per-candidate-refine-design.md). */
  tooltip?: string;
}
```

- [ ] **Step 2: Add `columns` and render the tooltip**

Replace the full content of `apps/web/app/components/WidgetGrid.tsx`:

```tsx
// apps/web/app/components/WidgetGrid.tsx
"use client";
import { useState } from "react";
import type { Widget } from "./widgets/types";
import { InfoTooltip } from "./InfoTooltip";

export function WidgetGrid({ widgets, columns = 1 }: { widgets: Widget[]; columns?: 1 | 2 }) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(widgets.filter((w) => w.defaultExpanded).map((w) => w.id))
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const anyExpanded = expanded.size > 0;

  return (
    <div
      className={`flex h-full flex-col border-l border-border bg-panel/80 backdrop-blur-md transition-[width] duration-300 ${
        columns === 1 && anyExpanded ? "w-full" : columns === 1 ? "w-[230px]" : "w-full"
      }`}
    >
      <div
        className={anyExpanded || columns === 2 ? "grid flex-1 auto-rows-min gap-2.5 overflow-y-auto p-3" : "flex-1"}
        style={
          anyExpanded || columns === 2
            ? { gridTemplateColumns: columns === 2 ? "repeat(2, 1fr)" : "1fr" }
            : undefined
        }
      >
        {widgets.map((widget) => {
          const isExpanded = expanded.has(widget.id);
          const gridColumn =
            columns === 1
              ? "1 / -1"
              : widget.colSpan === 4
                ? "1 / -1"
                : "span 1";
          return (
            <div key={widget.id} style={anyExpanded || columns === 2 ? { gridColumn } : undefined}>
              <button
                onClick={() => toggle(widget.id)}
                className="flex w-full items-center gap-2 border-b border-white/[.08] px-3.5 py-2.5 text-left"
              >
                <span className="text-fg">{widget.icon}</span>
                <span className="flex-1 text-[11.5px] font-medium text-fg">{widget.title}</span>
                {widget.tooltip && <InfoTooltip text={widget.tooltip} />}
                <svg
                  width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  className={`text-subtle transition-transform ${isExpanded ? "rotate-180" : ""}`}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {isExpanded && <div className="p-3.5 pt-2">{widget.render()}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

(`columns === 1` keeps today's exact icon-rail collapse behavior — `w-[230px]` when nothing is expanded, `w-full` once something is, and no grid template at all until something's expanded, matching the original file precisely. `columns === 2` always uses the 2-column grid and always full width, since it's only ever used inside the popup's own fixed-width `FloatingCard`.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (the `columns` prop is optional, so `ResultsPanel.tsx`'s current `<WidgetGrid widgets={widgets} />` call — not yet updated to pass `columns` explicitly — still compiles).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/WidgetGrid.tsx apps/web/app/components/widgets/types.ts
git commit -m "feat(web): WidgetGrid supports a 2-column mode and a shared per-widget tooltip"
```

---

### Task 10: shared `LockedWidgetOverlay`, remove duplicated headers, fix tooltip clipping

**Files:**
- Create: `apps/web/app/components/widgets/LockedWidgetOverlay.tsx`
- Modify: `apps/web/app/components/widgets/EstimatedTimeWidget.tsx`
- Modify: `apps/web/app/components/widgets/WeatherEstimateWidget.tsx`
- Modify: `apps/web/app/components/widgets/DetectedObjectsWidget.tsx`

**Interfaces:**
- Produces: `LockedWidgetOverlay({ label, onInstall }: { label: string; onInstall: () => void })`; each of the three widget files now exports its own icon constant (`SUN_ICON`, `WEATHER_ICON`, `OBJECTS_ICON`) — Task 11 (`ResultsPanel.tsx`) imports these.

- [ ] **Step 1: Create the shared overlay**

```tsx
// apps/web/app/components/widgets/LockedWidgetOverlay.tsx
"use client";

const LOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "jg-lock-breathe 2.6s ease-in-out infinite" }}>
    <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/** Shared lock/blur overlay for a widget whose model isn't installed/active
 * yet — extracted from three identical copies (EstimatedTimeWidget,
 * WeatherEstimateWidget, DetectedObjectsWidget) (spec: docs/superpowers/
 * specs/2026-07-21-results-widgets-popup-and-per-candidate-refine-design.md). */
export function LockedWidgetOverlay({ label, onInstall }: { label: string; onInstall: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0e0f11]/35">
      <div className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white/35">
        {LOCK_ICON}
      </div>
      <button
        onClick={onInstall}
        className="rounded-lg bg-accent px-2.5 py-1.5 text-[9.5px] font-medium text-black transition-transform hover:scale-105 active:scale-90"
      >
        Instalar {label}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: `EstimatedTimeWidget.tsx` — drop the internal header, use the shared overlay, export the icon, drop `overflow-hidden`**

Replace the full content of `apps/web/app/components/widgets/EstimatedTimeWidget.tsx`:

```tsx
"use client";
import { LockedWidgetOverlay } from "./LockedWidgetOverlay";

export const SUN_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 3v2M5 5l1.4 1.4M3 12h2M19 12h2M17.6 6.4L19 5M12 19v2" /><circle cx="12" cy="12" r="4" />
  </svg>
);

/** Position along the semicircle (0h/24h at the edges, 12h at the apex) and a
 * sun color that warms from yellow (noon) to red/orange (edges). */
function markerFor(hour: number): { x: number; y: number; color: string; isNight: boolean } {
  const cx = 88, cy = 92, r = 80;
  const x = 8 + (hour / 24) * 160;
  const dx = x - cx;
  const y = cy - Math.sqrt(Math.max(r * r - dx * dx, 0));
  const distFromNoon = Math.abs(hour - 12) / 12;
  const color = distFromNoon < 0.5
    ? "#f2c94c"
    : distFromNoon < 0.8 ? "#e8863c" : "#d9432e";
  return { x, y, color, isNight: hour < 5 || hour > 19 };
}

function SunGlyph({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill={color} opacity={0.15} />
      <g fill={color}>
        {angles.map((a) => (
          <rect key={a} x={cx - 0.9} y={cy - 10.2} width={1.8} height={3.2} rx={0.9} transform={`rotate(${a} ${cx} ${cy})`} />
        ))}
      </g>
      <circle cx={cx} cy={cy} r={5} fill={color} />
    </g>
  );
}

function MoonGlyph({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill="#e8e8e6" opacity={0.1} />
      <circle cx={cx} cy={cy} r={6.5} fill="#e8e8e6" />
      <circle cx={cx + 3} cy={cy - 3} r={5.6} fill="#0e0f11" />
    </g>
  );
}

export function EstimatedTimeWidget({
  locked, estimatedHour, onInstall,
}: {
  locked: boolean;
  estimatedHour: number | null;
  onInstall: () => void;
}) {
  const hour = estimatedHour ?? 16.4;
  const marker = markerFor(hour);
  const label = `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;

  return (
    <div className="relative rounded-lg">
      <div className={locked ? "blur-[4px] opacity-50" : undefined}>
        <svg
          width="160" height="90" viewBox="0 0 176 100" style={{ display: "block", margin: "0 auto" }}
        >
          <g style={{ transformOrigin: "88px 92px", animation: locked ? undefined : "jg-plane-spin 1.3s cubic-bezier(.2,.85,.35,1) both" }}>
            <path d="M8 92 A80 80 0 0 1 168 92" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth={1.8} />
            {marker.isNight ? <MoonGlyph cx={marker.x} cy={marker.y} /> : <SunGlyph cx={marker.x} cy={marker.y} color={marker.color} />}
          </g>
        </svg>
        <div className="mt-0.5 text-center text-[20px] font-semibold text-fg">{label}</div>
      </div>
      {locked && <LockedWidgetOverlay label="Hora estimada" onInstall={onInstall} />}
    </div>
  );
}
```

- [ ] **Step 3: `WeatherEstimateWidget.tsx` — same treatment**

Replace the full content of `apps/web/app/components/widgets/WeatherEstimateWidget.tsx`:

```tsx
// apps/web/app/components/widgets/WeatherEstimateWidget.tsx
"use client";
import { spanishWeatherLabel } from "../../../lib/weather-label";
import { LockedWidgetOverlay } from "./LockedWidgetOverlay";

export const WEATHER_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="9" cy="10" r="4" /><path d="M9 2v1.5M15.5 5l-1 1.3M2 10h1.5M4 5l1 1.3" /><path d="M5 18a4 4 0 0 1 4-4h6a3.5 3.5 0 0 1 0 7H8a3 3 0 0 1-3-3z" />
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
    <div className="relative rounded-lg">
      <div className={locked ? "blur-[4px] opacity-50" : undefined}>
        <div className="text-center text-[18px] font-semibold text-fg">
          {weather ? spanishWeatherLabel(weather.label) : "—"}
        </div>
        {weather && (
          <div className="mt-0.5 text-center text-[9.5px] text-muted">{Math.round(weather.score * 100)}% confianza</div>
        )}
      </div>
      {locked && <LockedWidgetOverlay label="Clima estimado" onInstall={onInstall} />}
    </div>
  );
}
```

- [ ] **Step 4: `DetectedObjectsWidget.tsx` — same treatment**

Replace the full content of `apps/web/app/components/widgets/DetectedObjectsWidget.tsx`:

```tsx
// apps/web/app/components/widgets/DetectedObjectsWidget.tsx
"use client";
import { LockedWidgetOverlay } from "./LockedWidgetOverlay";

export const OBJECTS_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M20.6 9.5L14 3H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9l6.6-6.5a2 2 0 0 0 0-2.83l-1.4-1.4a2 2 0 0 0-2.6-.13z" /><circle cx="8" cy="15" r="1.2" />
  </svg>
);

export function DetectedObjectsWidget({ onInstall }: { onInstall: () => void }) {
  return (
    <div className="relative rounded-lg">
      <div className="blur-[4px] opacity-50">
        <div className="flex flex-wrap gap-1.5">
          {["farola", "acera", "buzón", "+4 más"].map((tag) => (
            <span key={tag} className="rounded-full border border-white/[.15] px-1.5 py-0.5 text-[9px] text-fg">{tag}</span>
          ))}
        </div>
      </div>
      <LockedWidgetOverlay label="Objetos detectados" onInstall={onInstall} />
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: errors in `ResultsPanel.tsx` (Task 11 fixes these — it still imports and calls the old `InfoTooltip`-having versions of these widgets in a way that no longer matches, and still uses the generic `SEARCH_ICON` for all three).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/widgets/LockedWidgetOverlay.tsx apps/web/app/components/widgets/EstimatedTimeWidget.tsx apps/web/app/components/widgets/WeatherEstimateWidget.tsx apps/web/app/components/widgets/DetectedObjectsWidget.tsx
git commit -m "feat(web): shared LockedWidgetOverlay, drop duplicated per-widget headers, fix tooltip clipping"
```

---

### Task 11: `ResultsPanel.tsx` — real icons, tooltips, `columns={1}`, popup trigger

**Files:**
- Modify: `apps/web/app/components/ResultsPanel.tsx`

**Interfaces:**
- Consumes: `SUN_ICON`/`WEATHER_ICON`/`OBJECTS_ICON` (Task 10), `WidgetGrid`'s `columns` prop and `Widget.tooltip` (Task 9), `ResultsWidgetsPopup` (Task 12 — written in this same task's final step, since the two are used together).

- [ ] **Step 1: Update imports and the widget entries**

In `apps/web/app/components/ResultsPanel.tsx`, change the imports from:

```tsx
import { useSearchStore } from "../stores/useSearchStore";
import { CandidateComparisonCard } from "./CandidateComparisonCard";
import { OtherCandidatesList } from "./OtherCandidatesList";
import { WidgetGrid } from "./WidgetGrid";
import { ExifMetadataWidget } from "./widgets/ExifMetadataWidget";
import { EstimatedTimeWidget } from "./widgets/EstimatedTimeWidget";
import { WeatherEstimateWidget } from "./widgets/WeatherEstimateWidget";
import { DetectedObjectsWidget } from "./widgets/DetectedObjectsWidget";
import type { Widget } from "./widgets/types";
import { hourForLabel } from "../../lib/time-of-day";
```

to:

```tsx
import { useState } from "react";
import { useSearchStore } from "../stores/useSearchStore";
import { CandidateComparisonCard } from "./CandidateComparisonCard";
import { OtherCandidatesList } from "./OtherCandidatesList";
import { WidgetGrid } from "./WidgetGrid";
import { ResultsWidgetsPopup } from "./ResultsWidgetsPopup";
import { ExifMetadataWidget } from "./widgets/ExifMetadataWidget";
import { EstimatedTimeWidget, SUN_ICON } from "./widgets/EstimatedTimeWidget";
import { WeatherEstimateWidget, WEATHER_ICON } from "./widgets/WeatherEstimateWidget";
import { DetectedObjectsWidget, OBJECTS_ICON } from "./widgets/DetectedObjectsWidget";
import type { Widget } from "./widgets/types";
import { hourForLabel } from "../../lib/time-of-day";
```

Change the component's prop signature and body opening (per Task 8's already-applied `onRefineCandidate` rename) to also add popup state:

```tsx
export function ResultsPanel({
  queryImageUrl,
  queryImageId,
  onRefineCandidate,
  refining = false,
}: {
  queryImageUrl: string | null;
  queryImageId: string | null;
  onRefineCandidate: (candidateId: string, regionId: string) => void;
  refining?: boolean;
}) {
  const { queryImageName, candidatesByRegion, selectedRegionId } = useSearchStore();
  const candidates = selectedRegionId ? candidatesByRegion[selectedRegionId] ?? [] : [];
  const [top, ...rest] = candidates;
  const timeOfDay = useSearchStore((s) => s.timeOfDay);
  const estimatedHour = timeOfDay ? hourForLabel(timeOfDay.label) : null;
  const weather = useSearchStore((s) => s.weather);
  const [popupOpen, setPopupOpen] = useState(false);
```

Change the `estimated-time`, `weather`, and `detected-objects` widget entries from:

```tsx
    {
      id: "estimated-time",
      title: "Hora estimada",
      icon: SEARCH_ICON,
      colSpan: 2,
      locked: estimatedHour === null,
      defaultExpanded: estimatedHour !== null,
      render: () => <EstimatedTimeWidget locked={estimatedHour === null} estimatedHour={estimatedHour} onInstall={noop} />,
    },
    {
      id: "weather",
      title: "Clima estimado",
      icon: SEARCH_ICON,
      colSpan: 2,
      locked: weather === null,
      defaultExpanded: weather !== null,
      render: () => <WeatherEstimateWidget locked={weather === null} weather={weather} onInstall={noop} />,
    },
    {
      id: "detected-objects",
      title: "Objetos detectados",
      icon: SEARCH_ICON,
      colSpan: 2,
      locked: true,
      defaultExpanded: false,
      render: () => <DetectedObjectsWidget onInstall={noop} />,
    },
```

to:

```tsx
    {
      id: "estimated-time",
      title: "Hora estimada",
      icon: SUN_ICON,
      tooltip: "Estimado a partir del largo y dirección de las sombras visibles en la foto",
      colSpan: 2,
      locked: estimatedHour === null,
      defaultExpanded: estimatedHour !== null,
      render: () => <EstimatedTimeWidget locked={estimatedHour === null} estimatedHour={estimatedHour} onInstall={noop} />,
    },
    {
      id: "weather",
      title: "Clima estimado",
      icon: WEATHER_ICON,
      tooltip: "Clasificado a partir de la imagen (Wanda)",
      colSpan: 2,
      locked: weather === null,
      defaultExpanded: weather !== null,
      render: () => <WeatherEstimateWidget locked={weather === null} weather={weather} onInstall={noop} />,
    },
    {
      id: "detected-objects",
      title: "Objetos detectados",
      icon: OBJECTS_ICON,
      tooltip: "Detectado por un modelo de reconocimiento de objetos entrenado sobre escenas urbanas",
      colSpan: 2,
      locked: true,
      defaultExpanded: false,
      render: () => <DetectedObjectsWidget onInstall={noop} />,
    },
```

- [ ] **Step 2: Fix `CandidateComparisonCard`/`OtherCandidatesList` usages (already renamed in Task 8, confirm they read `onRefineCandidate` not `onRefine`) and update the `WidgetGrid` call**

Confirm (from Task 8) the top-candidate `<CandidateComparisonCard>` call passes `showZoneRefine={true} onRefineCandidate={onRefineCandidate}` and `<OtherCandidatesList>` passes `onRefineCandidate={onRefineCandidate}` — no change needed here if Task 8 already applied cleanly.

Change the final `return`:

```tsx
  return <WidgetGrid widgets={widgets} />;
```

to:

```tsx
  return (
    <div className="relative flex h-full flex-col">
      <button
        onClick={() => setPopupOpen(true)}
        className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-white/15 bg-panel/80 text-subtle hover:text-fg"
        title="Expandir"
        aria-label="Expandir panel de resultados"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
        </svg>
      </button>
      <WidgetGrid columns={1} widgets={widgets} />
      {popupOpen && <ResultsWidgetsPopup widgets={widgets} onClose={() => setPopupOpen(false)} />}
    </div>
  );
```

- [ ] **Step 3: Write `ResultsWidgetsPopup.tsx`**

```tsx
// apps/web/app/components/ResultsWidgetsPopup.tsx
"use client";
import { WidgetGrid } from "./WidgetGrid";
import { FloatingCard } from "./FloatingCard";
import type { Widget } from "./widgets/types";

export function ResultsWidgetsPopup({ widgets, onClose }: { widgets: Widget[]; onClose: () => void }) {
  const expandedWidgets = widgets.map((w) => ({ ...w, defaultExpanded: true }));

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60">
      <FloatingCard className="w-[900px] max-h-[85vh] overflow-y-auto p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[13.5px] font-medium text-fg">Resultado</span>
          <button onClick={onClose} className="text-subtle hover:text-fg" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <WidgetGrid columns={2} widgets={expandedWidgets} />
      </FloatingCard>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run a real search. Confirm: sidebar widgets show real icons (sun for Hora estimada, cloud for Clima estimado, tag icon for Objetos detectados) with no duplicated title row inside each widget's body; hovering the info icon on any of the three shows its tooltip (previously invisible); clicking the new expand button (top-right of the panel) opens a centered popup with the same widgets laid out 2 per row; closing it returns to the normal single-column sidebar.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/ResultsPanel.tsx apps/web/app/components/ResultsWidgetsPopup.tsx
git commit -m "feat(web): real widget icons/tooltips and a 2-column expand-to-popup view"
```

---

## Self-Review Notes

- **Spec coverage:** Feature 1 (generalized persistRefine + single-candidate refine) → Tasks 1-5. Feature 2 (relocate/relabel refine buttons) → Tasks 6-8. Feature 3 (WidgetGrid columns + popup) → Tasks 9, 11 (popup itself written inside Task 11 since it's used immediately alongside the expand button — noted in Task 11's own header). Feature 4 (widget visual fixes: shared overlay, no duplicate header, real icons, tooltip clipping) → Tasks 9, 10, 11. Every section of the spec has a task.
- **Non-goals respected:** `run-refine.ts`'s chunking/retry/onProgress mechanics untouched (Task 4 only changes which candidates get fed in); `DetectedObjectsWidget`'s locked state is unconditional as before (Task 10 doesn't add a `locked` prop to it, matching the spec's explicit non-goal); sidebar width (`w-[520px]`) and icon-rail collapse behavior for `columns:1` are both left exactly as today (Task 9).
- **Type consistency:** `onRefineCandidate: (candidateId: string, regionId: string) => void` is the exact same signature in `CandidateComparisonCard` (Task 7), `OtherCandidatesList` (Task 8), `ResultsPanel` (Task 8, 11), and both `handleRefineCandidate` implementations (Task 8) — no drift. `RegionCandidate` (Task 2, 4) is reused unchanged, not redefined. `Widget.tooltip?: string` (Task 9) is consumed identically by `WidgetGrid` (Task 9) and populated identically by `ResultsPanel` (Task 11) for all three fixed widgets.
- **Task order:** Tasks 1→5 are a strict dependency chain (shared type → new retrieval function → generalized persist → run-refine wiring → route wiring). Task 6 (BottomSummaryBar) has no dependency on 1-5 and could run in parallel conceptually, but is sequenced after so the whole refine backend is solid before wiring its zone-wide UI trigger. Tasks 7-8 depend on nothing from 1-6 except the fact that a real per-candidate refine endpoint now exists (Task 5) for `handleRefineCandidate` to call. Tasks 9-11 (widgets/popup) are entirely independent of the refine work and could be done first or in parallel — sequenced last here only because they were investigated last.
