# Refine Results Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat, all-regions-at-once results list with a comparison-first flow — the selected region's top candidate shown immediately with a side-by-side photo comparison, its region-mates collapsed below (expandable in place) — implemented directly as the first `WidgetGrid` entry alongside the existing Exif/EstimatedTime/Weather/DetectedObjects widgets.

**Architecture:** Pure rendering change scoped to `apps/web/app/components/*` — no store, API, or worker changes. `ResultsPanel.tsx` becomes `WidgetGrid`-based; a new `CandidateComparisonCard` (place, score, side-by-side photos, refine button) is used both for the pinned top candidate and for any expanded row in the new `OtherCandidatesList`. `TopResultCard.tsx` and `RefinedCandidateCard.tsx` are deleted, their content absorbed into the new components.

**Tech Stack:** Next.js App Router, React (client components), Tailwind, Zustand (`useSearchStore`, unchanged).

## Global Constraints

- No changes to `useSearchStore`, API routes, or the worker — `regions`/`candidatesByRegion`/`selectedRegionId` already have everything needed (spec's Data Flow section).
- Region switching stays map-only (`ConfidenceCircleLayer.tsx`, already working — do not touch it).
- Geometric verification ("Refinar aquí") stays a manual per-candidate action — never auto-triggered.
- No DOM/component-render tests for any of these components — matches this codebase's existing convention for `ResultsPanel`/`TopResultCard` (neither has a test file today). Verify with `tsc --noEmit` and manual browser use.
- Reuse existing pieces exactly: `RingGauge` (score ring), `Badge` (status pill), `formatCoords`/`streetViewMapsUrl`/`useReverseGeocode` (coords row), `WidgetGrid`/`Widget` type from `apps/web/app/components/widgets/types.ts`.
- Spanish UI copy, matching existing tone (see `ResultRow`/`RefinedCandidateCard` today: "similitud", "verificación", "confirmado", "Refinar aquí", "Refinando…").

---

## File Structure

**Created:**
- `apps/web/app/components/PhotoComparison.tsx` — presentational side-by-side query-vs-candidate image pair (extracted from `RefinedCandidateCard`'s markup).
- `apps/web/app/components/CandidateComparisonCard.tsx` — one candidate's full comparison block (place, score+badge, `PhotoComparison`, coords row, refine button) — used for both the pinned top candidate and any expanded row below.
- `apps/web/app/components/OtherCandidatesList.tsx` — collapsed rows for a region's non-top candidates; clicking a row expands it in place into a `CandidateComparisonCard`.

**Modified:**
- `apps/web/app/components/ResultsPanel.tsx` — rewritten: region-scoped (not all-regions-flattened), returns `<WidgetGrid widgets={...}>` with a "search-results" widget (using the two components above) plus the existing Exif/EstimatedTime/Weather/DetectedObjects widgets, none of which are wired into any UI today.
- `apps/web/app/components/SearchDashboard.tsx` — adds `queryImageId` state (the query image's library id, needed by `ExifMetadataWidget`), drops the `TopResultCard` render and the now-dead `handleSelectRegion`/`onSelectRegion` plumbing, updates the `ResultsPanel` call site.

**Deleted:**
- `apps/web/app/components/TopResultCard.tsx` (content absorbed into `ResultsPanel`'s new top slot).
- `apps/web/app/components/RefinedCandidateCard.tsx` (content absorbed into `CandidateComparisonCard`).

---

### Task 1: `PhotoComparison` — shared side-by-side image component

**Files:**
- Create: `apps/web/app/components/PhotoComparison.tsx`

**Interfaces:**
- Produces: `PhotoComparison({ queryImageUrl, candidateImageUrl }: { queryImageUrl: string; candidateImageUrl: string }): JSX.Element` — later tasks import this exact name/signature.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/PhotoComparison.tsx
"use client";

export function PhotoComparison({
  queryImageUrl,
  candidateImageUrl,
}: {
  queryImageUrl: string;
  candidateImageUrl: string;
}) {
  return (
    <div className="mt-3 flex gap-1.5">
      <div className="min-w-0 flex-1">
        <img
          src={queryImageUrl}
          alt="Tu foto"
          className="aspect-[4/3] w-full rounded-md border border-border object-cover"
        />
        <div className="mt-1 text-[10px] text-subtle">Tu foto</div>
      </div>
      <div className="min-w-0 flex-1">
        <img
          src={candidateImageUrl}
          alt="Street View"
          className="aspect-[4/3] w-full rounded-md border border-accent-fg/40 object-cover"
        />
        <div className="mt-1 text-[10px] text-accent-fg">Street View</div>
      </div>
    </div>
  );
}
```

This is `RefinedCandidateCard.tsx`'s existing `<img>` pair (lines 30-47 of that file today), extracted verbatim with `src`s parameterized instead of hardcoded to `searchId`/`indexedImageId` — `CandidateComparisonCard` (Task 2) computes those URLs and passes them in.

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (this file has no other dependents yet, so this just confirms the file itself is valid TSX).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/PhotoComparison.tsx
git commit -m "feat(web): extract PhotoComparison from RefinedCandidateCard's image pair"
```

---

### Task 2: `CandidateComparisonCard` — one candidate's full comparison block

**Files:**
- Create: `apps/web/app/components/CandidateComparisonCard.tsx`

**Interfaces:**
- Consumes: `PhotoComparison` (Task 1); `RingGauge` from `./RingGauge` (`{ value: number; size?: number; tone?: "accent"|"warning"|"muted" }`); `Badge` from `./Badge` (`{ tone?: "accent"|"draw"|"warning"|"danger"|"muted"; children }`); `formatCoords` from `../lib/coords`; `streetViewMapsUrl` from `../lib/street-view-maps-url`; `useReverseGeocode` from `../lib/useReverseGeocode`; `SearchCandidate` type from `@netryx/shared-types`.
- Produces: `CandidateComparisonCard({ candidate, queryImageUrl, onRefine, refining }: { candidate: SearchCandidate; queryImageUrl: string | null; onRefine: (regionId: string) => void; refining: boolean }): JSX.Element` — Task 3 (`OtherCandidatesList`) and Task 4 (`ResultsPanel`) both render this component with these exact prop names.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/CandidateComparisonCard.tsx
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
  onRefine,
  refining,
}: {
  candidate: SearchCandidate;
  queryImageUrl: string | null;
  onRefine: (regionId: string) => void;
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

      {candidate.regionId && !verified && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRefine(candidate.regionId!);
          }}
          disabled={refining}
          className="mt-2 w-full rounded-md bg-accent py-2 text-xs font-medium text-black disabled:opacity-50"
        >
          {refining ? "Refinando…" : "Refinar aquí"}
        </button>
      )}
    </div>
  );
}
```

Note: `queryImageUrl` here is the browser object-URL string already threaded through `SearchDashboard`/`ResultsPanel` today (NOT `/api/images/query/:searchId` — that route exists but `RefinedCandidateCard` used it as a historical artifact; `ResultsPanel` already receives a real `queryImageUrl` prop from `SearchDashboard`, so this reuses that instead of introducing a second image source for the same photo).

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/CandidateComparisonCard.tsx
git commit -m "feat(web): add CandidateComparisonCard (place+score+photos+refine)"
```

---

### Task 3: `OtherCandidatesList` — collapsed rows, expand in place

**Files:**
- Create: `apps/web/app/components/OtherCandidatesList.tsx`

**Interfaces:**
- Consumes: `CandidateComparisonCard` (Task 2); `RingGauge`, `Badge` (same imports as Task 2); `SearchCandidate` type.
- Produces: `OtherCandidatesList({ candidates, queryImageUrl, onRefine, refining }: { candidates: SearchCandidate[]; queryImageUrl: string | null; onRefine: (regionId: string) => void; refining: boolean }): JSX.Element` — Task 4 (`ResultsPanel`) renders this with these exact prop names.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/app/components/OtherCandidatesList.tsx
"use client";
import { useState } from "react";
import { RingGauge } from "./RingGauge";
import { Badge } from "./Badge";
import { CandidateComparisonCard } from "./CandidateComparisonCard";
import type { SearchCandidate } from "@netryx/shared-types";

export function OtherCandidatesList({
  candidates,
  queryImageUrl,
  onRefine,
  refining,
}: {
  candidates: SearchCandidate[];
  queryImageUrl: string | null;
  onRefine: (regionId: string) => void;
  refining: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (candidates.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="px-0.5 text-[10.5px] uppercase tracking-wide text-subtle">
        Otros ángulos en esta zona · {candidates.length}
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {candidates.map((c) => {
          const isExpanded = expandedId === c.id;
          const score = c.verificationScore ?? c.similarityScore;
          return isExpanded ? (
            <div key={c.id} onClick={() => setExpandedId(null)} className="cursor-pointer">
              <CandidateComparisonCard
                candidate={c}
                queryImageUrl={queryImageUrl}
                onRefine={onRefine}
                refining={refining}
              />
            </div>
          ) : (
            <div
              key={c.id}
              onClick={() => setExpandedId(c.id)}
              className="flex cursor-pointer items-center justify-between rounded-card border border-border p-2.5"
            >
              <div className="flex items-center gap-2">
                <RingGauge value={score} size={16} tone={c.status === "confirmed" ? "accent" : "muted"} />
                <span className="text-[12.5px] text-fg">
                  {Math.round(score * 100)}% {c.verificationScore != null ? "verificación" : "similitud"}
                </span>
              </div>
              <Badge tone={c.status === "confirmed" ? "accent" : "muted"}>
                {c.status === "confirmed" ? "confirmado" : "sin revisar"}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Clicking the expanded card's own body (outside the refine/copy/link buttons, which all call `e.stopPropagation()`) collapses it again — a lightweight toggle, not a separate "close" control.

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/OtherCandidatesList.tsx
git commit -m "feat(web): add OtherCandidatesList (collapsed rows, expand in place)"
```

---

### Task 4: Rewrite `ResultsPanel.tsx` around `WidgetGrid`

**Files:**
- Modify: `apps/web/app/components/ResultsPanel.tsx` (full rewrite)

**Interfaces:**
- Consumes: `CandidateComparisonCard` (Task 2), `OtherCandidatesList` (Task 3), `WidgetGrid`/`Widget` from `./WidgetGrid`/`./widgets/types`, `ExifMetadataWidget` (`{ imageId: string; estimatedTime: string | null }`), `EstimatedTimeWidget` (`{ locked: boolean; estimatedHour: number | null; onInstall: () => void }`), `WeatherEstimateWidget`/`DetectedObjectsWidget` (both `{ onInstall: () => void }`) — all four already exist under `./widgets/*` from Tasks 19-21, never wired into any UI until now.
- Produces: `ResultsPanel({ queryImageUrl, queryImageId, onRefine, refining }: { queryImageUrl: string | null; queryImageId: string | null; onRefine: (regionId: string) => void; refining?: boolean }): JSX.Element` — note `onSelectRegion` is DROPPED (region switching is map-only, spec's explicit decision) and `queryImageId` is NEW (Task 5 adds it to `SearchDashboard`).

- [ ] **Step 1: Write the new file**

```tsx
// apps/web/app/components/ResultsPanel.tsx
"use client";

import { useSearchStore } from "../stores/useSearchStore";
import { CandidateComparisonCard } from "./CandidateComparisonCard";
import { OtherCandidatesList } from "./OtherCandidatesList";
import { WidgetGrid } from "./WidgetGrid";
import { ExifMetadataWidget } from "./widgets/ExifMetadataWidget";
import { EstimatedTimeWidget } from "./widgets/EstimatedTimeWidget";
import { WeatherEstimateWidget } from "./widgets/WeatherEstimateWidget";
import { DetectedObjectsWidget } from "./widgets/DetectedObjectsWidget";
import type { Widget } from "./widgets/types";

const SEARCH_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

// No real model behind these three yet (Tasks 20-21) — always locked,
// no install endpoint to call, so onInstall is a no-op. Matches how these
// widgets already render standalone (never wired into ResultsPanel before
// this task).
function noop() {}

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
  const { queryImageName, candidatesByRegion, selectedRegionId } = useSearchStore();
  const candidates = selectedRegionId ? candidatesByRegion[selectedRegionId] ?? [] : [];
  const [top, ...rest] = candidates;

  const widgets: Widget[] = [
    {
      id: "search-results",
      title: "Resultado",
      icon: SEARCH_ICON,
      colSpan: 2,
      locked: false,
      defaultExpanded: true,
      render: () => (
        <>
          <div className="flex items-center gap-3 pb-3">
            {queryImageUrl && <img src={queryImageUrl} alt="" className="h-14 w-14 rounded-md object-cover" />}
            <span className="truncate font-mono text-xs text-muted">{queryImageName}</span>
          </div>
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
        </>
      ),
    },
    {
      id: "exif",
      title: "Metadatos EXIF",
      icon: SEARCH_ICON,
      colSpan: 1,
      locked: false,
      defaultExpanded: true,
      render: () => (queryImageId ? <ExifMetadataWidget imageId={queryImageId} estimatedTime={null} /> : <div className="text-[9.5px] text-muted">Sin imagen de consulta.</div>),
    },
    {
      id: "estimated-time",
      title: "Hora estimada",
      icon: SEARCH_ICON,
      colSpan: 1,
      locked: true,
      defaultExpanded: false,
      render: () => <EstimatedTimeWidget locked={true} estimatedHour={null} onInstall={noop} />,
    },
    {
      id: "weather",
      title: "Clima estimado",
      icon: SEARCH_ICON,
      colSpan: 1,
      locked: true,
      defaultExpanded: false,
      render: () => <WeatherEstimateWidget onInstall={noop} />,
    },
    {
      id: "detected-objects",
      title: "Objetos detectados",
      icon: SEARCH_ICON,
      colSpan: 1,
      locked: true,
      defaultExpanded: false,
      render: () => <DetectedObjectsWidget onInstall={noop} />,
    },
  ];

  return <WidgetGrid widgets={widgets} />;
}
```

`SEARCH_ICON` is reused as a placeholder icon for every widget entry here — each widget component already renders its own icon internally (see `ExifMetadataWidget`'s camera-metadata rows, `EstimatedTimeWidget`'s sun glyph, etc.), so the `WidgetGrid` header icon is only a small collapsed-state indicator, not a design-critical detail. Pick distinct SVGs per widget if you want closer visual polish, but a single shared icon is not a functional bug.

- [ ] **Step 2: Typecheck (will show errors from SearchDashboard.tsx until Task 5 — expected, not this task's failure)**

Run: `cd apps/web && npx tsc --noEmit`
Expected: errors ONLY in `SearchDashboard.tsx` about `ResultsPanel`'s prop mismatch (missing `queryImageId`, unexpected `onSelectRegion`) — `ResultsPanel.tsx` itself must show no errors. If `ResultsPanel.tsx` itself has errors, fix those before proceeding; the `SearchDashboard.tsx` errors are resolved in Task 5.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/ResultsPanel.tsx
git commit -m "feat(web): rewrite ResultsPanel around WidgetGrid with comparison-first top candidate"
```

---

### Task 5: Wire `SearchDashboard.tsx` — `queryImageId`, drop `TopResultCard`/`onSelectRegion`

**Files:**
- Modify: `apps/web/app/components/SearchDashboard.tsx`

**Interfaces:**
- Consumes: `ResultsPanel`'s new signature from Task 4 (`{ queryImageUrl, queryImageId, onRefine, refining }`, no `onSelectRegion`).
- Produces: nothing new for later tasks — this is the last wiring point.

- [ ] **Step 1: Add `queryImageId` state and capture it in `handleTriggerSearch`**

In `apps/web/app/components/SearchDashboard.tsx`, add the state next to `queryImageUrl` (around line 38):

```tsx
  const [queryImageUrl, setQueryImageUrl] = useState<string | null>(null);
  const [queryImageId, setQueryImageId] = useState<string | null>(null);
```

In `handleTriggerSearch`, `imageIds[0]` (built a few lines below, in the `for (const s of selected)` loop) is the query image's library id — capture it right after the loop finishes, before the batch-search fetch:

```tsx
      const { ok, data } = await fetchJson<{ batchId: string }>("/api/search/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageIds, modelId: activeModelId }),
      });
      if (!ok || !data) throw new Error("No se pudo iniciar la búsqueda por lotes");

      setQueryImageId(imageIds[0] ?? null);
      pollBatchProgress(data.batchId, queryImageName);
```

(Insert the `setQueryImageId(...)` line immediately before the existing `pollBatchProgress(...)` line.)

- [ ] **Step 2: Remove `TopResultCard` import/render and the now-dead `handleSelectRegion`**

Remove the import:

```tsx
import { TopResultCard } from "./TopResultCard";
```

Remove `handleSelectRegion` entirely (nothing else calls it — `ConfidenceCircleLayer.tsx`'s own map-click handler already calls `selectRegion`/`flyToRegion` directly, independent of this function):

```tsx
  function handleSelectRegion(regionId: string) {
    selectRegion(regionId);
    const region = regions.find((r) => r.id === regionId);
    if (region) flyToRegion(map, region);
  }
```

- [ ] **Step 3: Update the render block**

Replace:

```tsx
      {regions.length > 0 && (
        <>
          <TopResultCard onRefine={handleRefine} onSelectRegion={handleSelectRegion} refining={refining} />
          <div className="absolute right-0 top-0 h-full">
            <ResultsPanel queryImageUrl={queryImageUrl} onRefine={handleRefine} onSelectRegion={handleSelectRegion} refining={refining} />
          </div>
        </>
      )}
```

with:

```tsx
      {regions.length > 0 && (
        <div className="absolute right-0 top-0 h-full">
          <ResultsPanel
            queryImageUrl={queryImageUrl}
            queryImageId={queryImageId}
            onRefine={handleRefine}
            refining={refining}
          />
        </div>
      )}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors anywhere.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/SearchDashboard.tsx
git commit -m "feat(web): wire queryImageId, drop TopResultCard and onSelectRegion plumbing"
```

---

### Task 6: Delete `TopResultCard.tsx` and `RefinedCandidateCard.tsx`

**Files:**
- Delete: `apps/web/app/components/TopResultCard.tsx`
- Delete: `apps/web/app/components/RefinedCandidateCard.tsx`

**Interfaces:** none — this task only removes now-dead files.

- [ ] **Step 1: Confirm nothing else imports either file**

Run: `cd apps/web && grep -rn "TopResultCard\|RefinedCandidateCard" app | grep -v "app/components/TopResultCard.tsx\|app/components/RefinedCandidateCard.tsx"`
Expected: no output (Task 5 already removed `SearchDashboard.tsx`'s only reference to `TopResultCard`; `RefinedCandidateCard` had no other callers besides the old `ResultsPanel.tsx`, already rewritten in Task 4).

- [ ] **Step 2: Delete both files**

```bash
git rm apps/web/app/components/TopResultCard.tsx apps/web/app/components/RefinedCandidateCard.tsx
```

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `cd apps/web && npx tsc --noEmit && npx vitest run`
Expected: clean typecheck; all tests passing except the pre-existing unrelated `app/api/health/logs/route.test.ts` flake (documented earlier in this project's history — reads a real worker log file present in some dev environments, unrelated to this change).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(web): remove TopResultCard/RefinedCandidateCard, absorbed into the new comparison components"
```

---

### Task 7: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Typecheck and test the whole web app**

Run: `cd apps/web && npx tsc --noEmit && npx vitest run`
Expected: clean, same result as Task 6 Step 3.

- [ ] **Step 2: Manual smoke check**

Start the app (this repo's usual dev command), run a real search end to end, and confirm:
- The top-scoring candidate for the auto-selected region shows immediately with the side-by-side photo comparison (no manual click needed to see it).
- "Refinar aquí" still works and updates that same card in place (score switches from similitud to verificación, badge switches to "confirmado") — it does not disappear or get replaced by a separate card.
- Clicking another candidate in "Otros ángulos en esta zona" expands it in place with its own comparison + its own "Refinar aquí", without moving or hiding the top card.
- Clicking a different region on the map swaps the whole panel to that region's own top candidate + its own other-candidates list.
- The Exif/EstimatedTime/Weather/DetectedObjects widgets render alongside the results widget in the same `WidgetGrid` (collapsed by default except Exif, matching `WidgetGrid`'s existing `defaultExpanded` behavior).

- [ ] **Step 3: Fix anything found, then final commit if needed**

```bash
git add -A
git commit -m "fix: address issues found during manual verification"
```
