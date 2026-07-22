# Free Street-Level Imagery Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Mapillary and KartaView as free, alternative street-imagery sources alongside Google Street View, with a coverage-comparison step before indexing and automatic per-point provider fallback by priority order.

**Architecture:** A `StreetImageryProvider` interface (`checkCoverage` + `downloadForPoint`) with three implementations (`google-provider.ts` wrapping the existing `street-view.ts` unchanged, plus new `mapillary-provider.ts` and `kartaview-provider.ts`). A new orchestrator tries providers in a user-set priority order per sampled point, falling through to the next provider when one has no coverage there. New `provider`/`attribution` columns on `indexed_images` record which provider sourced each row and its CC-BY-SA credit where required. Only Google-sourced rows count against the existing cost tracking.

**Tech Stack:** Node/TypeScript (apps/worker), Next.js/TypeScript (apps/web for the coverage-comparison UI and settings), Postgres.

## Global Constraints

- No tests in this plan — every task ends with implementation + a typecheck step + a commit. Do not write Vitest tests anywhere in this plan.
- The existing Google path (`apps/worker/src/street-view.ts`) is wrapped, never rewritten — `google-provider.ts` calls its existing exported functions as-is.
- Commits use `git add <specific files>`, never `git add -A` or `git add .`.

---

### Task 1: Provider interface + shared types

**Files:**
- Create: `apps/worker/src/imagery-providers/types.ts`

**Interfaces:**
- Produces: `CapturedImage`, `StreetImageryProvider` — every later provider implementation and the orchestrator (Task 5) depend on these exact shapes.

- [ ] **Step 1: Write the shared types**

```ts
// apps/worker/src/imagery-providers/types.ts
import type { SampledPoint } from "@netryx/shared-types";

export type ImageryProviderId = "google" | "mapillary" | "kartaview";

export interface CapturedImage {
  provider: ImageryProviderId;
  /** The provider's own identifier for this image (Google pano_id, Mapillary image id, KartaView id). */
  sourceId: string;
  /** As-captured heading in degrees — a fixed set of 4 for Google (one request per heading), whatever the real camera bearing was for Mapillary/KartaView (0 to N images per point, each with its own heading). */
  heading: number;
  lat: number;
  lng: number;
  captureDate: string | null;
  imageBase64: string;
  /** CC-BY-SA contributor credit — null for Google (no attribution requirement), populated for Mapillary/KartaView. */
  attribution: string | null;
}

export interface StreetImageryProvider {
  id: ImageryProviderId;
  /** Lightweight — no image downloads. Returns which of the given points have at least one available image from this provider. */
  checkCoverage(points: SampledPoint[]): Promise<Set<string>>;
  /** Downloads whatever images this provider has for one point — 0 to 4 for Google (headings-based), 0 to N for Mapillary/KartaView (as-captured). */
  downloadForPoint(point: SampledPoint): Promise<CapturedImage[]>;
}

/** Stable per-point key used by checkCoverage's returned Set and by the
 * orchestrator (Task 5) to look up a point's coverage result — avoids
 * relying on object identity across the two calls. */
export function pointKey(point: SampledPoint): string {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
```

Expected: no errors (this file has no callers yet, so this just confirms it parses).

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/imagery-providers/types.ts
git commit -m "feat(worker): add StreetImageryProvider interface for multi-provider imagery"
```

---

### Task 2: Google provider (wraps existing code, unchanged behavior)

**Files:**
- Create: `apps/worker/src/imagery-providers/google-provider.ts`

**Interfaces:**
- Consumes: `types.ts` (Task 1), the existing exported functions in `apps/worker/src/street-view.ts` (read this file fresh — already confirmed this session it exports `downloadCaptures` and has internal `fetchMetadata`/`fetchImage` helpers that are NOT exported; this task may need to export `fetchMetadata` from `street-view.ts` for `checkCoverage` to reuse it without duplicating the request logic — check before writing new duplicate fetch code).
- Produces: `createGoogleProvider(apiKey: string): StreetImageryProvider` — a factory (API key isn't known until the caller reads it from settings, so this is a factory, not a plain object export).

- [ ] **Step 1: Export `fetchMetadata` from `street-view.ts`**

In `apps/worker/src/street-view.ts`, change `async function fetchMetadata(` to `export async function fetchMetadata(` — this is the same free Metadata-endpoint call `downloadCaptures` already uses internally before any paid image fetch; reusing it for `checkCoverage` avoids a second implementation of the same request.

- [ ] **Step 2: Write the Google provider wrapper**

```ts
// apps/worker/src/imagery-providers/google-provider.ts
import type { SampledPoint } from "@netryx/shared-types";
import { downloadCaptures, fetchMetadata } from "../street-view";
import type { CapturedImage, StreetImageryProvider } from "./types";
import { pointKey } from "./types";

const STREET_VIEW_HEADINGS = [0, 90, 180, 270] as const;

export function createGoogleProvider(apiKey: string): StreetImageryProvider {
  return {
    id: "google",
    async checkCoverage(points) {
      const covered = new Set<string>();
      for (const point of points) {
        for (const heading of STREET_VIEW_HEADINGS) {
          const meta = await fetchMetadata(point, heading, apiKey).catch(() => null);
          if (meta) {
            covered.add(pointKey(point));
            break;
          }
        }
      }
      return covered;
    },
    async downloadForPoint(point) {
      const { captures } = await downloadCaptures([point], STREET_VIEW_HEADINGS, {
        apiKey,
        maxConcurrent: 1,
        existingPanoHeadings: new Set(),
      });
      return captures.map((c) => ({
        provider: "google" as const,
        sourceId: c.panoId,
        heading: c.heading,
        lat: c.lat,
        lng: c.lng,
        captureDate: c.captureDate,
        imageBase64: c.imageBase64,
        attribution: null,
      }));
    },
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/street-view.ts apps/worker/src/imagery-providers/google-provider.ts
git commit -m "feat(worker): wrap the existing Google Street View logic as a StreetImageryProvider"
```

---

### Task 3: Mapillary provider

**Files:**
- Create: `apps/worker/src/imagery-providers/mapillary-provider.ts`
- Modify: `packages/shared-types/src/settings.ts`

**Interfaces:**
- Consumes: `types.ts` (Task 1).
- Produces: `createMapillaryProvider(accessToken: string): StreetImageryProvider`; a new `MAPILLARY_ACCESS_TOKEN` settings key, editable from `/settings` the same way `GOOGLE_MAPS_API_KEY` already is.

- [ ] **Step 1: Add the settings key**

```ts
// packages/shared-types/src/settings.ts — add to SETTINGS_SCHEMA, after the MAPBOX_TOKEN entry
  {
    key: "MAPILLARY_ACCESS_TOKEN",
    label: "Mapillary access token (opcional — habilita esta fuente gratuita)",
    type: "string",
    isSecret: true,
    required: false,
  },
```

- [ ] **Step 2: Write the Mapillary provider**

Mapillary's Graph API v4 (`https://graph.mapillary.com/images`) takes a `bbox` (west,south,east,north — max 0.01 square degrees per request, confirmed against Mapillary's own API docs this session) and an `Authorization: OAuth <token>` header, returning `id`, `compass_angle`, `thumb_2048_url`, `captured_at`, and a `creator` field for attribution. Build a small bbox (e.g. ±15m) around each point for both coverage-checking and downloading, since Mapillary has no simple point+radius endpoint — a small bbox is the closest equivalent.

```ts
// apps/worker/src/imagery-providers/mapillary-provider.ts
import type { SampledPoint } from "@netryx/shared-types";
import type { CapturedImage, StreetImageryProvider } from "./types";
import { pointKey } from "./types";

const GRAPH_ENDPOINT = "https://graph.mapillary.com/images";
const BBOX_DEGREES = 0.00015; // ~15m at most latitudes — small enough to stay well under the 0.01 sq-degree cap

function bboxFor(point: SampledPoint): string {
  return [
    point.lng - BBOX_DEGREES,
    point.lat - BBOX_DEGREES,
    point.lng + BBOX_DEGREES,
    point.lat + BBOX_DEGREES,
  ].join(",");
}

interface MapillaryImage {
  id: string;
  compass_angle: number | null;
  thumb_2048_url: string;
  captured_at: number | null;
  creator?: { username?: string };
}

async function queryImages(point: SampledPoint, accessToken: string): Promise<MapillaryImage[]> {
  const url = `${GRAPH_ENDPOINT}?fields=id,compass_angle,thumb_2048_url,captured_at,creator&bbox=${bboxFor(point)}`;
  const res = await fetch(url, { headers: { Authorization: `OAuth ${accessToken}` } });
  if (!res.ok) throw new Error(`Mapillary Graph API returned ${res.status}`);
  const body = (await res.json()) as { data: MapillaryImage[] };
  return body.data ?? [];
}

export function createMapillaryProvider(accessToken: string): StreetImageryProvider {
  return {
    id: "mapillary",
    async checkCoverage(points) {
      const covered = new Set<string>();
      for (const point of points) {
        const images = await queryImages(point, accessToken).catch(() => []);
        if (images.length > 0) covered.add(pointKey(point));
      }
      return covered;
    },
    async downloadForPoint(point) {
      const images = await queryImages(point, accessToken).catch(() => []);
      const captures: CapturedImage[] = [];
      for (const img of images) {
        const imgRes = await fetch(img.thumb_2048_url);
        if (!imgRes.ok) continue;
        const buf = await imgRes.arrayBuffer();
        captures.push({
          provider: "mapillary",
          sourceId: img.id,
          heading: img.compass_angle ?? 0,
          lat: point.lat,
          lng: point.lng,
          captureDate: img.captured_at ? new Date(img.captured_at).toISOString() : null,
          imageBase64: Buffer.from(buf).toString("base64"),
          attribution: img.creator?.username ? `Mapillary — ${img.creator.username}` : "Mapillary",
        });
      }
      return captures;
    },
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /home/s7lver/Lumi/packages/shared-types && npx tsc --noEmit
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/settings.ts apps/worker/src/imagery-providers/mapillary-provider.ts
git commit -m "feat(worker): add Mapillary as a free StreetImageryProvider"
```

---

### Task 4: KartaView provider

**Files:**
- Create: `apps/worker/src/imagery-providers/kartaview-provider.ts`

**Interfaces:**
- Consumes: `types.ts` (Task 1).
- Produces: `createKartaviewProvider(): StreetImageryProvider` — no factory argument, since KartaView's public read endpoints need no auth (confirmed this session: "KartaView's public API endpoints do not require authentication").

- [ ] **Step 1: Confirm KartaView's real nearby-photos endpoint before writing code**

This session's research found KartaView's general API docs (`kartaview.org/doc/api-response`) but not a confirmed exact "nearby photos by lat/lng" endpoint path/params/response shape — unlike Mapillary and Google, whose exact request/response shapes were verified. Before writing `kartaview-provider.ts`, fetch `https://kartaview.org/doc/api-response` and (if needed) `https://api.openstreetcam.org/` directly (`curl` or a browser fetch) to confirm: the real endpoint path for "photos near a point," its query param names (likely `lat`/`lng`/`radius` or similar), and the response field names for image id, heading/compass value, and photo URL. Do not guess these field names — this is a real external API contract, not a design choice this plan can specify from research alone.

- [ ] **Step 2: Write the KartaView provider**

Once Step 1's real endpoint/params/fields are confirmed, follow the exact same structure as `mapillary-provider.ts` (Task 3): a `queryImages(point)` helper hitting the confirmed endpoint, `checkCoverage` checking for a non-empty result per point, `downloadForPoint` fetching each image's bytes and mapping to `CapturedImage` with `provider: "kartaview"` and an `attribution` string built from whatever contributor/username field the real API returns (KartaView is also CC-BY-SA — attribution is required here too, not optional).

- [ ] **Step 3: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/imagery-providers/kartaview-provider.ts
git commit -m "feat(worker): add KartaView as a free StreetImageryProvider"
```

---

### Task 5: Schema — provider + attribution columns

**Files:**
- Create: `db/migrations/1721800000000_imagery_provider.js`

**Interfaces:**
- Produces: `indexed_images.provider text NOT NULL DEFAULT 'google'`, `indexed_images.attribution text` (nullable). Task 6's insert path and Task 8's UI both depend on these columns.

- [ ] **Step 1: Write the migration**

```js
// db/migrations/1721800000000_imagery_provider.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE indexed_images ADD COLUMN provider text NOT NULL DEFAULT 'google';`);
  pgm.sql(`ALTER TABLE indexed_images ADD COLUMN attribution text;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE indexed_images DROP COLUMN attribution;`);
  pgm.sql(`ALTER TABLE indexed_images DROP COLUMN provider;`);
};
```

- [ ] **Step 2: Run the migration**

```bash
cd /home/s7lver/Lumi/db && pnpm run migrate:up
```

Expected: output ends with `### MIGRATION 1721800000000_imagery_provider (UP) ###` and exit code 0.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/1721800000000_imagery_provider.js
git commit -m "feat(db): add provider and attribution columns to indexed_images"
```

---

### Task 6: Coverage-check + priority-fallback orchestrator

**Files:**
- Create: `apps/worker/src/imagery-providers/select-provider.ts`

**Interfaces:**
- Consumes: `StreetImageryProvider` (Task 1), the three provider factories (Tasks 2-4).
- Produces: `checkCoverageAcrossProviders(points, providers): Promise<Record<ImageryProviderId, number>>` (coverage counts per provider, for the summary UI in Task 8); `downloadWithFallback(points, orderedProviders): Promise<CapturedImage[]>` (the actual per-point priority-fallback download used by indexing, Task 7).

- [ ] **Step 1: Write the orchestrator**

```ts
// apps/worker/src/imagery-providers/select-provider.ts
import type { SampledPoint } from "@netryx/shared-types";
import type { CapturedImage, ImageryProviderId, StreetImageryProvider } from "./types";
import { pointKey } from "./types";

/** Aggregate coverage count per provider, for the pre-indexing summary UI. */
export async function checkCoverageAcrossProviders(
  points: SampledPoint[],
  providers: StreetImageryProvider[]
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  await Promise.all(
    providers.map(async (provider) => {
      const covered = await provider.checkCoverage(points);
      result[provider.id] = covered.size;
    })
  );
  return result;
}

/**
 * For each point, tries providers in the given priority order, using the
 * first one that actually returns at least one image there — falls
 * through to the next provider if the preferred one has no coverage for
 * that specific point. `orderedProviders` is already sorted by the
 * caller's chosen priority (e.g. [mapillary, kartaview, google]).
 */
export async function downloadWithFallback(
  points: SampledPoint[],
  orderedProviders: StreetImageryProvider[]
): Promise<CapturedImage[]> {
  const captures: CapturedImage[] = [];
  for (const point of points) {
    for (const provider of orderedProviders) {
      const found = await provider.downloadForPoint(point).catch(() => []);
      if (found.length > 0) {
        captures.push(...found);
        break;
      }
    }
  }
  return captures;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/imagery-providers/select-provider.ts
git commit -m "feat(worker): add coverage-check and priority-fallback orchestration across providers"
```

---

### Task 7: Wire the orchestrator into area indexing + cost tracking

**Files:**
- Modify: `apps/worker/src/jobs/index-area.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/db-queries.ts`

**Interfaces:**
- Consumes: `downloadWithFallback` (Task 6), the three provider factories (Tasks 2-4).
- Produces: `insertIndexedImages` (already modified by the Lumi 2 plan's Task 4, if that plan runs first — otherwise modify it fresh here) gains `provider`/`attribution` columns in its INSERT; the area-indexing flow accepts a priority-ordered provider list instead of assuming Google.

- [ ] **Step 1: Read `runIndexAreaJob`'s current full body fresh**

This function's exact current shape (its `deps.downloadCaptures` call site, how `STREET_VIEW_HEADINGS`/`apiKey` reach it, and how `insertIndexedImages`'s call site maps captures to insert rows) needs to be read directly from `apps/worker/src/jobs/index-area.ts` before editing — this plan's earlier tasks confirmed its `deps.downloadCaptures` signature and call site location (~line 132) but not the full surrounding mapping logic, which this step's edits depend on.

- [ ] **Step 2: Replace the single-provider download with the fallback orchestrator**

Change `RunIndexAreaJobDeps`'s `downloadCaptures` dependency to instead accept a `downloadWithFallback: (points: SampledPoint[]) => Promise<CapturedImage[]>` function (the priority order and provider instances are already baked in by the caller in `index.ts`, Step 3 below — the job itself doesn't need to know about providers or priority, only that it gets captures back). Update the call site (~line 132) to call this instead, and update whatever maps `captures` into `insertIndexedImages`'s row shape to also carry each capture's `provider` and `attribution` fields through (previously these fields didn't exist on `StreetViewCapture`; `CapturedImage` from Task 1 already includes them).

- [ ] **Step 3: Build the ordered provider list in `apps/worker/src/index.ts`**

Where `index.ts` currently constructs the `downloadCaptures` dependency for `runIndexAreaJob` (reads `GOOGLE_MAPS_API_KEY` from settings today), also read `MAPILLARY_ACCESS_TOKEN` (may be unset — skip that provider from the priority list entirely if so, rather than constructing a provider that will always fail) and construct `createGoogleProvider(googleApiKey)`, `createMapillaryProvider(mapillaryToken)` (only if token present), `createKartaviewProvider()`. Read the area's stored priority order (see Task 8 for where this gets set/stored) and pass `downloadWithFallback: (points) => downloadWithFallback(points, orderedProviders)` into the deps object.

- [ ] **Step 4: Add `provider`/`attribution` to the insert path**

In `apps/worker/src/db-queries.ts`, `insertIndexedImages`'s INSERT statement and its row-mapping type gain `provider` and `attribution` columns (straightforward column additions to the existing `INSERT INTO indexed_images (...)` statement and its parameter list).

- [ ] **Step 5: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/jobs/index-area.ts apps/worker/src/index.ts apps/worker/src/db-queries.ts
git commit -m "feat(worker): index areas using the priority-ordered multi-provider fallback"
```

---

### Task 8: Coverage-comparison UI + priority-order picker

**Files:**
- Create: `apps/web/app/components/ImageryCoverageSummary.tsx`
- Create: `apps/web/app/api/areas/coverage/route.ts`
- Modify: wherever the area-drawing flow currently triggers indexing (read `apps/web/app/components/AreasManagePanel.tsx` and its draw-polygon flow fresh — the exact current "start indexing" call site needs identifying before this task, since this plan hasn't read that file yet)

**Interfaces:**
- Consumes: `checkCoverageAcrossProviders` (Task 6), exposed over HTTP since this UI work happens in `apps/web`, not `apps/worker` directly (the worker's provider code isn't reachable from the browser — this route needs to either call into a shared package both apps can import, or the worker needs a small HTTP endpoint of its own for this specific coverage-check; confirm which pattern the codebase already uses for web→worker communication, if any exists, before choosing).
- Produces: a coverage summary shown before the user confirms indexing, and a stored priority order passed to Task 7's indexing job.

- [ ] **Step 1: Determine the web↔worker communication path for a live coverage check**

This plan doesn't yet know whether `apps/web` ever calls into `apps/worker`-owned logic directly (they're separate processes) or whether all worker-side work happens only via enqueuing a pg-boss job. Read `apps/web/lib/queue.ts` or equivalent and `apps/worker/src/index.ts`'s job registrations fresh to determine the existing pattern, then either (a) enqueue a new short-lived "check-coverage" pg-boss job that the worker processes and writes a result row the web app polls for, matching the existing `search_batches`-style polling pattern already used elsewhere in this codebase, or (b) move the three provider implementations into a shared package (e.g. `packages/imagery-providers`) importable from both `apps/web` and `apps/worker`, and call `checkCoverageAcrossProviders` directly from the new web API route. Prefer (b) if the provider code has no worker-specific dependencies (it doesn't appear to — plain `fetch` calls) — simpler than adding a new job type and polling UI for what's fundamentally a quick read-only check.

- [ ] **Step 2: Build the coverage summary component and priority picker**

A simple UI: three rows (Mapillary/KartaView/Google) each showing "X% de puntos cubiertos" (from Task 6/7's coverage counts ÷ total sampled points), with drag-to-reorder or up/down buttons to set priority order (reuse whatever simple list-reordering pattern already exists elsewhere in this codebase, if any — otherwise plain up/down arrow buttons per row are sufficient, no drag-and-drop library needed for a 3-item list).

- [ ] **Step 3: Store the chosen priority order and wire it into indexing**

The area-drawing flow's "start indexing" call needs to include the chosen priority order (e.g. `["mapillary", "kartaview", "google"]`) in its request body; the area-creation/indexing-trigger route stores this (a new `areas.provider_priority text[]` column, or reuse an existing per-area config JSON column if one already exists — check `areas` table's current schema before adding a new column) so Task 7's `index.ts` wiring reads it when building the ordered provider list for that specific area's job.

- [ ] **Step 4: Typecheck and build**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit && npx next build
```

Expected: no errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ImageryCoverageSummary.tsx apps/web/app/api/areas/coverage/route.ts
git commit -m "feat(web): show provider coverage comparison and priority order before indexing"
```

(Add whatever `AreasManagePanel.tsx`/schema files Step 3 touches to this same commit.)

---

### Task 9: Attribution display + provider-aware map links

**Files:**
- Modify: `apps/web/app/lib/street-view-maps-url.ts`
- Modify: `apps/web/app/components/PhotoComparison.tsx`
- Modify: `apps/web/app/components/CandidateComparisonCard.tsx`

**Interfaces:**
- Consumes: `indexed_images.provider`/`attribution` (Task 5), already surfaced on `SearchCandidate` if that type includes them — check `@netryx/shared-types`'s `SearchCandidate` shape and the query that populates it (`apps/web/lib/search/retrieval.ts` and wherever `SearchCandidate` rows get assembled for the API response) and add `provider`/`attribution` fields there if missing, before this task's UI changes can read them.

- [ ] **Step 1: Make the "open in map" link provider-aware**

Read `apps/web/app/lib/street-view-maps-url.ts`'s current signature fresh. Add a `provider: ImageryProviderId` parameter (or reuse a plain `string` if this file doesn't want the worker-side type). For `"google"`, keep the existing Google Maps Street View URL construction unchanged. For `"mapillary"`, build `https://www.mapillary.com/app/?pKey=${sourceId}` (Mapillary's own web viewer, confirmed pattern from their public app URL scheme — verify the exact query param name against their current app at implementation time). For `"kartaview"`, build the equivalent KartaView web viewer URL once Task 4's research confirms KartaView's real image-id-to-viewer-URL scheme.

- [ ] **Step 2: Show attribution credit on Mapillary/KartaView-sourced photos**

In `PhotoComparison.tsx`'s candidate-image side (not the query-photo side — attribution only applies to the indexed image, never to the user's own uploaded photo), render the `attribution` string as a small caption beneath the image when `attribution` is non-null (Google-sourced images have `attribution: null` and show nothing extra, matching current behavior exactly).

- [ ] **Step 3: Typecheck and build**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit && npx next build
```

Expected: no errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/lib/street-view-maps-url.ts apps/web/app/components/PhotoComparison.tsx apps/web/app/components/CandidateComparisonCard.tsx
git commit -m "feat(web): provider-aware map links and CC-BY-SA attribution credit for free-source photos"
```

(Add whatever shared-types file Step 1's cross-cutting note required, if any field was added there, to this same commit.)

---

### Task 10: Cost tracking stays Google-only (verification, not new code)

**Files:** none expected — verification task.

- [ ] **Step 1: Confirm cost tracking already only counts Google**

Read `packages/api-usage/src/usage-repo.ts`'s `recordStreetViewUsage` and its call site(s) in `apps/worker` fresh. Confirm the call site is reached only from Google-specific download code (i.e., `google-provider.ts`'s `downloadForPoint`, not `mapillary-provider.ts`/`kartaview-provider.ts`). If Task 7's wiring accidentally calls `recordStreetViewUsage` for every provider's captures rather than only Google's, fix that call site so only `google-provider.ts`-sourced captures increment `api_usage` — this task exists specifically to catch that mistake before it ships, since free-provider captures must never count against the budget.

- [ ] **Step 2: Report to the user**

No commit unless Step 1 found and fixed a real bug (in which case commit that fix with an accurate message describing what was wrong). Otherwise, report that cost tracking was confirmed already correctly scoped to Google-only, and summarize the full feature: three providers, coverage comparison, priority fallback, attribution, provider-aware links.
