# Single-column results layout + time-of-day classifier — design spec

Status: approved (design phase) — implementation not started.

## Context

Two independent, user-requested changes to the search results UI, small enough to spec and implement together:

1. The "other candidates" list in the results panel renders as a 2-column grid of bare score cards (no thumbnail). The user wants it cleaner, as a single column.
2. The "Hora estimada" (estimated time) widget is a static, permanently-locked mockup with a no-op install button — it was built for a hypothetical shadow-based hour-estimation model that was never built. A real, working classifier already exists (Wanda's `time_of_day` facet, a CLIP zero-shot classifier already installed as model id `wanda-v1`), but nothing in the search flow ever calls it.

## Goals

- `OtherCandidatesList.tsx`'s candidate grid becomes a single vertical column, with a thumbnail added to each compact card (currently missing entirely).
- A search's query photo gets classified for time-of-day (via `wanda-v1`'s `time_of_day` facet, or whichever active installed classifier has that facet — not hardcoded to `wanda-v1`'s id, so a future Wanda version or a different model can serve the same facet without a code change) during Pass 1, in parallel with the existing retrieval embedding call.
- `EstimatedTimeWidget` shows the real classification result — mapped to a representative hour on its existing sun-arc visual — instead of always being locked.

## Non-goals

- No change to the `WeatherEstimateWidget` or `DetectedObjectsWidget` stubs — same pattern, same TODO, explicitly out of scope for this pass (easy follow-up later).
- No persistence of the time-of-day result to the DB — it's computed fresh per search and lives only in the client-side search store (`useSearchStore`), same lifetime as `regions`/`candidatesByRegion`. Reopening a past search (`GET /api/searches/[searchId]`) will not re-show a time-of-day result. If persisting past-search time-of-day becomes a real ask, that's a follow-up spec (adds a DB column + a read-path change).
- No change to the "Instalar Hora estimada" button's behavior when locked — it stays a no-op. Deep-linking it to open the model catalog is a separate, easy follow-up.
- No change to pagination mechanics (`PAGE_SIZE` stays 6) or to the click-to-expand interaction in `OtherCandidatesList` — only the grid becomes a stack and compact cards gain a thumbnail.
- The reported "no candidate matches the real position" issue (two separate photos this session, both scoring 8-13% top similarity against real, visually-unrelated Street View images) was investigated and is NOT a code bug — confirmed via a dedicated Explore-agent pass (no coordinate-order or ranking bug anywhere in the pipeline) and via a direct random-baseline comparison (top candidates score meaningfully above a random sample, proving the embeddings are discriminative, just weak for these two photos). This is a model-accuracy/dataset-coverage limitation, not something this spec addresses.

## Feature A: single-column results

`apps/web/app/components/OtherCandidatesList.tsx`:
- The candidate grid container changes from `grid grid-cols-2 gap-1.5` to a single-column stack (`flex flex-col gap-1.5`).
- Each compact (non-expanded) card gains a small thumbnail (`h-12 w-12 rounded-md object-cover`, same `/api/images/indexed/{candidate.indexedImageId}` source `CandidateComparisonCard`'s `PhotoComparison` already uses), placed to the left of the existing ring gauge + score + badge content.
- The expanded state (click → full `CandidateComparisonCard`) is unchanged in behavior; it no longer needs a `col-span-2` override since everything is already full-width in a single column.
- `PAGE_SIZE` stays 6.

## Feature B: connect the time-of-day classifier

### Discovery — which model serves `time_of_day`

New function in `apps/web/lib/model-catalog/classification-models.ts`:

```ts
export async function findActiveModelForFacet(pool: Pool, facet: string): Promise<{ modelId: string } | null> {
  const manifests = await listActiveClassificationModels(pool);
  const match = manifests.find((m) => m.facets.some((f) => f.facet === facet));
  return match ? { modelId: match.modelId } : null;
}
```

Not hardcoded to `wanda-v1` — any active installed classifier whose manifest declares a `time_of_day` facet satisfies this (today, that's `wanda-v1`, Wanda's first published version).

### Calling the inference service

New function in `apps/web/lib/inference-client.ts`, mirroring `embedQueryImage`'s exact shape:

```ts
export interface ClassifyLabel {
  name: string;
  score: number;
}

export interface ClassifyGroup {
  facet: string;
  labels: ClassifyLabel[];
}

export async function classifyQueryImage(
  imageBase64: string,
  modelId: string,
  inferenceBaseUrl: string
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

  const body = (await res.json()) as { groups: ClassifyGroup[] };
  return body.groups;
}
```

### Wiring into Pass 1

`apps/web/app/api/models/[modelId]/estimate/route.ts`: before building `RunSearchDeps`, call `findActiveModelForFacet(pool, "time_of_day")`. If it returns a model, add a `classifyTimeOfDay` dep to `RunSearchDeps` that calls `classifyQueryImage` with that `modelId`; if it returns `null`, the dep is omitted entirely (no call happens).

`apps/web/lib/search/run-search.ts`: `RunSearchDeps` gains an optional field:

```ts
classifyTimeOfDay?: (imageBase64: string) => Promise<{ label: string; score: number } | null>;
```

`runSearch` calls `deps.embedQuery(...)` and, if present, `deps.classifyTimeOfDay(...)` via `Promise.all` — concurrent, not sequential, so an installed time-of-day model adds no extra wall-clock time to the search (both calls need only the same query image, nothing from each other). A classify failure (network error, 503 OOM, whatever) is caught inside the route's dep implementation and turned into `null` — it must never fail the whole search; time-of-day is decorative, retrieval is not.

`packages/shared-types/src/search.ts`: `SearchResponse` gains:

```ts
timeOfDay: { label: string; score: number } | null;
```

Populated from the highest-scoring label in the `time_of_day` facet's `labels` array (already sorted descending by the inference service — see `_run_clip_zero_shot`'s `sorted(...reverse=True)`), or `null` if no active model served the facet or classification failed.

### Label → representative hour

New small pure function (co-located with `EstimatedTimeWidget.tsx` or in a shared lib — implementer's call, small enough either way):

```ts
const LABEL_TO_HOUR: Record<string, number> = {
  "foto tomada al amanecer": 6,
  "foto tomada al mediodía": 12.5,
  "foto tomada al atardecer": 19,
  "foto tomada de noche": 0,
};

function hourForLabel(label: string): number | null {
  return LABEL_TO_HOUR[label] ?? null;
}
```

An unrecognized label (a future Wanda version with different prompt wording) maps to `null`, which `ResultsPanel` treats the same as "no time-of-day result" (locked stays true) — never crashes, never shows a nonsense hour.

### `ResultsPanel.tsx` / `EstimatedTimeWidget.tsx`

`ResultsPanel.tsx`'s `estimated-time` widget entry stops hardcoding `locked: true`:

```ts
const timeOfDay = useSearchStore((s) => s.timeOfDay);
const estimatedHour = timeOfDay ? hourForLabel(timeOfDay.label) : null;
// ...
{
  id: "estimated-time",
  title: "Hora estimada",
  icon: SEARCH_ICON,
  colSpan: 2,
  locked: estimatedHour === null,
  defaultExpanded: estimatedHour !== null,
  render: () => <EstimatedTimeWidget locked={estimatedHour === null} estimatedHour={estimatedHour} onInstall={noop} />,
},
```

`useSearchStore` (`apps/web/app/stores/useSearchStore.ts`) gains a `timeOfDay: { label: string; score: number } | null` field, set in `setSearchResults` from the new `SearchResponse.timeOfDay` field, reset to `null` in `setSearching`/`reset` like the rest of the per-search state.

`EstimatedTimeWidget.tsx` itself needs no changes — it already accepts `estimatedHour: number | null` and renders the sun-arc/lock states correctly; it was only ever fed `null` before.

## Error handling

- Inference-service classify failures: caught in the route, degrade to `timeOfDay: null` (locked widget), never a 5xx for the whole search.
- No active `time_of_day`-facet model installed: `findActiveModelForFacet` returns `null`, no classify call is attempted at all (not a wasted network round-trip), widget stays locked exactly as it does today.
- Unrecognized label text: maps to `null` via `hourForLabel`, same locked fallback.

## Testing

- `findActiveModelForFacet`: unit tests (mock-pool pattern matching the rest of `classification-models.test.ts`) — finds a model when one of several active manifests has the facet, returns `null` when none do, returns `null` when there are zero active models.
- `classifyQueryImage`: unit test mocking `fetch`, matching `inference-client.ts`'s existing test conventions (if any exist for `embedQueryImage`; otherwise establish the same pattern).
- `hourForLabel`: pure-function unit tests — all four known labels, plus an unrecognized label returning `null`.
- `runSearch` (`run-search.test.ts` if it exists, else add one): `classifyTimeOfDay` dep is called concurrently with `embedQuery` (not blocking retrieval), its result flows into the returned/persisted response, and a rejected `classifyTimeOfDay` promise doesn't propagate as a search failure (the route's own try/catch handles this — cover it at whichever layer actually owns the try/catch once the implementer decides route vs. run-search).
- `estimate/route.ts` tests: add cases for (a) an active time-of-day model present → response includes `timeOfDay`, (b) none present → `timeOfDay: null` and no classify call attempted, (c) classify throws → search still succeeds with `timeOfDay: null`.
- `OtherCandidatesList.tsx`, `ResultsPanel.tsx`, `EstimatedTimeWidget.tsx`: UI-only, manual verification — matches this codebase's established convention (no test files for components with no pure-function core).
