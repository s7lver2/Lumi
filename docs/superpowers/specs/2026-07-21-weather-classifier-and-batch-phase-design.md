# Weather classifier + batch analysis phase progress — design spec

Status: approved (design phase) — implementation not started.

## Context

Direct follow-ups to `docs/superpowers/specs/2026-07-21-results-layout-and-time-of-day-design.md` (already implemented and merged this session), which wired Wanda's `time_of_day` facet into search but explicitly deferred the `weather` facet and left the batch-scan notification showing only a done/total count.

1. `WeatherEstimateWidget` is unconditionally, hardcodedly locked (no `locked` prop even exists on it) and shows fake mockup content (a temperature range and a description) for a hypothetical lighting/shadow-based weather-estimation model that doesn't exist. What does exist and already works: Wanda's `weather` facet, a real HF `image-classification` pipeline (`prithivMLmods/Weather-Image-Classification`) already installed and active as `wanda-v1`.
2. The bottom-right "Escaneando X/Y…" notification (`BackgroundJobsTray.tsx`, backed by `search_batches`) shows only how many photos in a batch are done — not what's currently happening to the photo in flight (embedding, searching, saving).

## Goals

- `WeatherEstimateWidget` shows a real classification result — translated label + confidence — instead of always being locked, following the exact same wiring pattern already built for `time_of_day` (facet discovery → classify call → `SearchResponse` field → store field → widget unlock).
- The batch-scan notification shows which of three coarse phases (`embedding`, `searching`, `saving`) the in-flight photo is currently in, threaded from the estimate route (where these phases actually happen) back through the worker's batch job to `search_batches`, without the worker needing any visibility into the estimate route's internals.

## Non-goals

- No change to `DetectedObjectsWidget` — same stub pattern, not part of this ask.
- No per-image-in-batch phase history — only the *currently in-flight* photo's phase is tracked (a single `current_phase` value per batch, not one per image), since the batch processes images strictly one at a time.
- No change to how `analyzeOne`/`runAnalyzeImageBatchJob`'s `done`/`failed`/`status` counters work — phase is a new, purely additive signal alongside them.
- A direct (non-batch) search from the UI has no `batchId` and never reports a phase — zero behavior change to that path.

## Feature C: connect the weather classifier

### Confirmed label set

Fetched from the model card: `prithivMLmods/Weather-Image-Classification` predicts exactly five labels: `cloudy/overcast`, `foggy/hazy`, `rain/storm`, `snow/frosty`, `sun/clear`. A small translation map (co-located with the existing `hourForLabel` in `apps/web/lib/time-of-day.ts` — or a sibling file, implementer's call) converts these to Spanish for display, with a safe fallback to the raw label for an unrecognized future value:

```ts
const WEATHER_LABEL_ES: Record<string, string> = {
  "cloudy/overcast": "Nublado",
  "foggy/hazy": "Niebla",
  "rain/storm": "Lluvia",
  "snow/frosty": "Nieve",
  "sun/clear": "Despejado",
};

function spanishWeatherLabel(label: string): string {
  return WEATHER_LABEL_ES[label] ?? label;
}
```

### Wiring (mirrors `time_of_day` exactly)

- `SearchResponse` gains `weather: { label: string; score: number } | null` (same shape as `timeOfDay`, `label` is the raw HF label — translation happens at display time, not stored translated).
- `persistSearch`/`PersistSearchArgs` gain a `weather` field, passed through unpersisted (same non-goal as `timeOfDay` — no DB write, in-memory only).
- `RunSearchDeps` gains an optional `classifyWeather?: (imageBase64: string) => Promise<{ label: string; score: number } | null>`, run concurrently with `embedQuery` and `classifyTimeOfDay` in the same `Promise.all` in `runSearch`.
- The estimate route calls `findActiveModelForFacet(pool, "weather")` alongside the existing `time_of_day` lookup, and builds a `classifyWeather` dep the same way `classifyTimeOfDay` is built — same try/catch-degrades-to-null error handling, same reasoning (weather is decorative, never fails the search).
- `useSearchStore` gains a `weather` field, set from `SearchResponse.weather` in `setSearchResults`, reset to `null` like every other per-search field.

### `WeatherEstimateWidget.tsx`

Changes from `{ onInstall: () => void }` (always locked, fake content) to:

```ts
{ locked: boolean; weather: { label: string; score: number } | null; onInstall: () => void }
```

Locked preview content (temperature range, "Despejado, luz diurna") is removed. When unlocked, shows `spanishWeatherLabel(weather.label)` and `${Math.round(weather.score * 100)}%`, replacing the current fake `18–22°C` / `Despejado, luz diurna` two-line layout with a single translated-label + confidence display (same visual weight/position, just real content instead of two fake lines).

`ResultsPanel.tsx`'s `weather` widget entry stops hardcoding `locked: true` and `onInstall={noop}` in the same way the `estimated-time` entry already does for `timeOfDay`.

## Feature D: batch analysis phase progress

### Data model

`search_batches` gains one column, mirroring `background_jobs.progress_phase`'s exact naming spirit:

```sql
ALTER TABLE search_batches ADD COLUMN current_phase text;
```

Only three values are ever written: `'embedding'`, `'searching'`, `'saving'` — no enum constraint at the DB level (matches `background_jobs.progress_phase`'s free-form `text`, which also has no CHECK constraint).

### Reporting a phase from the estimate route

New `apps/web/lib/search/batch-phase.ts`:

```ts
export async function reportBatchPhase(pool: Pool, batchId: string, phase: "embedding" | "searching" | "saving"): Promise<void> {
  await pool.query(`UPDATE search_batches SET current_phase = $2, updated_at = now() WHERE id = $1`, [batchId, phase]);
}
```

`RunSearchDeps` gains an optional `reportPhase?: (phase: "embedding" | "searching" | "saving") => void` (fire-and-forget — returns `void`, not `Promise<void>`, so `runSearch` never awaits it and a failure can't propagate into the search itself). `runSearch` calls it at the start of each of the three stages:

```ts
export async function runSearch(deps: RunSearchDeps, input: RunSearchInput): Promise<SearchResponse> {
  const searchId = deps.newSearchId();
  deps.reportPhase?.("embedding");
  const [queryEmbedding, timeOfDay, weather] = await Promise.all([
    deps.embedQuery(input.imageBase64),
    deps.classifyTimeOfDay ? deps.classifyTimeOfDay(input.imageBase64) : Promise.resolve(null),
    deps.classifyWeather ? deps.classifyWeather(input.imageBase64) : Promise.resolve(null),
  ]);
  deps.reportPhase?.("searching");
  const retrieved = await deps.retrieve(queryEmbedding);
  const reranked = deps.rerank(queryEmbedding, retrieved);
  const regions = deps.cluster(reranked);
  deps.reportPhase?.("saving");
  const queryImagePath = await deps.saveImage(searchId, input.imageBytes, input.imageExt);
  return deps.persist({ queryImagePath, queryEmbedding, candidates: reranked, regions, timeOfDay, weather });
}
```

The estimate route builds `reportPhase` only when a `batchId` is present in the request (see below), wrapping `reportBatchPhase` in a synchronous-looking function that fires the DB write without awaiting it in the critical path and swallows any error:

```ts
reportPhase: batchId
  ? (phase) => { void reportBatchPhase(pool, batchId, phase).catch(() => {}); }
  : undefined,
```

### Threading `batchId` from the worker into the estimate call

`apps/worker/src/index.ts`'s `analyzeOne` gains a `batchId` parameter and includes it as a form field:

```ts
analyzeOne: async (imageBytes, modelId, batchId) => {
  const form = new FormData();
  form.append("image", new Blob([imageBytes as unknown as BlobPart]), "batch-image");
  form.append("batchId", batchId);
  const res = await fetch(`${webBaseUrl}/api/models/${modelId}/estimate`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`estimate failed with status ${res.status}`);
  return res.json();
},
```

`AnalyzeImageBatchJobDeps.analyzeOne`'s signature gains the same `batchId` parameter; `runAnalyzeImageBatchJob` passes its own `batchId` through (it already has it from `payload.batchId`).

The estimate route reads `form.get("batchId")` as an optional string (not `File`, not required) — when present and non-empty, builds the `reportPhase` dep; when absent (a direct UI search), `reportPhase` is `undefined` and `runSearch`'s `deps.reportPhase?.(...)` calls become no-ops.

### Reading it back

`GET /api/search/batch/active` (`apps/web/app/api/search/batch/active/route.ts`) adds `current_phase` to its `SELECT`, returning it as part of the batch object (`{ id, status, total, done, failed, currentPhase }` — camelCase in the API response, matching this codebase's existing snake_case-DB/camelCase-API convention elsewhere).

### UI

`BackgroundJobsTray.tsx`'s `SearchBatch` interface gains `currentPhase: string | null`. A small phase→Spanish map:

```ts
const BATCH_PHASE_LABEL: Record<string, string> = {
  embedding: "Analizando…",
  searching: "Buscando coincidencias…",
  saving: "Guardando…",
};
```

The batch card's headline changes from the current fixed `Escaneando {done}/{total}…` to also show the phase as a second line when present:

```tsx
<div className="text-[10.5px] font-medium text-fg">
  Escaneando {batch.done}/{batch.total}…
</div>
{batch.currentPhase && BATCH_PHASE_LABEL[batch.currentPhase] && (
  <div className="mt-0.5 text-[9.5px] text-muted">{BATCH_PHASE_LABEL[batch.currentPhase]}</div>
)}
```

An unrecognized or `null` phase (a batch that started before this feature shipped, or between polls before the first phase write lands) simply omits the second line — the existing plain headline degrades gracefully with no special-casing needed.

## Error handling

- Weather classification failures degrade to `weather: null`, identical to `timeOfDay`'s existing handling — never fails the search.
- Phase-reporting is fire-and-forget from `runSearch`'s perspective (`reportPhase` returns `void`, errors are swallowed in the route's wrapper) — a DB hiccup while writing `current_phase` never affects the actual search or the batch's `done`/`failed` counts.
- A malformed/missing `batchId` form field is simply treated as "no batch" (`reportPhase: undefined`) — never a 400, since a normal single-photo search legitimately has no `batchId` at all.

## Testing

- `spanishWeatherLabel`/`WEATHER_LABEL_ES`: pure-function unit tests — all five known labels, plus an unrecognized label falling back to itself.
- `findActiveModelForFacet(pool, "weather")`: already covered generically by the existing facet-agnostic tests from the previous plan — no new test needed for the function itself, only for its new call site.
- `SearchResponse.weather`/`PersistSearchArgs.weather`/`useSearchStore.weather`: same test shape as the existing `timeOfDay` tests in each of those files (one test per file asserting the new field flows through), following the established pattern exactly.
- `runSearch`: new tests for (a) `classifyWeather` called concurrently with `embedQuery`/`classifyTimeOfDay` and its result passed to `persist`, (b) `reportPhase` called with `"embedding"` before the concurrent calls, `"searching"` before retrieve, `"saving"` before saveImage — in that order.
- `reportBatchPhase`: mock-pool unit test asserting the exact `UPDATE` statement and params.
- Estimate route: tests for (a) `batchId` present in the form → `reportPhase` dep is built and calling it invokes `reportBatchPhase` with that batch id, (b) `batchId` absent → `reportPhase` is `undefined`, (c) a `weather`-serving active model present/absent mirrors the existing `time_of_day` test pairs.
- `runAnalyzeImageBatchJob`/`analyzeOne`: update the existing test file's `analyzeOne` mock signature to accept and assert the new `batchId` argument.
- `WeatherEstimateWidget.tsx`, `ResultsPanel.tsx`, `BackgroundJobsTray.tsx`: UI-only, manual verification — matches this codebase's established convention (none of the three have a test file today).
