# Free Street-Level Imagery Providers (Mapillary + KartaView) — Design

## Goal

Add Mapillary and KartaView as free, alternative sources of street-level
imagery for indexing, alongside the existing Google Street View Static
API (never replacing it). Before committing to indexing an area, compare
coverage across all three providers and automatically pick the best
available source per sampled point, by a user-defined priority order.

## Why not just swap providers

Google Street View Static API lets you request an image at **any
heading** for a point — the panorama is synthesized server-side.
Mapillary and KartaView instead return whatever real photos contributors
have actually captured near a point, each with **its own as-captured
heading** — there's no "give me the 90° view" request. Coverage is also
much less predictable (dense in some areas, sparse or empty in others)
than Google's near-universal urban coverage. This is a real data-model
difference, not just a different API key — it's why this needs its own
design rather than a drop-in provider swap.

## 1. Provider abstraction

A new `StreetImageryProvider` interface (apps/worker), with two methods:

- `checkCoverage(points): Promise<CoverageResult>` — lightweight, no
  image downloads. For Google, reuses the existing free Metadata
  endpoint (`street-view.ts` already calls this before any paid image
  fetch). For Mapillary/KartaView, uses their image-search/metadata APIs
  filtered to a small radius per point.
- `downloadCaptures(points, options): Promise<DownloadResult>` — same
  shape `street-view.ts`'s `downloadCaptures` already returns
  (`panoId, heading, lat, lng, captureDate, imageBase64`), so downstream
  code (embedding, storage) doesn't need to know which provider produced
  a capture. For Google this is today's existing function unchanged
  (wrapped, not rewritten). Mapillary/KartaView implementations are new.

Three implementations: `google-provider.ts` (wraps the current
`street-view.ts` logic unchanged), `mapillary-provider.ts`,
`kartaview-provider.ts` (both new).

## 2. Indexing flow: coverage comparison before committing

After drawing the polygon and sampling points along the real street
network (unchanged — sampling is provider-agnostic), a new step runs
`checkCoverage` against all three providers in parallel for the sampled
points and shows an aggregate summary, e.g.:

```
Mapillary: 72% de puntos cubiertos
KartaView: 15% de puntos cubiertos
Google:    98% de puntos cubiertos
```

The user sets a priority order (e.g. Mapillary > KartaView > Google).
Indexing then runs automatically: for each point, try providers in that
order, using the first one with coverage; fall through to the next if
the preferred provider has none there. No per-point manual review —
confirmed as overkill at tens-of-thousands-of-points scale.

## 3. Schema changes

`indexed_images` gains:

- `provider text NOT NULL DEFAULT 'google'` — which of the three sourced
  this row. Existing rows backfill to `'google'` (accurate: it's the only
  provider that has ever existed in this codebase).
- `attribution text` (nullable) — contributor/license credit, populated
  only for Mapillary/KartaView captures (see §4). Null for Google rows.

`pano_id`'s column stays as-is but its meaning becomes "the source
provider's own image identifier" — already generic enough (just a text
column), no rename needed.

The "abrir en mapa" link (`streetViewMapsUrl`, used throughout the
results/candidate UI) becomes provider-aware: Google rows keep linking to
Google Maps Street View; Mapillary/KartaView rows link to that provider's
own web viewer for the same image id instead.

## 4. Attribution (CC-BY-SA requirement)

Mapillary and KartaView images are licensed CC-BY-SA, which requires
crediting the original contributor. Every capture downloaded from either
provider stores its `attribution` string (contributor name/handle, as
returned by that provider's API) in the new column. Anywhere a
Mapillary/KartaView-sourced image is shown in the UI (candidate cards,
photo comparison), a small credit line renders using that stored
attribution. Google-sourced images show nothing extra (unchanged).

## 5. Cost accounting

Only Google-sourced captures count against the existing budget/spend
tracking (`packages/api-usage`, `api_usage` table) — Mapillary and
KartaView are free and untracked there. Since the priority order the user
sets determines how many points fall through to paid Google coverage,
preferring the free providers directly reduces real spend, which is the
whole point of this project.

## Out of scope

- Any imagery provider beyond these three (no Panoramax, no Bing
  Streetside, etc.) — can be added later behind the same
  `StreetImageryProvider` interface if ever needed.
- Per-point manual provider selection — rejected in favor of automatic
  priority-order fallback (confirmed with the user).
- Replacing Google entirely — Google remains fully available and is
  still the highest-priority fallback by default for areas where the
  free providers have poor coverage.
