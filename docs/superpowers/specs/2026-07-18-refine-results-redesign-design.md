# Refine Results Redesign — Design Spec

## Goal

Replace the current flat, all-candidates-at-once results list with a comparison-first flow: the single best-scoring candidate for the selected region is shown prominently with a side-by-side photo comparison (query photo vs. Street View), and the region's other candidates appear collapsed below it, expandable in place. This redesign is implemented directly as the first entry in the pending `WidgetGrid` bento migration (previously tracked as "Task 23" in the upload-redesign plan), rather than as a separate pass — both touch `ResultsPanel.tsx` and would otherwise duplicate work.

## Problem

Today, once a search returns results:
- `TopResultCard.tsx` floats over the map showing region #1's place name, aggregate score, and a "Refinar" button — text/numbers only, no photos.
- `ResultsPanel.tsx` (the right-side panel) simultaneously renders **every candidate from every region**, flattened into one list (`regions.flatMap(r => candidatesByRegion[r.id] ?? [])`), each row showing only a small `RingGauge` + percentage + coordinates.
- The actual side-by-side photo comparison (`RefinedCandidateCard.tsx`) only appears **after** the user manually clicks "Refinar" on some candidate and geometric verification confirms it.

Seeing every candidate across every region at once, with no photos to compare until after triggering verification, is what the user described as confusing.

## Design

### Data flow (no backend/store changes)

`useSearchStore` already has everything needed:
- `regions: SearchRegion[]` — sorted by `aggregateScore` descending.
- `candidatesByRegion: Record<string, SearchCandidate[]>` — each region's candidates already sorted by rank/similarity.
- `selectedRegionId` — already auto-set to `regions[0]?.id` when results land (`setSearchResults`).

This redesign is purely a rendering change: scope everything to `candidatesByRegion[selectedRegionId]` instead of flattening across all regions, and restructure how the top candidate vs. the rest are displayed.

### Region selection stays on the map

`ConfidenceCircleLayer.tsx` already renders clickable region circles/centroids that call `selectRegion(id)` on click — this is unchanged. The side panel no longer lists other *regions* at all; switching regions only happens via the map.

### `TopComparisonCard` (new component)

Replaces `TopResultCard.tsx`'s content, now living inside `ResultsPanel` instead of floating over the map. Shows, for `candidatesByRegion[selectedRegionId][0]`:
- Place name (reverse-geocoded, same as today) + score: `RingGauge` + percentage, labeled "similitud" before verification or "verificación" after (`verificationScore != null`), matching `ResultRow`'s existing tone logic.
- A status pill: "sin verificar" before refine, "confirmado" after — reusing the `Badge` component's existing tones.
- Side-by-side photos: query photo (`/api/images/query/:searchId`) vs. this candidate's Street View image (`/api/images/indexed/:indexedImageId`) — the same image pairing `RefinedCandidateCard` already uses, just shown immediately with Pass-1 data instead of waiting for confirmation.
- Coordinates row (JetBrains Mono, copy-to-clipboard icon) — same as `ResultRow` today.
- "Refinar aquí" button — same manual trigger as today (`onRefine(regionId)`), becomes "Refinando…" while `refining && selected`, same pattern `ResultRow` already uses. Verification is **not** automatic (confirmed with the user — avoids spending compute on results the user already visually rules out).

Once verified, the card updates in place (score becomes verification score, badge becomes "confirmado") — it does not move or get replaced by a separate `RefinedCandidateCard`; `RefinedCandidateCard.tsx` is retired, its visual pattern absorbed into `TopComparisonCard`.

### `OtherCandidatesList` (new component)

Renders `candidatesByRegion[selectedRegionId].slice(1)` as collapsed rows (rank, `RingGauge`, percentage, status badge — same visual weight as today's `ResultRow`, minus the photos). Clicking a row expands it in place (local component state, not global store) to show that candidate's own side-by-side photo comparison and its own "Refinar aquí" button — confirmed with the user: expansion happens in-line, the `TopComparisonCard` above stays fixed, nothing reorders.

### `ResultsPanel.tsx` restructure

```
export function ResultsPanel({ queryImageUrl, onRefine, onSelectRegion, refining }) {
  const { queryImageName, candidatesByRegion, selectedRegionId } = useSearchStore();
  const candidates = selectedRegionId ? candidatesByRegion[selectedRegionId] ?? [] : [];
  const [top, ...rest] = candidates;

  const widgets: Widget[] = [
    {
      id: "search-results",
      title: "Resultado",
      icon: <SearchIcon />,
      colSpan: 2,
      locked: false,
      defaultExpanded: true,
      render: () => (
        <>
          {/* query photo header, unchanged from today's ResultsPanel */}
          {top && <TopComparisonCard candidate={top} onRefine={onRefine} refining={refining && selectedRegionId === top.regionId} queryImageUrl={queryImageUrl} />}
          {rest.length > 0 && <OtherCandidatesList candidates={rest} onRefine={onRefine} refining={refining} queryImageUrl={queryImageUrl} />}
        </>
      ),
    },
    // ExifMetadataWidget/EstimatedTimeWidget/WeatherEstimateWidget/
    // DetectedObjectsWidget already exist (Tasks 19-21) as React components,
    // not pre-built Widget objects — each needs wrapping in a { id, title,
    // icon, colSpan, locked, defaultExpanded, render } entry the same way
    // "search-results" is above. Exact prop wiring (imageId, estimatedTime,
    // etc.) is an implementation-plan detail, not fixed here.
  ];

  return <WidgetGrid widgets={widgets} />;
}
```

`onSelectRegion` prop is dropped from `ResultsPanel` (no longer needed — region switching is map-only); `SearchDashboard.tsx`'s `<ResultsPanel onSelectRegion={handleSelectRegion} .../>` call site drops that prop. `TopResultCard.tsx` and its render in `SearchDashboard.tsx`/`(idle handling)` are deleted entirely — its floating position over the map is removed, not replaced.

`RefinedCandidateCard.tsx` is deleted (its logic is absorbed into `TopComparisonCard`/`OtherCandidatesList`'s expanded row, which both need the identical side-by-side image markup — likely worth factoring into one small shared `PhotoComparison` presentational component consumed by both, to avoid duplicating the `<img>` pair markup).

### States

- **No candidates in the region yet** (shouldn't happen in practice — a region always has ≥1 candidate that created it — but `top` is guarded with `top &&`).
- **Refining** — button text becomes "Refinando…", disabled, same as today's `ResultRow` pattern. Live progress (`refineProgress`: verified/total/etaMs) rendering location is unchanged by this redesign.
- **Verified/confirmed** — `TopComparisonCard` (or an expanded `OtherCandidatesList` row) updates in place using the now-populated `verificationScore` and `status: "confirmed"`.

## Out of scope

- Any change to the retrieval/verification backend, `useSearchStore`, or the API routes — this is rendering-only.
- Automatic verification of the top candidate (explicitly rejected — stays manual).
- Multi-region candidate list in the side panel (explicitly rejected — region switching is map-only now).

## Testing

Following this codebase's existing convention for this class of component (`ResultsPanel.tsx`/`TopResultCard.tsx` today have no dedicated test files, no DOM/component-render tests anywhere in `apps/web`): no new test files for `TopComparisonCard`/`OtherCandidatesList`/the restructured `ResultsPanel`. Verification is `tsc --noEmit` plus manual browser use, consistent with sibling UI components.
