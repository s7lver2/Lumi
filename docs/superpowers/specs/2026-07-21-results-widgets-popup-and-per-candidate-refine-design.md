# Widget redesign + 2-column results popup + per-candidate refine — design spec

Status: approved (design phase) — implementation not started.

## Context

Three related results-panel changes requested together:

1. The widget panel (EXIF/Hora estimada/Clima estimado/Objetos detectados) needs a visual pass — several concrete issues found on investigation, not just vague polish:
   - `ResultsPanel.tsx`'s widget entries all use the same generic magnifying-glass icon instead of each widget's own real icon (sun, weather, lock, etc.) — those icons exist in each widget file but go unused.
   - Every widget's `render()` duplicates a full icon+title+`InfoTooltip` header row *inside* its own content, even though `WidgetGrid.tsx`'s collapsible header row already shows the icon and title — a redundant double header per widget.
   - The lock/blur overlay for locked widgets (`EstimatedTimeWidget`, `WeatherEstimateWidget`, `DetectedObjectsWidget`) is copy-pasted identically three times.
   - `InfoTooltip` doesn't show on hover for any of these three widgets — confirmed root cause: each widget's outer wrapper is `relative overflow-hidden rounded-lg`, and the tooltip renders `absolute bottom-[135%]` (above the icon), which the wrapper's `overflow-hidden` clips off-screen.
2. The whole widget panel should be expandable into a popup with a 2-column layout; the normal sidebar view stays exactly as it is today (effectively single column).
3. Refine gets a second, more precise mode: today, clicking refine on *any* candidate always re-verifies the *entire* region — there is no way to refine just one candidate. This spec adds real single-candidate refine, and relocates/relabels the trigger:
   - The top candidate's card no longer has its own refine button; a new **"Refinar toda esta zona"** button lives in `BottomSummaryBar` (region-wide, always visible for the selected region, not gated on any one candidate's verification state).
   - Every other (non-top) candidate's card gets **"Refinar este candidato"**, which refines *only* that candidate.

## Goals

- Real single-candidate refine that doesn't corrupt the region's overall ranking.
- Zone-wide refine surfaced once, in `BottomSummaryBar`, not duplicated per-candidate.
- A `WidgetGrid` that can render in 1 or 2 columns, and a popup that hosts the 2-column view.
- Each widget shows its real icon, has no duplicate internal header, and its tooltip is visible.

## Non-goals

- No change to `run-refine.ts`'s per-candidate verification mechanics (chunking, retry-once-then-score-0 fallback) — only what gets verified (one candidate vs. the whole region) and how the result gets ranked/persisted.
- No change to `DetectedObjectsWidget`'s "no real model yet" locked state — it gets the same shared-overlay/icon/tooltip fixes as the other two widgets, nothing about its underlying data.
- No change to the sidebar's own width (`w-[520px]` in `ResultsPageClient.tsx`) or its icon-rail-collapse behavior when nothing is expanded.

## Feature 1: generalized `persistRefine` + single-candidate refine

### Why the naive version is wrong

`persistRefine` currently ranks and writes `rank`/`status` for exactly the rows in `args.scored` — correct today only because `scored` always happens to be the *entire* region (that's all `runRefine` ever builds). If a single-candidate refine passed a 1-item `scored` array through unchanged, that one candidate would always land at `rank: 1` and, if it clears the confirm threshold, `status: "confirmed"` — regardless of how its score actually compares to the rest of the region's already-known candidates.

### The fix: merge with the region's existing rows before ranking

`persistRefine` (`apps/web/lib/search/refine-persist.ts`) changes to always operate over the *whole region*, whether one or all of its candidates were just verified:

1. Query the region's full current `search_candidates` rows (`region_id = $1`), each with whatever `similarity_score`/`verification_score` it currently has.
2. Overlay `args.scored` on top — for any candidate present in both, `args.scored`'s fresh `verificationScore` wins; for the rest, keep whatever they already have.
3. Compute an effective score per candidate: `verification_score ?? similarity_score` (same "best available score" convention already used for display, e.g. in `CandidateComparisonCard.tsx`).
4. Sort all of them by effective score, descending; reassign `rank` 1..N for the *whole region*.
5. `status = "confirmed"` only for `rank === 1` **and** that candidate has a real (non-null) `verification_score` **and** it clears `confirmThreshold` — a candidate that was never actually verified can't become "confirmed" just by sorting to the top on similarity alone.
6. Write `rank`/`status` for every row in the region; write `verification_score` only for rows that were actually in `args.scored` this call (never overwrite an unrelated candidate's real score with something it doesn't have).

This is a strict generalization: when `args.scored` already covers every region candidate (today's whole-zone refine), step 2's "existing rows" and `args.scored` are the same set, so behavior is unchanged from today.

### API change

`RefineRequest` (`packages/shared-types/src/search.ts`) gains an optional field:

```ts
export interface RefineRequest {
  searchId: string;
  regionId: string;
  /** When present, refine verifies ONLY this one candidate instead of the
   * whole region (spec: docs/superpowers/specs/2026-07-21-results-widgets-
   * popup-and-per-candidate-refine-design.md). Absent = today's whole-zone
   * behavior. */
  candidateId?: string;
}
```

`expandRegionCandidates` (`apps/web/lib/search/refine-retrieval.ts`) gains a sibling function for the single-candidate case:

```ts
export async function expandOneCandidate(pool: Pool, candidateId: string): Promise<RegionCandidate | null>
```

— looks up one `search_candidates` row by its own `id` (joined to `indexed_images` the same way `expandRegionCandidates` does), returning `null` if it doesn't exist.

`runRefine` (`apps/web/lib/search/run-refine.ts`) gains an optional `candidateId` on its input; when present, it calls a new `expandOneCandidate` dep instead of `expandRegion`, verifies that single candidate through the existing chunked-verify loop (chunk size 1 already, no change needed there), and passes the single-item `scored` array to the now-generalized `persist`.

The refine route (`apps/web/app/api/models/[modelId]/refine/route.ts`) passes `body.candidateId` through into `runRefine`'s input, and wires the new `expandOneCandidate` dep (used only when `candidateId` is present).

## Feature 2: relocate/relabel the refine buttons

- `BottomSummaryBar.tsx` gains a new button, **"Refinar toda esta zona"**, calling the existing `onRefine(regionId)` — but `BottomSummaryBar` doesn't currently receive `onRefine`/`refining` at all; these need to be threaded in from wherever `BottomSummaryBar` is rendered (same place `ResultsPanel` already receives them — check `ResultsPageClient.tsx`/`AppShell` composition for the exact prop path before writing the plan's tasks). Disabled while `refining` is true, same as today's per-candidate button.
- `CandidateComparisonCard.tsx`'s existing button (currently "Refinar aquí", calling `onRefine(candidate.regionId)`) is removed *only* from the top candidate's rendering context; for every other candidate it becomes **"Refinar este candidato"**, calling a new prop `onRefineCandidate(candidate.id)` instead of the region-wide `onRefine`. Since `CandidateComparisonCard` is used for both the top candidate (in `ResultsPanel.tsx`) and any expanded non-top candidate (in `OtherCandidatesList.tsx`), it needs a way to know which button (if any) to show — simplest: a new prop `showZoneRefine: boolean` (true only for the top-candidate call site) that the component uses to pick which button (if either) to render, rather than duplicating the whole component.
- `onRefineCandidate` threads down the same path `onRefine` already does (`ResultsPageClient.tsx`'s `handleRefine` gains a sibling `handleRefineCandidate(regionId, candidateId)` that POSTs the same endpoint with `candidateId` included, and calls `setRefineResults` the same way on completion).

## Feature 3: `WidgetGrid` 1/2-column modes + popup

`WidgetGrid.tsx` gains a `columns?: 1 | 2` prop, default `1`:

- `columns: 1` (today's sidebar): grid template forced to `"1fr"`; every widget's cell is `gridColumn: "1 / -1"` regardless of `colSpan` — i.e., always one full-width column, ignoring `colSpan` entirely. This guarantees the sidebar is genuinely single-column no matter what `colSpan` values `ResultsPanel.tsx` assigns, rather than relying on `auto-fill` sizing math to happen to produce one column.
- `columns: 2`: grid template `"repeat(2, 1fr)"`; a widget's cell spans both columns (`gridColumn: "1 / -1"`) if its `colSpan` is `4`, otherwise one column (`gridColumn: "span 1"`). (`colSpan: 1` doesn't occur anywhere today; treated the same as `2` — one column — since there's no third column to occupy.)
- The collapsed-to-icon-rail behavior (`anyExpanded` toggling the whole grid's own width between `w-[230px]`/`w-full`) stays as-is for `columns: 1`; the popup (below) doesn't use that width toggle at all, since its own container width comes from the modal, not from `WidgetGrid`.

New `ResultsWidgetsPopup.tsx`:

- Same modal convention as `MismatchDialog.tsx`: `fixed inset-0 z-30 flex items-center justify-center bg-black/60` backdrop, content in a `FloatingCard` (e.g. `w-[900px] max-h-[85vh] overflow-y-auto p-5`).
- Renders `<WidgetGrid columns={2} widgets={widgets.map((w) => ({ ...w, defaultExpanded: true }))} />` — every widget starts expanded in the popup (the whole point of opening it is to see everything at once; no need to duplicate `WidgetGrid`'s own per-widget collapse state management, it already supports per-widget toggling if the user wants to collapse one back down).
- A close button (`✕`, top-right of the card, same visual convention as `BackgroundJobsTray`'s dismiss button).

`ResultsPanel.tsx` adds local `popupOpen` state, a small expand-icon button near the top of the panel (opens the popup), renders `<WidgetGrid columns={1} widgets={widgets} />` as it does today, and conditionally renders `<ResultsWidgetsPopup widgets={widgets} onClose={() => setPopupOpen(false)} />` when `popupOpen`.

## Feature 4: widget visual fixes

- **Shared lock overlay**: new `apps/web/app/components/widgets/LockedWidgetOverlay.tsx`, extracted from the three copy-pasted blocks:

```tsx
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

  (`LOCK_ICON` moves into this file too, exported once instead of duplicated three times.) `EstimatedTimeWidget`, `WeatherEstimateWidget`, `DetectedObjectsWidget` all use this instead of their own inline copy.

- **Remove the duplicated per-widget header**: each of the four widgets (`ExifMetadataWidget` doesn't have this problem — it never had its own header) stops rendering its own icon+title+`InfoTooltip` row. `Widget` (`apps/web/app/components/widgets/types.ts`) gains an optional `tooltip?: string` field; `WidgetGrid.tsx`'s existing header row renders `<InfoTooltip text={widget.tooltip} />` right after the title, only when `tooltip` is present. `ResultsPanel.tsx`'s widget entries carry each widget's real icon (imported from that widget's own file, now exported) and the tooltip text that used to live inside the widget component.

- **Fix tooltip clipping**: each of the three widgets' outer wrapper changes from `relative overflow-hidden rounded-lg` to `relative rounded-lg` (dropping `overflow-hidden`) — the lock overlay is already `absolute inset-0` with its own `rounded-*` elements inside it, so losing the outer clip has no visible effect on the overlay itself, but stops it from clipping the tooltip that renders above the (now-removed) internal header. Since the header moves to `WidgetGrid.tsx` (Feature 4's previous point), the tooltip icon now lives in a location `WidgetGrid`'s own markup controls, which has no `overflow-hidden` ancestor — this fix matters primarily for anything else absolutely positioned inside these widgets' own content (none currently, but keeps the wrapper from re-introducing the same bug for future content).

## Testing

None — per explicit instruction, this plan omits test-writing steps. Verify manually: single-candidate refine against a real region with 3+ candidates (confirm only the clicked one's `verification_score` changes, but everyone's `rank` can shift); zone-wide refine from `BottomSummaryBar` still refines everyone as today; popup opens/closes, shows 2 columns, sidebar stays 1 column; tooltip hover works on all three previously-broken widgets; each widget shows its real icon with no duplicate header.
