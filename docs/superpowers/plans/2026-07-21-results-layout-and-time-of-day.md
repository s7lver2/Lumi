# Single-Column Results + Time-of-Day Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the "other candidates" grid into a single column with thumbnails, and wire Wanda's already-installed `time_of_day` facet classifier into Pass-1 search so `EstimatedTimeWidget` shows a real result instead of a permanently-locked mockup.

**Architecture:** A new `findActiveModelForFacet` helper discovers whether any active installed classifier serves `time_of_day`; a new `classifyQueryImage` inference-client call runs it in parallel with the existing embedding call via a new optional `RunSearchDeps.classifyTimeOfDay` dependency; the result flows through `persistSearch` (in-memory only, no DB write) into `SearchResponse.timeOfDay`, into `useSearchStore`, and finally into `ResultsPanel`'s widget wiring via a small `hourForLabel` mapping. The results-grid change is independent and purely presentational.

**Tech Stack:** Next.js API routes, Zustand store, Vitest (mock-`fetch` and mock-`pool` patterns already established in this codebase), Python FastAPI inference service (already implemented, not touched by this plan).

## Global Constraints

- `timeOfDay` is never persisted to the database — it's computed fresh per search and lives only in `SearchResponse`/`useSearchStore`, same lifetime as `regions`/`candidatesByRegion` (spec's explicit non-goal).
- A classify failure (network error, inference OOM, no active model) must never fail the search itself — always degrades to `timeOfDay: null`, same visual result as "not installed" (locked widget).
- Do not touch `WeatherEstimateWidget` or `DetectedObjectsWidget` — same stub pattern, explicitly out of scope.
- Do not change the "Instalar Hora estimada" button's behavior — stays a no-op when locked.
- `PAGE_SIZE` in `OtherCandidatesList.tsx` stays 6.
- UI-only components with no pure-function core (`ResultsPanel.tsx`, `OtherCandidatesList.tsx`) get manual verification, no test file — matches this codebase's existing convention (neither has a test file today).

---

### Task 1: `SearchResponse.timeOfDay` field

**Files:**
- Modify: `packages/shared-types/src/search.ts:47-51`
- Modify: `packages/shared-types/src/search.test.ts`

**Interfaces:**
- Produces: `SearchResponse.timeOfDay: { label: string; score: number } | null` — every later task that constructs or consumes a `SearchResponse` uses this exact shape.

- [ ] **Step 1: Update the type**

In `packages/shared-types/src/search.ts`, change:

```ts
/** Response body of POST /api/search (Pass 1). */
export interface SearchResponse {
  searchId: string;
  regions: SearchRegion[];
  candidatesByRegion: Record<string, SearchCandidate[]>;
}
```

to:

```ts
/** Response body of POST /api/search (Pass 1). */
export interface SearchResponse {
  searchId: string;
  regions: SearchRegion[];
  candidatesByRegion: Record<string, SearchCandidate[]>;
  /** Highest-scoring time_of_day facet label from Wanda (or any active
   * classifier serving that facet), or null if none is installed/active or
   * classification failed. Computed fresh per search — never persisted to
   * the DB (spec: docs/superpowers/specs/2026-07-21-results-layout-and-
   * time-of-day-design.md). */
  timeOfDay: { label: string; score: number } | null;
}
```

- [ ] **Step 2: Update every other file that already constructs a `SearchResponse` literal, so the codebase still compiles**

This type change breaks any object literal typed as `SearchResponse` that's missing the new required field. Search for them now (don't wait for `tsc` to find them one at a time):

Run: `cd apps/web && grep -rln "SearchResponse = {" --include="*.ts" --include="*.tsx" .`

At minimum, `apps/web/app/stores/useSearchStore.test.ts:8-19`'s `RESPONSE` fixture needs `timeOfDay: null` added:

```ts
const RESPONSE: SearchResponse = {
  searchId: "s1",
  regions: [
    { id: "r1", centroid: { lat: 37.3, lng: -121.9 }, radiusM: 150, aggregateScore: 0.83, candidateCount: 4 },
    { id: "r2", centroid: { lat: 37.5, lng: -122.3 }, radiusM: 150, aggregateScore: 0.68, candidateCount: 1 },
  ],
  candidatesByRegion: {
    r1: [
      { id: "c1", regionId: "r1", indexedImageId: "i1", panoId: "p1", heading: 0, lat: 37.3, lng: -121.9, similarityScore: 0.83, verificationScore: null, rank: 1, status: "unreviewed" },
    ],
  },
  timeOfDay: null,
};
```

Fix every other literal the grep turns up the same way (add `timeOfDay: null` unless the test is specifically about time-of-day, in which case use a real value).

- [ ] **Step 3: Run the full typecheck to confirm nothing else breaks**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors mentioning `timeOfDay` or `SearchResponse`.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/search.ts apps/web/app/stores/useSearchStore.test.ts
git commit -m "feat(shared-types): add SearchResponse.timeOfDay"
```

(If Step 2's grep found other files, `git add` those too before committing.)

---

### Task 2: `findActiveModelForFacet`

**Files:**
- Modify: `apps/web/lib/model-catalog/classification-models.ts`
- Modify: `apps/web/lib/model-catalog/classification-models.test.ts`

**Interfaces:**
- Consumes: `listActiveClassificationModels(pool)` (already exists in this file, returns `GenericClassifierManifest[]`, each with a `facets: ClassifierFacet[]` array where `ClassifierFacet.facet: string`).
- Produces: `findActiveModelForFacet(pool: Pool, facet: string): Promise<{ modelId: string } | null>` — Task 7 (the estimate route) calls this with `"time_of_day"`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/lib/model-catalog/classification-models.test.ts` (it already has `manifest(version)` and `makePool(queryImpl)` helpers at the top — reuse them, don't redefine):

```ts
import { findActiveModelForFacet } from "./classification-models";
```

(add to the existing top-of-file import list alongside the other named imports)

```ts
describe("findActiveModelForFacet", () => {
  it("returns the modelId of the active model whose facets include the given facet", async () => {
    const pool = makePool(async () => ({
      rows: [{ manifest: manifest("1.0") }], // manifest()'s only facet is "weather"
    }));

    const result = await findActiveModelForFacet(pool, "weather");
    expect(result).toEqual({ modelId: "wanda-v1" });
  });

  it("returns null when no active model has the given facet", async () => {
    const pool = makePool(async () => ({ rows: [{ manifest: manifest("1.0") }] }));

    const result = await findActiveModelForFacet(pool, "time_of_day");
    expect(result).toBeNull();
  });

  it("returns null when there are no active models at all", async () => {
    const pool = makePool(async () => ({ rows: [] }));

    const result = await findActiveModelForFacet(pool, "time_of_day");
    expect(result).toBeNull();
  });

  it("finds the right model among several active ones", async () => {
    const weatherOnly = manifest("1.0");
    const withTimeOfDay: typeof weatherOnly = {
      ...manifest("1.0"),
      modelId: "wanda-v2",
      facets: [
        { facet: "weather", hfModelId: "prithivMLmods/Weather-Image-Classification", strategy: "pipeline" },
        { facet: "time_of_day", hfModelId: "openai/clip-vit-base-patch32", strategy: "clip-zero-shot", prompts: ["a", "b"] },
      ],
    };
    const pool = makePool(async () => ({
      rows: [{ manifest: weatherOnly }, { manifest: withTimeOfDay }],
    }));

    const result = await findActiveModelForFacet(pool, "time_of_day");
    expect(result).toEqual({ modelId: "wanda-v2" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/model-catalog/classification-models.test.ts`
Expected: FAIL — `findActiveModelForFacet is not a function` (or a TS import error).

- [ ] **Step 3: Implement it**

Add to `apps/web/lib/model-catalog/classification-models.ts`, after `listActiveClassificationModels`:

```ts
/** Finds the active classification model, if any, whose manifest declares
 * the given facet — e.g. `findActiveModelForFacet(pool, "time_of_day")`
 * to discover which installed model (Wanda today, whatever tomorrow) can
 * serve a time-of-day classification, without hardcoding a modelId. */
export async function findActiveModelForFacet(pool: Pool, facet: string): Promise<{ modelId: string } | null> {
  const manifests = await listActiveClassificationModels(pool);
  const match = manifests.find((m) => m.facets.some((f) => f.facet === facet));
  return match ? { modelId: match.modelId } : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/model-catalog/classification-models.test.ts`
Expected: PASS, 14 tests (10 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/model-catalog/classification-models.ts apps/web/lib/model-catalog/classification-models.test.ts
git commit -m "feat(web): add findActiveModelForFacet to discover which model serves a facet"
```

---

### Task 3: `classifyQueryImage`

**Files:**
- Modify: `apps/web/lib/inference-client.ts`
- Modify: `apps/web/lib/inference-client.test.ts`

**Interfaces:**
- Produces: `classifyQueryImage(imageBase64: string, modelId: string, inferenceBaseUrl: string): Promise<ClassifyGroup[]>`, and the exported types `ClassifyLabel { name: string; score: number }` and `ClassifyGroup { facet: string; labels: ClassifyLabel[] }`. Task 7 calls this and reads the `time_of_day` group's first (highest-scoring) label.
- Matches exactly, byte-for-byte, the real Python response shape confirmed in `services/inference/main.py:126-141` (`ClassifyRequest{image_base64: str}` → `ClassifyResponse{groups: [{facet, labels: [{name, score}]}]}`) — do not rename any field.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/lib/inference-client.test.ts`:

```ts
import { classifyQueryImage } from "./inference-client";
```

(add to the existing import line)

```ts
describe("classifyQueryImage", () => {
  it("POSTs the image to /models/{modelId}/classify and returns the groups", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        groups: [
          { facet: "time_of_day", labels: [{ name: "foto tomada al mediodía", score: 0.72 }, { name: "foto tomada de noche", score: 0.1 }] },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const groups = await classifyQueryImage("aaaa", "wanda-v1", "http://localhost:8000");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/models/wanda-v1/classify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ image_base64: "aaaa" }),
      })
    );
    expect(groups).toEqual([
      { facet: "time_of_day", labels: [{ name: "foto tomada al mediodía", score: 0.72 }, { name: "foto tomada de noche", score: 0.1 }] },
    ]);
  });

  it("throws when the inference service responds non-OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "Unknown or inactive classification model id: wanda-v1" })
    );
    await expect(classifyQueryImage("aaaa", "wanda-v1", "http://localhost:8000")).rejects.toThrow(
      /Inference service \/models\/wanda-v1\/classify failed \(404\): Unknown or inactive classification model id: wanda-v1/
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/inference-client.test.ts`
Expected: FAIL — `classifyQueryImage is not a function`.

- [ ] **Step 3: Implement it**

Add to `apps/web/lib/inference-client.ts`:

```ts
export interface ClassifyLabel {
  name: string;
  score: number;
}

export interface ClassifyGroup {
  facet: string;
  labels: ClassifyLabel[];
}

/** Runs one installed generic-classifier model's facets against a single
 * image (spec: docs/superpowers/specs/2026-07-21-results-layout-and-time-
 * of-day-design.md). Labels within each group are already sorted
 * descending by score by the inference service. */
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/inference-client.test.ts`
Expected: PASS, 4 tests (2 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/inference-client.ts apps/web/lib/inference-client.test.ts
git commit -m "feat(web): add classifyQueryImage to call /models/{modelId}/classify"
```

---

### Task 4: `hourForLabel`

**Files:**
- Create: `apps/web/lib/time-of-day.ts`
- Test: `apps/web/lib/time-of-day.test.ts`

**Interfaces:**
- Produces: `hourForLabel(label: string): number | null`. Task 9 (`ResultsPanel.tsx`) calls this with `timeOfDay.label` from the store.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/time-of-day.test.ts
import { describe, it, expect } from "vitest";
import { hourForLabel } from "./time-of-day";

describe("hourForLabel", () => {
  it("maps each of Wanda's four known time_of_day labels to a representative hour", () => {
    expect(hourForLabel("foto tomada al amanecer")).toBe(6);
    expect(hourForLabel("foto tomada al mediodía")).toBe(12.5);
    expect(hourForLabel("foto tomada al atardecer")).toBe(19);
    expect(hourForLabel("foto tomada de noche")).toBe(0);
  });

  it("returns null for an unrecognized label", () => {
    expect(hourForLabel("some future model's different wording")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/time-of-day.test.ts`
Expected: FAIL — `Cannot find module './time-of-day'`.

- [ ] **Step 3: Implement it**

```ts
// apps/web/lib/time-of-day.ts

/** Wanda's time_of_day facet (services/inference's CLIP zero-shot classifier,
 * manifest prompts confirmed live in installed_classification_models) is a
 * coarse 4-bucket classifier, not a continuous hour estimator — this maps
 * each bucket to a representative hour so EstimatedTimeWidget's existing
 * sun-arc visual (built for a hypothetical shadow-based hour model) can
 * still show something meaningful. An unrecognized label (a future model
 * with different prompt wording) returns null rather than guessing. */
const LABEL_TO_HOUR: Record<string, number> = {
  "foto tomada al amanecer": 6,
  "foto tomada al mediodía": 12.5,
  "foto tomada al atardecer": 19,
  "foto tomada de noche": 0,
};

export function hourForLabel(label: string): number | null {
  return LABEL_TO_HOUR[label] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/time-of-day.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/time-of-day.ts apps/web/lib/time-of-day.test.ts
git commit -m "feat(web): add hourForLabel mapping for Wanda's time_of_day facet"
```

---

### Task 5: thread `timeOfDay` through `persistSearch`

**Files:**
- Modify: `apps/web/lib/search/persist.ts`
- Modify: `apps/web/lib/search/persist.test.ts`

**Interfaces:**
- Consumes: `SearchResponse.timeOfDay` (Task 1).
- Produces: `PersistSearchArgs.timeOfDay: { label: string; score: number } | null` (new field) — Task 6 (`run-search.ts`) passes this through when calling `persist(args)`.

- [ ] **Step 1: Write the failing test**

`persist.test.ts` is a real-DB integration test gated behind `TEST_DATABASE_URL` (`const d = url ? describe : describe.skip`). Add a new case to the existing `d("persistSearch", ...)` block in `apps/web/lib/search/persist.test.ts`:

```ts
  it("passes timeOfDay through into the response without writing it anywhere", async () => {
    const candidates: RetrievedCandidate[] = [
      { indexedImageId: imageId, panoId: "pano-p", heading: 0, lat: 0.5, lng: 0.5, similarity: 0.88, embedding: [] },
    ];
    const regions: ClusteredRegion[] = [
      { centroid: { lat: 0.5, lng: 0.5 }, radiusM: 150, aggregateScore: 0.88, memberIds: [imageId] },
    ];

    const res = await persistSearch(pool, {
      queryImagePath: "/tmp/q.jpg",
      queryEmbedding: new Array(8448).fill(0),
      candidates,
      regions,
      timeOfDay: { label: "foto tomada al mediodía", score: 0.72 },
    });

    expect(res.timeOfDay).toEqual({ label: "foto tomada al mediodía", score: 0.72 });
  });

  it("defaults timeOfDay to null when not provided", async () => {
    const res = await persistSearch(pool, {
      queryImagePath: "/tmp/q.jpg",
      queryEmbedding: new Array(8448).fill(0),
      candidates: [],
      regions: [],
    });

    expect(res.timeOfDay).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test npx vitest run lib/search/persist.test.ts`
Expected: FAIL — TypeScript error (`timeOfDay` doesn't exist on `PersistSearchArgs`) or, once that's stubbed, `res.timeOfDay` is `undefined` not matching the assertions.

(If `TEST_DATABASE_URL` isn't set in this environment, the whole `describe` block is skipped — check `db/package.json`'s `migrate:up:test` script and the repo's test-DB setup docs/CI config for how to point at a real test database before running this task's tests for real.)

- [ ] **Step 3: Implement it**

In `apps/web/lib/search/persist.ts`, change:

```ts
export interface PersistSearchArgs {
  queryImagePath: string;
  queryEmbedding: number[];
  candidates: RetrievedCandidate[]; // already re-ranked, best-first
  regions: ClusteredRegion[];
}
```

to:

```ts
export interface PersistSearchArgs {
  queryImagePath: string;
  queryEmbedding: number[];
  candidates: RetrievedCandidate[]; // already re-ranked, best-first
  regions: ClusteredRegion[];
  /** Not persisted to the DB — passed straight through into the returned
   * SearchResponse (spec: docs/superpowers/specs/2026-07-21-results-
   * layout-and-time-of-day-design.md). */
  timeOfDay?: { label: string; score: number } | null;
}
```

And change the final return statement from:

```ts
    await client.query("COMMIT");
    return { searchId, regions: regionOut, candidatesByRegion };
```

to:

```ts
    await client.query("COMMIT");
    return { searchId, regions: regionOut, candidatesByRegion, timeOfDay: args.timeOfDay ?? null };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_test npx vitest run lib/search/persist.test.ts`
Expected: PASS, 3 tests (1 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/persist.ts apps/web/lib/search/persist.test.ts
git commit -m "feat(web): thread timeOfDay through persistSearch without persisting it"
```

---

### Task 6: `RunSearchDeps.classifyTimeOfDay`

**Files:**
- Modify: `apps/web/lib/search/run-search.ts`
- Modify: `apps/web/lib/search/run-search.test.ts`

**Interfaces:**
- Consumes: `PersistSearchArgs.timeOfDay` (Task 5).
- Produces: `RunSearchDeps.classifyTimeOfDay?: (imageBase64: string) => Promise<{ label: string; score: number } | null>` — an **optional** dep that never rejects (Task 7's implementation of it swallows all errors internally, per this task's design note below). Task 7 constructs this dep.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/lib/search/run-search.test.ts`, a new test alongside the existing one:

```ts
  it("calls classifyTimeOfDay concurrently with embedQuery when the dep is provided, and passes its result to persist", async () => {
    const embedding = [1, 0];
    const retrieved: RetrievedCandidate[] = [
      { indexedImageId: "img-1", panoId: "p", heading: 0, lat: 1, lng: 2, similarity: 0.5, embedding },
    ];
    const regions: ClusteredRegion[] = [
      { centroid: { lat: 1, lng: 2 }, radiusM: 150, aggregateScore: 0.9, memberIds: ["img-1"] },
    ];

    const deps = {
      newSearchId: () => "search-x",
      embedQuery: vi.fn().mockResolvedValue(embedding),
      retrieve: vi.fn().mockResolvedValue(retrieved),
      rerank: vi.fn().mockReturnValue(retrieved),
      cluster: vi.fn().mockReturnValue(regions),
      saveImage: vi.fn().mockResolvedValue("/tmp/search-x.jpg"),
      persist: vi.fn().mockResolvedValue({ searchId: "search-x", regions: [], candidatesByRegion: {}, timeOfDay: null }),
      classifyTimeOfDay: vi.fn().mockResolvedValue({ label: "foto tomada al mediodía", score: 0.72 }),
    };

    await runSearch(deps, { imageBase64: "aaaa", imageBytes: Buffer.from([1]), imageExt: "jpg" });

    expect(deps.classifyTimeOfDay).toHaveBeenCalledWith("aaaa");
    expect(deps.persist).toHaveBeenCalledWith(
      expect.objectContaining({ timeOfDay: { label: "foto tomada al mediodía", score: 0.72 } })
    );
  });

  it("passes timeOfDay: null to persist when the classifyTimeOfDay dep is omitted", async () => {
    const embedding = [1, 0];
    const retrieved: RetrievedCandidate[] = [
      { indexedImageId: "img-1", panoId: "p", heading: 0, lat: 1, lng: 2, similarity: 0.5, embedding },
    ];
    const regions: ClusteredRegion[] = [
      { centroid: { lat: 1, lng: 2 }, radiusM: 150, aggregateScore: 0.9, memberIds: ["img-1"] },
    ];

    const deps = {
      newSearchId: () => "search-x",
      embedQuery: vi.fn().mockResolvedValue(embedding),
      retrieve: vi.fn().mockResolvedValue(retrieved),
      rerank: vi.fn().mockReturnValue(retrieved),
      cluster: vi.fn().mockReturnValue(regions),
      saveImage: vi.fn().mockResolvedValue("/tmp/search-x.jpg"),
      persist: vi.fn().mockResolvedValue({ searchId: "search-x", regions: [], candidatesByRegion: {}, timeOfDay: null }),
    };

    await runSearch(deps, { imageBase64: "aaaa", imageBytes: Buffer.from([1]), imageExt: "jpg" });

    expect(deps.persist).toHaveBeenCalledWith(expect.objectContaining({ timeOfDay: null }));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/search/run-search.test.ts`
Expected: FAIL — `deps.classifyTimeOfDay` doesn't exist on the type, or the first test's `expect(deps.classifyTimeOfDay).toHaveBeenCalledWith(...)` fails since `runSearch` never calls it yet.

- [ ] **Step 3: Implement it**

In `apps/web/lib/search/run-search.ts`, change the `RunSearchDeps` interface from:

```ts
export interface RunSearchDeps {
  newSearchId: () => string;
  embedQuery: (imageBase64: string) => Promise<number[]>;
  retrieve: (queryEmbedding: number[]) => Promise<RetrievedCandidate[]>;
  rerank: (queryEmbedding: number[], candidates: RetrievedCandidate[]) => RetrievedCandidate[];
  cluster: (candidates: RetrievedCandidate[]) => ClusteredRegion[];
  saveImage: (searchId: string, bytes: Buffer, ext: string) => Promise<string>;
  persist: (args: PersistSearchArgs) => Promise<SearchResponse>;
}
```

to:

```ts
export interface RunSearchDeps {
  newSearchId: () => string;
  embedQuery: (imageBase64: string) => Promise<number[]>;
  retrieve: (queryEmbedding: number[]) => Promise<RetrievedCandidate[]>;
  rerank: (queryEmbedding: number[], candidates: RetrievedCandidate[]) => RetrievedCandidate[];
  cluster: (candidates: RetrievedCandidate[]) => ClusteredRegion[];
  saveImage: (searchId: string, bytes: Buffer, ext: string) => Promise<string>;
  persist: (args: PersistSearchArgs) => Promise<SearchResponse>;
  /** Optional — omitted entirely when no active model serves the
   * time_of_day facet. Must never reject (the caller building this dep is
   * responsible for catching its own errors and resolving null instead —
   * see estimate/route.ts) so runSearch itself stays simple. Runs
   * concurrently with embedQuery via Promise.all, not sequentially, since
   * both only need the same query image and neither depends on the
   * other's result. */
  classifyTimeOfDay?: (imageBase64: string) => Promise<{ label: string; score: number } | null>;
}
```

And change `runSearch`'s body from:

```ts
export async function runSearch(deps: RunSearchDeps, input: RunSearchInput): Promise<SearchResponse> {
  const searchId = deps.newSearchId();
  const queryEmbedding = await deps.embedQuery(input.imageBase64);
  const retrieved = await deps.retrieve(queryEmbedding);
  const reranked = deps.rerank(queryEmbedding, retrieved);
  const regions = deps.cluster(reranked);
  const queryImagePath = await deps.saveImage(searchId, input.imageBytes, input.imageExt);
  return deps.persist({ queryImagePath, queryEmbedding, candidates: reranked, regions });
}
```

to:

```ts
export async function runSearch(deps: RunSearchDeps, input: RunSearchInput): Promise<SearchResponse> {
  const searchId = deps.newSearchId();
  const [queryEmbedding, timeOfDay] = await Promise.all([
    deps.embedQuery(input.imageBase64),
    deps.classifyTimeOfDay ? deps.classifyTimeOfDay(input.imageBase64) : Promise.resolve(null),
  ]);
  const retrieved = await deps.retrieve(queryEmbedding);
  const reranked = deps.rerank(queryEmbedding, retrieved);
  const regions = deps.cluster(reranked);
  const queryImagePath = await deps.saveImage(searchId, input.imageBytes, input.imageExt);
  return deps.persist({ queryImagePath, queryEmbedding, candidates: reranked, regions, timeOfDay });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/search/run-search.test.ts`
Expected: PASS, 3 tests (1 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/search/run-search.ts apps/web/lib/search/run-search.test.ts
git commit -m "feat(web): run classifyTimeOfDay concurrently with embedQuery in runSearch"
```

---

### Task 7: wire it all into the estimate route

**Files:**
- Modify: `apps/web/app/api/models/[modelId]/estimate/route.ts`
- Modify: `apps/web/app/api/models/[modelId]/estimate/route.test.ts`

**Interfaces:**
- Consumes: `findActiveModelForFacet` (Task 2), `classifyQueryImage` (Task 3), `RunSearchDeps.classifyTimeOfDay` (Task 6).
- Produces: nothing further downstream — this is where the feature becomes observable end-to-end.

- [ ] **Step 1: Write the failing tests**

Add these mocks to the top of `apps/web/app/api/models/[modelId]/estimate/route.test.ts`, alongside the existing ones:

```ts
vi.mock("../../../../../lib/model-catalog/classification-models", () => ({ findActiveModelForFacet: vi.fn() }));
vi.mock("../../../../../lib/inference-client", () => ({
  embedQueryImage: vi.fn(),
  classifyQueryImage: vi.fn(),
}));
```

And in the `beforeEach`, alongside the existing `getSettingsRepo` reset, add a default so tests that don't care about time-of-day aren't affected:

```ts
  const { findActiveModelForFacet } = await import("../../../../../lib/model-catalog/classification-models");
  (findActiveModelForFacet as any).mockResolvedValue(null);
```

Add new test cases to the `describe("POST /api/models/[modelId]/estimate", ...)` block:

```ts
  it("passes a classifyTimeOfDay dep to runSearch when an active model serves the time_of_day facet", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {}, timeOfDay: null });
    const { findActiveModelForFacet } = await import("../../../../../lib/model-catalog/classification-models");
    (findActiveModelForFacet as any).mockResolvedValue({ modelId: "wanda-v1" });

    const { POST } = await import("./route");
    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
    await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    expect(findActiveModelForFacet).toHaveBeenCalledWith(expect.anything(), "time_of_day");
    const depsPassed = (runSearch as any).mock.calls[0][0];
    expect(depsPassed.classifyTimeOfDay).toBeInstanceOf(Function);
  });

  it("omits classifyTimeOfDay entirely when no active model serves the facet", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {}, timeOfDay: null });
    const { findActiveModelForFacet } = await import("../../../../../lib/model-catalog/classification-models");
    (findActiveModelForFacet as any).mockResolvedValue(null);

    const { POST } = await import("./route");
    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
    await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    const depsPassed = (runSearch as any).mock.calls[0][0];
    expect(depsPassed.classifyTimeOfDay).toBeUndefined();
  });

  it("classifyTimeOfDay dep resolves to the top time_of_day label and never rejects on classify failure", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {}, timeOfDay: null });
    const { findActiveModelForFacet } = await import("../../../../../lib/model-catalog/classification-models");
    (findActiveModelForFacet as any).mockResolvedValue({ modelId: "wanda-v1" });
    const { classifyQueryImage } = await import("../../../../../lib/inference-client");

    const { POST } = await import("./route");
    const form = new FormData();
    const jpegBytes = await makeJpegBytes();
    form.append("image", new File([jpegBytes as unknown as BlobPart], "a.jpg", { type: "image/jpeg" }));
    await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    const depsPassed = (runSearch as any).mock.calls[0][0];

    (classifyQueryImage as any).mockResolvedValue([
      { facet: "time_of_day", labels: [{ name: "foto tomada al mediodía", score: 0.72 }, { name: "foto tomada de noche", score: 0.1 }] },
    ]);
    await expect(depsPassed.classifyTimeOfDay("aaaa")).resolves.toEqual({ label: "foto tomada al mediodía", score: 0.72 });

    (classifyQueryImage as any).mockRejectedValue(new Error("inference service down"));
    await expect(depsPassed.classifyTimeOfDay("aaaa")).resolves.toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run "app/api/models/[modelId]/estimate/route.test.ts"`
Expected: FAIL — `findActiveModelForFacet`/`classifyQueryImage` mocks reference modules the route doesn't import yet, and `depsPassed.classifyTimeOfDay` is `undefined` in the first new test.

- [ ] **Step 3: Implement it**

In `apps/web/app/api/models/[modelId]/estimate/route.ts`, add to the imports:

```ts
import { embedQueryImage, classifyQueryImage } from "../../../../../lib/inference-client";
import { findActiveModelForFacet } from "../../../../../lib/model-catalog/classification-models";
```

(the existing `import { embedQueryImage } from "../../../../../lib/inference-client";` line gets replaced by the combined one above)

Then, right after the `const pool = getPool();` / `const inferenceBaseUrl = ...` lines and before `const deps: RunSearchDeps = {`, add:

```ts
  const timeOfDayModel = await findActiveModelForFacet(pool, "time_of_day");
```

And change the `deps` object from:

```ts
  const deps: RunSearchDeps = {
    newSearchId: () => randomUUID(),
    embedQuery: (b64) => embedQueryImage(b64, inferenceBaseUrl),
    retrieve: (embedding) =>
      retrieveCandidates(pool, embedding, DEFAULT_TOP_K, undefined, DEFAULT_RELATIVE_SIMILARITY_FLOOR),
    rerank: (embedding, candidates) =>
      queryExpansionRerank(embedding, candidates, DEFAULT_QUERY_EXPANSION_SIZE),
    cluster: (candidates) => clusterCandidates(candidates, DEFAULT_REGION_RADIUS_M),
    saveImage: (searchId, b, ext) => saveQueryImage(searchId, b, ext),
    persist: (args) => persistSearch(pool, args),
  };
```

to:

```ts
  const deps: RunSearchDeps = {
    newSearchId: () => randomUUID(),
    embedQuery: (b64) => embedQueryImage(b64, inferenceBaseUrl),
    retrieve: (embedding) =>
      retrieveCandidates(pool, embedding, DEFAULT_TOP_K, undefined, DEFAULT_RELATIVE_SIMILARITY_FLOOR),
    rerank: (embedding, candidates) =>
      queryExpansionRerank(embedding, candidates, DEFAULT_QUERY_EXPANSION_SIZE),
    cluster: (candidates) => clusterCandidates(candidates, DEFAULT_REGION_RADIUS_M),
    saveImage: (searchId, b, ext) => saveQueryImage(searchId, b, ext),
    persist: (args) => persistSearch(pool, args),
    ...(timeOfDayModel
      ? {
          classifyTimeOfDay: async (b64: string) => {
            try {
              const groups = await classifyQueryImage(b64, timeOfDayModel.modelId, inferenceBaseUrl);
              const group = groups.find((g) => g.facet === "time_of_day");
              const top = group?.labels[0];
              return top ? { label: top.name, score: top.score } : null;
            } catch {
              // Time-of-day is decorative, not core — never fail the search
              // over a classify error (spec: docs/superpowers/specs/2026-
              // 07-21-results-layout-and-time-of-day-design.md).
              return null;
            }
          },
        }
      : {}),
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run "app/api/models/[modelId]/estimate/route.test.ts"`
Expected: PASS, 7 tests (4 existing + 3 new).

- [ ] **Step 5: Run the full web test suite and typecheck to confirm nothing else broke**

Run: `cd apps/web && npx tsc --noEmit && npx vitest run`
Expected: no new failures beyond the two pre-existing, unrelated ones already known in this codebase (`lib/health.test.ts`'s two GPU-field assertions).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/api/models/[modelId]/estimate/route.ts" "apps/web/app/api/models/[modelId]/estimate/route.test.ts"
git commit -m "feat(web): classify time_of_day during Pass 1 search when a model is active"
```

---

### Task 8: `useSearchStore.timeOfDay`

**Files:**
- Modify: `apps/web/app/stores/useSearchStore.ts`
- Modify: `apps/web/app/stores/useSearchStore.test.ts`

**Interfaces:**
- Consumes: `SearchResponse.timeOfDay` (Task 1).
- Produces: `useSearchStore` state field `timeOfDay: { label: string; score: number } | null` — Task 9 (`ResultsPanel.tsx`) reads this.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/app/stores/useSearchStore.test.ts`, inside the existing `describe("useSearchStore", ...)` block:

```ts
  it("stores timeOfDay from the search response, and resets it on the next search", () => {
    useSearchStore.getState().setSearchResults(
      { ...RESPONSE, timeOfDay: { label: "foto tomada al mediodía", score: 0.72 } },
      "IMG_1.jpg"
    );
    expect(useSearchStore.getState().timeOfDay).toEqual({ label: "foto tomada al mediodía", score: 0.72 });

    useSearchStore.getState().setSearching("IMG_2.jpg");
    expect(useSearchStore.getState().timeOfDay).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run app/stores/useSearchStore.test.ts`
Expected: FAIL — `useSearchStore.getState().timeOfDay` is `undefined`, not matching the assertions.

- [ ] **Step 3: Implement it**

In `apps/web/app/stores/useSearchStore.ts`, add to the `SearchState` interface (after `batchProgress`):

```ts
  timeOfDay: { label: string; score: number } | null;
```

Add to `INITIAL` (after `batchProgress`):

```ts
  timeOfDay: null as { label: string; score: number } | null,
```

In `setSearchResults`, change:

```ts
  setSearchResults: (res, queryImageName) => {
    const regions = [...res.regions].sort((a, b) => b.aggregateScore - a.aggregateScore);
    set({
      currentSearchId: res.searchId,
      queryImageName,
      regions,
      candidatesByRegion: res.candidatesByRegion,
      selectedRegionId: regions[0]?.id ?? null,
      refineStatus: "done",
      refineProgress: null,
      error: null,
    });
  },
```

to:

```ts
  setSearchResults: (res, queryImageName) => {
    const regions = [...res.regions].sort((a, b) => b.aggregateScore - a.aggregateScore);
    set({
      currentSearchId: res.searchId,
      queryImageName,
      regions,
      candidatesByRegion: res.candidatesByRegion,
      selectedRegionId: regions[0]?.id ?? null,
      refineStatus: "done",
      refineProgress: null,
      error: null,
      timeOfDay: res.timeOfDay,
    });
  },
```

`setSearching: (queryImageName) => set({ ...INITIAL, queryImageName, refineStatus: "searching" })` and `reset: () => set({ ...INITIAL })` already spread `INITIAL`, so `timeOfDay` resets to `null` automatically — no change needed to either.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run app/stores/useSearchStore.test.ts`
Expected: PASS, 7 tests (6 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/stores/useSearchStore.ts apps/web/app/stores/useSearchStore.test.ts
git commit -m "feat(web): store timeOfDay in useSearchStore"
```

---

### Task 9: wire `ResultsPanel.tsx`'s `estimated-time` widget to real data

**Files:**
- Modify: `apps/web/app/components/ResultsPanel.tsx`

**Interfaces:**
- Consumes: `useSearchStore().timeOfDay` (Task 8), `hourForLabel` (Task 4). `EstimatedTimeWidget` itself is unchanged — it already accepts `{ locked: boolean; estimatedHour: number | null; onInstall: () => void }` and renders correctly for both states.

No test file — matches this file's existing convention (no test file today, verify manually per Step 3).

- [ ] **Step 1: Confirm `EstimatedTimeWidget.tsx` needs no changes**

Read `apps/web/app/components/widgets/EstimatedTimeWidget.tsx` in full. Confirm: it takes exactly `{ locked, estimatedHour, onInstall }`, and when `locked` is `false` it renders the sun-arc positioned at `estimatedHour` with no other required prop. No edit needed to this file — this step is a verification checkpoint, not a code change.

- [ ] **Step 2: Wire real data in `ResultsPanel.tsx`**

Add the import:

```ts
import { hourForLabel } from "../../lib/time-of-day";
```

Inside the `ResultsPanel` function body, alongside the existing `const { queryImageName, candidatesByRegion, selectedRegionId } = useSearchStore();` line, add:

```ts
  const timeOfDay = useSearchStore((s) => s.timeOfDay);
  const estimatedHour = timeOfDay ? hourForLabel(timeOfDay.label) : null;
```

(Note: the existing `const { queryImageName, candidatesByRegion, selectedRegionId } = useSearchStore();` destructures the whole store in one call — keep that line as-is and add the new `useSearchStore((s) => s.timeOfDay)` selector call separately, rather than merging them, to avoid an unrelated re-render-scope change to the existing destructure.)

Change the `estimated-time` widget entry from:

```ts
    {
      id: "estimated-time",
      title: "Hora estimada",
      icon: SEARCH_ICON,
      colSpan: 2,
      locked: true,
      defaultExpanded: false,
      render: () => <EstimatedTimeWidget locked={true} estimatedHour={null} onInstall={noop} />,
    },
```

to:

```ts
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

- [ ] **Step 3: Manual verification**

With `wanda-v1` installed and active (already the case in this environment — confirmed live earlier this session), run a real search from the dev server and confirm: the "Hora estimada" widget is unlocked and shows a sun/moon icon positioned according to the real classification result, matching whichever of the four labels scored highest for that query photo. Then deactivate/uninstall the classifier (via Ajustes → Modelos) and run another search — confirm the widget falls back to locked, exactly like before this change.

- [ ] **Step 4: Run the typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ResultsPanel.tsx
git commit -m "feat(web): unlock Hora estimada widget with real time_of_day data"
```

---

### Task 10: single-column results with thumbnails

**Files:**
- Modify: `apps/web/app/components/OtherCandidatesList.tsx`

**Interfaces:**
- Consumes: `SearchCandidate.indexedImageId` (existing field, already used by `CandidateComparisonCard`/`PhotoComparison` via the confirmed real endpoint `/api/images/indexed/{indexedImageId}`).

No test file — matches this file's existing convention.

- [ ] **Step 1: Replace the grid with a single-column stack, and add a thumbnail to compact cards**

In `apps/web/app/components/OtherCandidatesList.tsx`, change:

```tsx
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {pageItems.map((c) => {
          const isExpanded = expandedId === c.id;
          const score = c.verificationScore ?? c.similarityScore;
          return isExpanded ? (
            <div key={c.id} onClick={() => setExpandedId(null)} className="col-span-2 cursor-pointer">
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
              className="flex cursor-pointer flex-col gap-1.5 rounded-card border border-border p-2.5 transition-colors hover:border-white/20 hover:bg-white/[.03]"
            >
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
          );
        })}
      </div>
```

to:

```tsx
      <div className="mt-2 flex flex-col gap-1.5">
        {pageItems.map((c) => {
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
```

- [ ] **Step 2: Manual verification**

Run a real search with a region that has multiple candidates (any of the two datasets already indexed in this environment work), open the results panel, and confirm: the "Otros ángulos en esta zona" list renders as a single vertical column, each row showing a real thumbnail alongside the ring gauge/score/badge, and clicking a row still expands it in place into the full `CandidateComparisonCard` exactly as before.

- [ ] **Step 3: Run the typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/OtherCandidatesList.tsx
git commit -m "feat(web): single-column candidate list with thumbnails"
```

---

## Self-Review Notes

- **Spec coverage:** Feature A (single-column + thumbnails) → Task 10. Feature B: discovery (Task 2), inference call (Task 3), label→hour mapping (Task 4), threading through persist/run-search/route (Tasks 5-7), store (Task 8), UI unlock (Task 9). `SearchResponse` type change (Task 1) underlies everything. Every section of the spec has a task.
- **Non-goals respected:** no task touches `WeatherEstimateWidget`/`DetectedObjectsWidget`; `timeOfDay` is never written to any DB column/table (Task 5 explicitly keeps it in-memory-only, docstring says so); the "Instalar" button's `onInstall={noop}` is untouched (Task 9 doesn't change it); `PAGE_SIZE` is untouched (Task 10 doesn't change it).
- **Type consistency:** `{ label: string; score: number } | null` is the exact same shape used in `SearchResponse.timeOfDay` (Task 1), `PersistSearchArgs.timeOfDay` (Task 5), `RunSearchDeps.classifyTimeOfDay`'s return type (Task 6), the estimate route's dep implementation (Task 7), `useSearchStore`'s `timeOfDay` field (Task 8), and what `hourForLabel` (Task 4) consumes via `.label` in `ResultsPanel.tsx` (Task 9) — no renaming drift anywhere.
- **Task order:** Task 1 (shared type) before everything, since Tasks 5/6/7/8/9 all reference `SearchResponse.timeOfDay`. Tasks 2/3/4 are independent of each other and of Task 1, but come before 5-9 which consume them. Task 10 has no dependency on any other task and could run in parallel with the Feature B chain.
