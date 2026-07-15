# API-first Architecture (Epic A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move today's estimate/refine flow under a per-model API namespace (`/api/models/{modelId}/...`), add a self-describing `GET /api/models` catalog endpoint, and add a shareable `/results/{searchId}` view backed by a real `GET /api/searches/{searchId}` JSON endpoint — reusing the app's real map UI, not a new design.

**Architecture:** `runSearch`/`runRefine` (`apps/web/lib/search/run-search.ts`, `run-refine.ts`) are reused byte-for-byte; only their route locations and a new `modelId` gate change. A new pure `validateModelId` helper checks the URL's `{modelId}` against the model registry and the currently-active `RETRIEVAL_MODEL` setting before either route runs. The results page is a thin Server Component that reads the same persisted data `GET /api/searches/{searchId}` also reads, then hands it to a Client Component that hydrates the existing `useSearchStore` and renders the same `MapCanvas`/`TopResultCard`/`ResultsPanel` tree the live dashboard already uses.

**Tech Stack:** Next.js API routes + App Router pages (Node runtime), `pg`, Zustand (`useSearchStore`), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-api-first-architecture-design.md` — read it before starting; every task below implements one of its sections.
- The old `POST /api/search` and `POST /api/search/:searchId/refine` routes are **deleted**, not aliased — no external consumer exists yet to break.
- No auth added anywhere in this plan (spec's explicit non-goal) — every new route inherits this project's existing "self-hosted, trusted network" boundary.
- No OpenAPI/schema-generation tooling (spec's explicit non-goal) — `GET /api/models` is hand-written JSON.
- All new user-facing copy is in Spanish, matching the rest of the app.
- Follow existing conventions exactly: API route tests mock imported lib modules via `vi.mock` and call the exported handler directly with a real `Request` (see `apps/web/app/api/health/route.test.ts`); dynamic route segments follow this project's existing `[paramName]` folder convention (already used by `apps/web/app/api/search/[searchId]/refine/route.ts` and `apps/web/app/api/areas/[id]/route.ts`).

---

### Task 1: `RefineRequest` gains `searchId`

**Files:**
- Modify: `packages/shared-types/src/search.ts`
- Modify: `packages/shared-types/src/search.test.ts` (create if it doesn't exist yet)

**Interfaces:**
- Produces: `RefineRequest { searchId: string; regionId: string }` — Task 4's refine route and Task 5's frontend both use this shape. (Previously `searchId` came from the URL path; the new per-model URL has no room for it, so it moves into the body.)

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared-types/src/search.test.ts
import { describe, it, expect } from "vitest";
import type { RefineRequest } from "./search";

describe("RefineRequest", () => {
  it("carries both searchId and regionId in the body (no longer just regionId)", () => {
    const body: RefineRequest = { searchId: "search-1", regionId: "region-1" };
    expect(body.searchId).toBe("search-1");
    expect(body.regionId).toBe("region-1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @netryx/shared-types test search`
Expected: FAIL — TypeScript error, `searchId` doesn't exist on `RefineRequest`.

- [ ] **Step 3: Add the field**

In `packages/shared-types/src/search.ts`, change:

```ts
/** Body of POST /api/search/:searchId/refine (Pass 2). */
export interface RefineRequest {
  regionId: string;
}
```

to:

```ts
/** Body of POST /api/models/{modelId}/refine (Pass 2) — searchId moved into
 * the body once the URL became per-model instead of per-search. */
export interface RefineRequest {
  searchId: string;
  regionId: string;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @netryx/shared-types test search`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/search.ts packages/shared-types/src/search.test.ts
git commit -m "feat(shared-types): move searchId into RefineRequest's body"
```

---

### Task 2: `validateModelId` helper

**Files:**
- Create: `apps/web/lib/models/validate-model-id.ts`
- Create: `apps/web/lib/models/validate-model-id.test.ts`

**Interfaces:**
- Produces: `type ModelIdCheck = { ok: true } | { ok: false; status: 404 | 409; error: string }`, `validateModelId(modelId: string, knownIds: string[], activeModelId: string): ModelIdCheck` — Task 3's estimate route and Task 4's refine route both call this first.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/models/validate-model-id.test.ts
import { describe, it, expect } from "vitest";
import { validateModelId } from "./validate-model-id";

describe("validateModelId", () => {
  it("passes when modelId is known and currently active", () => {
    expect(validateModelId("lumi-preview", ["lumi-preview"], "lumi-preview")).toEqual({ ok: true });
  });

  it("404s on an unknown modelId", () => {
    const result = validateModelId("nope", ["lumi-preview"], "lumi-preview");
    expect(result).toEqual({ ok: false, status: 404, error: expect.stringContaining("nope") });
  });

  it("409s on a known modelId that isn't the currently active one", () => {
    const result = validateModelId("future-model", ["lumi-preview", "future-model"], "lumi-preview");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("future-model");
      expect(result.error).toContain("lumi-preview");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/models/validate-model-id`
Expected: FAIL — `Cannot find module './validate-model-id'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/models/validate-model-id.ts

export type ModelIdCheck =
  | { ok: true }
  | { ok: false; status: 404; error: string }
  | { ok: false; status: 409; error: string };

/**
 * Gates every per-model endpoint (spec's "Per-model namespace" section).
 * Unknown modelId -> 404. Known but not the currently-loaded model -> 409,
 * naming which one IS active — only one model can be loaded in the
 * inference service at a time (spec §15.4), so silently running against
 * whatever's active instead of the one the caller asked for would be a
 * worse failure than a clear error.
 */
export function validateModelId(modelId: string, knownIds: string[], activeModelId: string): ModelIdCheck {
  if (!knownIds.includes(modelId)) {
    return { ok: false, status: 404, error: `Unknown model id: ${modelId}` };
  }
  if (modelId !== activeModelId) {
    return {
      ok: false,
      status: 409,
      error: `Model "${modelId}" is not currently active — the active retrieval model is "${activeModelId}".`,
    };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/models/validate-model-id`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/models/validate-model-id.ts apps/web/lib/models/validate-model-id.test.ts
git commit -m "feat(web): add validateModelId helper for per-model endpoints"
```

---

### Task 3: `POST /api/models/[modelId]/estimate`

**Files:**
- Create: `apps/web/app/api/models/[modelId]/estimate/route.ts`
- Create: `apps/web/app/api/models/[modelId]/estimate/route.test.ts`
- Delete: `apps/web/app/api/search/route.ts`

**Interfaces:**
- Consumes: `validateModelId` (Task 2), `RETRIEVAL_MODELS` (`@netryx/shared-types`), `runSearch` (`apps/web/lib/search/run-search.ts`, unchanged).
- Produces: `POST(request, {params: {modelId}})` at the new path — Task 5's frontend calls this.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/api/models/[modelId]/estimate/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../../lib/settings-repo", () => ({
  getSettingsRepo: vi.fn(() => ({ getSetting: vi.fn().mockResolvedValue("lumi-preview") })),
}));
vi.mock("../../../../../lib/search/run-search", () => ({ runSearch: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(form: FormData) {
  return new Request("http://localhost/api/models/lumi-preview/estimate", { method: "POST", body: form });
}

describe("POST /api/models/[modelId]/estimate", () => {
  it("404s on an unknown modelId, never calling runSearch", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    const { POST } = await import("./route");

    const form = new FormData();
    form.append("image", new File([new Uint8Array([1])], "a.jpg"));
    const res = await POST(makeRequest(form), { params: { modelId: "nonexistent-model" } });

    expect(res.status).toBe(404);
    expect(runSearch).not.toHaveBeenCalled();
  });

  it("409s when modelId is known but not the active model", async () => {
    const { getSettingsRepo } = await import("../../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue("some-other-active-model") });

    const { POST } = await import("./route");
    const form = new FormData();
    form.append("image", new File([new Uint8Array([1])], "a.jpg"));
    const res = await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });

    expect(res.status).toBe(409);
  });

  it("runs the search and returns its result when modelId matches the active model", async () => {
    const { runSearch } = await import("../../../../../lib/search/run-search");
    (runSearch as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {} });

    const { POST } = await import("./route");
    const form = new FormData();
    form.append("image", new File([new Uint8Array([1])], "a.jpg"));
    const res = await POST(makeRequest(form), { params: { modelId: "lumi-preview" } });
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.searchId).toBe("s1");
  });

  it("400s when no image field is present", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest(new FormData()), { params: { modelId: "lumi-preview" } });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test app/api/models/lumi-preview/estimate`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/models/[modelId]/estimate/route.ts
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  RETRIEVAL_MODELS,
  DEFAULT_TOP_K,
  DEFAULT_REGION_RADIUS_M,
  DEFAULT_QUERY_EXPANSION_SIZE,
} from "@netryx/shared-types";
import { getPool } from "../../../../../lib/db";
import { getSettingsRepo } from "../../../../../lib/settings-repo";
import { validateModelId } from "../../../../../lib/models/validate-model-id";
import { saveQueryImage } from "../../../../../lib/query-image-store";
import { embedQueryImage } from "../../../../../lib/inference-client";
import { retrieveCandidates } from "../../../../../lib/search/retrieval";
import { queryExpansionRerank } from "../../../../../lib/search/rerank";
import { clusterCandidates } from "../../../../../lib/search/cluster";
import { persistSearch } from "../../../../../lib/search/persist";
import { runSearch, type RunSearchDeps } from "../../../../../lib/search/run-search";

function extFromType(type: string): string {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  return "jpg";
}

export async function POST(request: Request, { params }: { params: { modelId: string } }) {
  const activeModelId = (await getSettingsRepo().getSetting("RETRIEVAL_MODEL")) ?? "lumi-preview";
  const check = validateModelId(params.modelId, RETRIEVAL_MODELS.map((m) => m.id), activeModelId);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data with an \"image\" field" },
      { status: 400 }
    );
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "image file is required" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const imageBase64 = bytes.toString("base64");
  const imageExt = extFromType(file.type);

  const pool = getPool();
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";

  const deps: RunSearchDeps = {
    newSearchId: () => randomUUID(),
    embedQuery: (b64) => embedQueryImage(b64, inferenceBaseUrl),
    retrieve: (embedding) => retrieveCandidates(pool, embedding, DEFAULT_TOP_K),
    rerank: (embedding, candidates) =>
      queryExpansionRerank(embedding, candidates, DEFAULT_QUERY_EXPANSION_SIZE),
    cluster: (candidates) => clusterCandidates(candidates, DEFAULT_REGION_RADIUS_M),
    saveImage: (searchId, b, ext) => saveQueryImage(searchId, b, ext),
    persist: (args) => persistSearch(pool, args),
  };

  try {
    const result = await runSearch(deps, { imageBase64, imageBytes: bytes, imageExt });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test app/api/models/lumi-preview/estimate`
Expected: PASS (4 tests).

- [ ] **Step 5: Delete the old route**

```bash
rm apps/web/app/api/search/route.ts
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors (Task 5 fixes the now-broken `SearchDashboard.tsx` call site — a transient break between this task and Task 5 is expected and fine within one implementation pass).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/models/\[modelId\]/estimate/route.ts apps/web/app/api/models/\[modelId\]/estimate/route.test.ts
git rm apps/web/app/api/search/route.ts
git commit -m "feat(web): move POST /api/search to POST /api/models/[modelId]/estimate"
```

---

### Task 4: `POST /api/models/[modelId]/refine`

**Files:**
- Create: `apps/web/app/api/models/[modelId]/refine/route.ts`
- Create: `apps/web/app/api/models/[modelId]/refine/route.test.ts`
- Delete: `apps/web/app/api/search/[searchId]/refine/route.ts`

**Interfaces:**
- Consumes: `validateModelId` (Task 2), `RefineRequest` with `searchId` (Task 1), `runRefine` (`apps/web/lib/search/run-refine.ts`, unchanged).
- Produces: `POST(request, {params: {modelId}})` — same SSE event shape as today (`{type: "progress", ...}`, `{type: "done", result}`, `{type: "error", message}`).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/api/models/[modelId]/refine/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../../lib/settings-repo", () => ({
  getSettingsRepo: vi.fn(() => ({ getSetting: vi.fn().mockResolvedValue("lumi-preview") })),
}));
vi.mock("../../../../../lib/search/run-refine", () => ({ runRefine: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/models/lumi-preview/refine", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readEvents(res: Response) {
  const text = await res.text();
  return text.split("\n\n").filter((c) => c.startsWith("data: ")).map((c) => JSON.parse(c.slice("data: ".length)));
}

describe("POST /api/models/[modelId]/refine", () => {
  it("400s when regionId is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ searchId: "s1" }), { params: { modelId: "lumi-preview" } });
    expect(res.status).toBe(400);
  });

  it("404s on an unknown modelId before touching runRefine", async () => {
    const { runRefine } = await import("../../../../../lib/search/run-refine");
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ searchId: "s1", regionId: "r1" }), { params: { modelId: "nonexistent" } });
    expect(res.status).toBe(404);
    expect(runRefine).not.toHaveBeenCalled();
  });

  it("streams a done event with runRefine's result on success", async () => {
    const { runRefine } = await import("../../../../../lib/search/run-refine");
    (runRefine as any).mockResolvedValue({ searchId: "s1", regionId: "r1", candidates: [] });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ searchId: "s1", regionId: "r1" }), { params: { modelId: "lumi-preview" } });
    const events = await readEvents(res);

    expect(events.some((e) => e.type === "done" && e.result.searchId === "s1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test app/api/models/lumi-preview/refine`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/models/[modelId]/refine/route.ts
import { RETRIEVAL_MODELS, DEFAULT_CONFIRM_THRESHOLD, type RefineRequest } from "@netryx/shared-types";
import { getPool } from "../../../../../lib/db";
import { getSettingsRepo } from "../../../../../lib/settings-repo";
import { validateModelId } from "../../../../../lib/models/validate-model-id";
import { verifyCandidates } from "../../../../../lib/verify-client";
import { expandRegionCandidates } from "../../../../../lib/search/refine-retrieval";
import { readImageBase64 } from "../../../../../lib/search/candidate-images";
import { persistRefine } from "../../../../../lib/search/refine-persist";
import { runRefine, type RunRefineDeps } from "../../../../../lib/search/run-refine";

export async function POST(request: Request, { params }: { params: { modelId: string } }) {
  const body = (await request.json()) as RefineRequest;
  if (!body.searchId || !body.regionId) {
    return new Response(JSON.stringify({ error: "searchId and regionId are required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const activeModelId = (await getSettingsRepo().getSetting("RETRIEVAL_MODEL")) ?? "lumi-preview";
  const check = validateModelId(params.modelId, RETRIEVAL_MODELS.map((m) => m.id), activeModelId);
  if (!check.ok) {
    return new Response(JSON.stringify({ error: check.error }), {
      status: check.status,
      headers: { "content-type": "application/json" },
    });
  }

  const pool = getPool();
  const repo = getSettingsRepo();
  const inferenceBaseUrl = process.env.INFERENCE_SERVICE_URL ?? "http://localhost:8000";
  const confirmThreshold = Number(
    (await repo.getSetting("VERIFICATION_CONFIRM_THRESHOLD")) ?? String(DEFAULT_CONFIRM_THRESHOLD)
  );

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      const startedAt = Date.now();

      const deps: RunRefineDeps = {
        confirmThreshold,
        getQueryImagePath: async (searchId) => {
          const { rows } = await pool.query(
            `SELECT query_image_path FROM searches WHERE id = $1`,
            [searchId]
          );
          if (rows.length === 0) throw new Error(`Search ${searchId} not found`);
          return rows[0].query_image_path as string;
        },
        expandRegion: (regionId) => expandRegionCandidates(pool, regionId),
        readImage: (path) => readImageBase64(path),
        verify: (q, cands) => verifyCandidates(q, cands, inferenceBaseUrl),
        persist: (args) => persistRefine(pool, args),
        onProgress: (verified, total) => {
          const elapsedMs = Date.now() - startedAt;
          const etaMs = verified > 0 ? Math.round((elapsedMs / verified) * (total - verified)) : null;
          send({ type: "progress", verified, total, elapsedMs, etaMs });
        },
      };

      try {
        const result = await runRefine(deps, { searchId: body.searchId, regionId: body.regionId });
        send({ type: "done", result });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test app/api/models/lumi-preview/refine`
Expected: PASS (3 tests).

- [ ] **Step 5: Delete the old route**

```bash
rm apps/web/app/api/search/\[searchId\]/refine/route.ts
rmdir apps/web/app/api/search/\[searchId\] 2>/dev/null || true
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/models/\[modelId\]/refine/route.ts apps/web/app/api/models/\[modelId\]/refine/route.test.ts
git rm -r apps/web/app/api/search/\[searchId\]
git commit -m "feat(web): move POST /api/search/:id/refine to POST /api/models/[modelId]/refine"
```

---

### Task 5: Update `SearchDashboard.tsx`'s two call sites

**Files:**
- Modify: `apps/web/app/components/SearchDashboard.tsx`

**Interfaces:**
- Consumes: `POST /api/models/[modelId]/estimate` (Task 3), `POST /api/models/[modelId]/refine` (Task 4), `RETRIEVAL_MODELS` (`@netryx/shared-types`).

- [ ] **Step 1: Add the import and resolve the active model id client-side**

Add to the imports:

```ts
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
```

Add this near the top of the component body (same convention `apps/web/app/components/UploadPopup.tsx` already uses to pick "the" model client-side):

```ts
const activeModelId = RETRIEVAL_MODELS[0]?.id ?? "lumi-preview";
```

- [ ] **Step 2: Update the estimate call**

Change:

```ts
    const { ok, data } = await fetchJson("/api/search", { method: "POST", body: form });
```

to:

```ts
    const { ok, data } = await fetchJson(`/api/models/${activeModelId}/estimate`, { method: "POST", body: form });
```

- [ ] **Step 3: Update the refine call**

Change:

```ts
    const res = await fetch(`/api/search/${currentSearchId}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regionId }),
    });
```

to:

```ts
    const res = await fetch(`/api/models/${activeModelId}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ searchId: currentSearchId, regionId }),
    });
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run the dev stack, upload an image on the dashboard, confirm regions still appear (now via `/api/models/lumi-preview/estimate`), then click "Refinar" and confirm the SSE progress + final confirmed candidate still work (now via `/api/models/lumi-preview/refine`). Check the browser Network tab to confirm the new URLs are actually being called.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/SearchDashboard.tsx
git commit -m "feat(web): call the new per-model estimate/refine endpoints from the dashboard"
```

---

### Task 6: `GET /api/models`

**Files:**
- Create: `apps/web/app/api/models/route.ts`
- Create: `apps/web/app/api/models/route.test.ts`

**Interfaces:**
- Consumes: `RETRIEVAL_MODELS` (`@netryx/shared-types`).
- Produces: `GET(): Promise<Response>` returning `{ models: Array<{id, displayName, status, version, endpoints: {estimate, refine}}> }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/api/models/route.test.ts
import { describe, it, expect } from "vitest";

describe("GET /api/models", () => {
  it("self-describes every retrieval model's id/status/version and its own endpoints", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    const lumiPreview = json.models.find((m: any) => m.id === "lumi-preview");
    expect(lumiPreview).toBeDefined();
    expect(lumiPreview.displayName).toBe("Lumi Preview");
    expect(lumiPreview.status).toBe("preview");
    expect(lumiPreview.version).toBe("1.0");
    expect(lumiPreview.endpoints.estimate).toEqual({
      method: "POST",
      path: "/api/models/lumi-preview/estimate",
      description: expect.any(String),
    });
    expect(lumiPreview.endpoints.refine).toEqual({
      method: "POST",
      path: "/api/models/lumi-preview/refine",
      description: expect.any(String),
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @netryx/web test app/api/models/route`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/models/route.ts
import { NextResponse } from "next/server";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";

export async function GET() {
  return NextResponse.json({
    models: RETRIEVAL_MODELS.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      status: m.status,
      version: m.version,
      endpoints: {
        estimate: {
          method: "POST",
          path: `/api/models/${m.id}/estimate`,
          description:
            'Sube una imagen (multipart/form-data, campo "image"); devuelve regiones candidatas con su score.',
        },
        refine: {
          method: "POST",
          path: `/api/models/${m.id}/refine`,
          description:
            "Envía un searchId + regionId de una estimación previa; devuelve los candidatos de esa región re-puntuados por verificación geométrica (streaming SSE).",
        },
      },
    })),
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @netryx/web test app/api/models/route`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/models/route.ts apps/web/app/api/models/route.test.ts
git commit -m "feat(web): add self-describing GET /api/models"
```

---

### Task 7: `GET /api/searches/[searchId]`

**Files:**
- Create: `apps/web/lib/search/get-search-result.ts`
- Create: `apps/web/lib/search/get-search-result.test.ts`
- Create: `apps/web/app/api/searches/[searchId]/route.ts`
- Create: `apps/web/app/api/searches/[searchId]/route.test.ts`

**Interfaces:**
- Produces: `getSearchResult(pool: Pool, searchId: string): Promise<SearchResponse | null>` (the shared read function — Task 8's results page calls this directly, in-process, per the spec's explicit architecture note) and `GET(request, {params: {searchId}})` (the route, which just calls `getSearchResult` and maps `null` to a 404).

- [ ] **Step 1: Write the failing tests for `getSearchResult`**

```ts
// apps/web/lib/search/get-search-result.test.ts
import { describe, it, expect, vi } from "vitest";
import { getSearchResult } from "./get-search-result";

function makePool(searchRows: any[], regionRows: any[], candidateRows: any[]) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM searches")) return { rows: searchRows };
      if (sql.includes("FROM search_regions")) return { rows: regionRows };
      if (sql.includes("FROM search_candidates")) return { rows: candidateRows };
      throw new Error(`unexpected query: ${sql}`);
    }),
  } as any;
}

describe("getSearchResult", () => {
  it("returns null when the search doesn't exist", async () => {
    const pool = makePool([], [], []);
    expect(await getSearchResult(pool, "missing")).toBeNull();
  });

  it("assembles regions and their candidates, joined against indexed_images for pano/heading/lat/lng", async () => {
    const pool = makePool(
      [{ id: "s1" }],
      [{ id: "r1", lat: "40.42", lng: "-3.70", radius_m: 150, aggregate_score: "0.9", candidate_count: 1 }],
      [
        {
          id: "c1", region_id: "r1", indexed_image_id: "img1",
          similarity_score: "0.8", verification_score: "0.84", rank: 1, status: "confirmed",
          pano_id: "abc123", heading: 0, lat: "40.4201", lng: "-3.7002",
        },
      ]
    );

    const result = await getSearchResult(pool, "s1");

    expect(result).not.toBeNull();
    expect(result!.searchId).toBe("s1");
    expect(result!.regions).toEqual([
      { id: "r1", centroid: { lat: 40.42, lng: -3.7 }, radiusM: 150, aggregateScore: 0.9, candidateCount: 1 },
    ]);
    expect(result!.candidatesByRegion.r1).toEqual([
      {
        id: "c1", regionId: "r1", indexedImageId: "img1",
        panoId: "abc123", heading: 0, lat: 40.4201, lng: -3.7002,
        similarityScore: 0.8, verificationScore: 0.84, rank: 1, status: "confirmed",
      },
    ]);
  });

  it("omits candidates with no region_id from candidatesByRegion (matches persistSearch's own behavior)", async () => {
    const pool = makePool(
      [{ id: "s1" }],
      [],
      [
        {
          id: "c1", region_id: null, indexed_image_id: "img1",
          similarity_score: "0.5", verification_score: null, rank: 1, status: "unreviewed",
          pano_id: "abc123", heading: 0, lat: "40.0", lng: "-3.0",
        },
      ]
    );
    const result = await getSearchResult(pool, "s1");
    expect(result!.candidatesByRegion).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @netryx/web test lib/search/get-search-result`
Expected: FAIL — `Cannot find module './get-search-result'`.

- [ ] **Step 3: Write `getSearchResult`**

```ts
// apps/web/lib/search/get-search-result.ts
import type { Pool } from "pg";
import type { SearchResponse, SearchRegion, SearchCandidate } from "@netryx/shared-types";

/**
 * Reads back an already-persisted search (spec: "GET /api/searches/
 * {searchId} + /results/{searchId}" section) — search_candidates doesn't
 * store panoId/heading/lat/lng itself (only indexed_image_id,
 * similarity_score, verification_score, rank, status; see persist.ts/
 * refine-persist.ts), so this JOINs against indexed_images to reconstruct
 * the full SearchCandidate shape. Returns null (not a thrown error) for an
 * unknown searchId — the caller (the route, and the results page) decides
 * how to surface that (404 / notFound()).
 */
export async function getSearchResult(pool: Pool, searchId: string): Promise<SearchResponse | null> {
  const { rows: searchRows } = await pool.query(`SELECT id FROM searches WHERE id = $1`, [searchId]);
  if (searchRows.length === 0) return null;

  const { rows: regionRows } = await pool.query(
    `SELECT id, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng,
            radius_m, aggregate_score, candidate_count
     FROM search_regions WHERE search_id = $1`,
    [searchId]
  );
  const regions: SearchRegion[] = regionRows.map((r) => ({
    id: r.id,
    centroid: { lat: Number(r.lat), lng: Number(r.lng) },
    radiusM: r.radius_m,
    aggregateScore: Number(r.aggregate_score),
    candidateCount: r.candidate_count,
  }));

  const { rows: candidateRows } = await pool.query(
    `SELECT sc.id, sc.region_id, sc.indexed_image_id, sc.similarity_score, sc.verification_score,
            sc.rank, sc.status, ii.pano_id, ii.heading,
            ST_Y(ii.location::geometry) AS lat, ST_X(ii.location::geometry) AS lng
     FROM search_candidates sc
     JOIN indexed_images ii ON ii.id = sc.indexed_image_id
     WHERE sc.search_id = $1
     ORDER BY sc.rank`,
    [searchId]
  );

  const candidatesByRegion: Record<string, SearchCandidate[]> = {};
  for (const r of candidateRows) {
    if (!r.region_id) continue;
    const candidate: SearchCandidate = {
      id: r.id,
      regionId: r.region_id,
      indexedImageId: r.indexed_image_id,
      panoId: r.pano_id,
      heading: r.heading,
      lat: Number(r.lat),
      lng: Number(r.lng),
      similarityScore: Number(r.similarity_score),
      verificationScore: r.verification_score === null ? null : Number(r.verification_score),
      rank: r.rank,
      status: r.status,
    };
    (candidatesByRegion[r.region_id] ??= []).push(candidate);
  }

  return { searchId, regions, candidatesByRegion };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @netryx/web test lib/search/get-search-result`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing route test**

```ts
// apps/web/app/api/searches/[searchId]/route.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../lib/db", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../../../../lib/search/get-search-result", () => ({ getSearchResult: vi.fn() }));

describe("GET /api/searches/[searchId]", () => {
  it("404s when getSearchResult returns null", async () => {
    const { getSearchResult } = await import("../../../../lib/search/get-search-result");
    (getSearchResult as any).mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/searches/missing"), { params: { searchId: "missing" } });
    expect(res.status).toBe(404);
  });

  it("returns the result JSON when found", async () => {
    const { getSearchResult } = await import("../../../../lib/search/get-search-result");
    (getSearchResult as any).mockResolvedValue({ searchId: "s1", regions: [], candidatesByRegion: {} });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/searches/s1"), { params: { searchId: "s1" } });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.searchId).toBe("s1");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @netryx/web test app/api/searches`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 7: Write the route**

```ts
// apps/web/app/api/searches/[searchId]/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";
import { getSearchResult } from "../../../../lib/search/get-search-result";

export async function GET(_request: Request, { params }: { params: { searchId: string } }) {
  const result = await getSearchResult(getPool(), params.searchId);
  if (!result) {
    return NextResponse.json({ error: "search not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm --filter @netryx/web test app/api/searches`
Expected: PASS (2 tests).

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/web/lib/search/get-search-result.ts apps/web/lib/search/get-search-result.test.ts apps/web/app/api/searches/\[searchId\]/route.ts apps/web/app/api/searches/\[searchId\]/route.test.ts
git commit -m "feat(web): add GET /api/searches/[searchId]"
```

---

### Task 8: `/results/[searchId]` page

**Files:**
- Create: `apps/web/app/results/[searchId]/page.tsx`
- Create: `apps/web/app/components/ResultsPageClient.tsx`

**Interfaces:**
- Consumes: `getSearchResult` (Task 7); `useSearchStore` (`apps/web/app/stores/useSearchStore.ts`, unchanged); `MapCanvas`, `ConfidenceCircleLayer`, `TopResultCard`, `ResultsPanel` (all unchanged, existing components).
- Produces: `ResultsPageClient({ initialResult, searchId }: { initialResult: SearchResponse; searchId: string })`.

- [ ] **Step 1: Write the Server Component page**

```tsx
// apps/web/app/results/[searchId]/page.tsx
import { notFound } from "next/navigation";
import { getPool } from "../../../lib/db";
import { getSearchResult } from "../../../lib/search/get-search-result";
import { ResultsPageClient } from "../../components/ResultsPageClient";

export default async function ResultsPage({ params }: { params: { searchId: string } }) {
  // Calls the same read function GET /api/searches/[searchId] calls, rather
  // than fetching its own API over HTTP — ordinary Next.js practice
  // (avoids a same-process network hop); the property that actually
  // matters (no capability exists ONLY for this page) is preserved since
  // GET /api/searches/[searchId] independently exposes the exact same
  // data (spec's explicit architecture note).
  const result = await getSearchResult(getPool(), params.searchId);
  if (!result) notFound();

  return <ResultsPageClient initialResult={result} searchId={params.searchId} />;
}
```

- [ ] **Step 2: Write the Client Component**

```tsx
// apps/web/app/components/ResultsPageClient.tsx
"use client";
import { useEffect, useState } from "react";
import type { SearchResponse } from "@netryx/shared-types";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { AppShell } from "./AppShell";
import { MapCanvas } from "./MapCanvas";
import { ConfidenceCircleLayer } from "./ConfidenceCircleLayer";
import { TopResultCard } from "./TopResultCard";
import { ResultsPanel } from "./ResultsPanel";
import { useSearchStore } from "../stores/useSearchStore";

const activeModelId = RETRIEVAL_MODELS[0]?.id ?? "lumi-preview";

export function ResultsPageClient({ initialResult, searchId }: { initialResult: SearchResponse; searchId: string }) {
  const [map, setMap] = useState<any>(null);
  const { regions, setSearchResults, setRefining, setRefineResults, selectRegion } = useSearchStore();
  const [refining, setRefiningLocal] = useState(false);

  useEffect(() => {
    setSearchResults(initialResult, searchId);
    // For any region whose top candidate already carries a
    // verificationScore, seed candidatesByRegion as-is — setSearchResults
    // already copies candidatesByRegion verbatim, so refined data loaded
    // from the DB shows immediately without needing a live refine call.
  }, [initialResult, searchId, setSearchResults]);

  function handleSelectRegion(regionId: string) {
    selectRegion(regionId);
  }

  async function handleRefine(regionId: string) {
    selectRegion(regionId);
    setRefining();
    setRefiningLocal(true);

    const res = await fetch(`/api/models/${activeModelId}/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ searchId, regionId }),
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

  return (
    <AppShell>
      <MapCanvas onReady={(m) => setMap(m)} />
      {map && <ConfidenceCircleLayer map={map} />}
      {regions.length > 0 && (
        <>
          <TopResultCard onRefine={handleRefine} onSelectRegion={handleSelectRegion} refining={refining} />
          <div className="absolute right-0 top-0 h-full">
            <ResultsPanel
              queryImageUrl={`/api/images/query/${searchId}`}
              onRefine={handleRefine}
              onSelectRegion={handleSelectRegion}
              refining={refining}
            />
          </div>
        </>
      )}
    </AppShell>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @netryx/web typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run the dev stack, run a real search + refine from the dashboard to get a `searchId`, then open `/results/{that searchId}` directly. Confirm: the map renders with the same regions/candidates, the top result card shows the same score, and (if refined) the refined candidate + confidence badge appear exactly as they did in the live dashboard — clicking "Refinar" again from this page should also work. Then visit `/results/00000000-0000-0000-0000-000000000000` (a non-existent id) and confirm Next.js's default not-found page appears instead of a crash.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/results/\[searchId\]/page.tsx apps/web/app/components/ResultsPageClient.tsx
git commit -m "feat(web): add shareable /results/[searchId] page reusing the dashboard's real UI"
```

---

## Self-Review Notes

- **Spec coverage:** per-model namespace with the `modelId` validator (Tasks 2-4); old routes deleted, not aliased (Tasks 3-4 Step 5); frontend updated to call the new URLs (Task 5); self-describing `GET /api/models` (Task 6); `GET /api/searches/{searchId}` reading back persisted results via a JOIN against `indexed_images` for fields `search_candidates` doesn't store itself (Task 7); `/results/{searchId}` reusing the exact existing map/card components via the existing `useSearchStore`, with the explicit in-process-read architecture note followed literally, and `notFound()` for a missing id (Task 8). All spec sections covered.
- **Placeholder scan:** none — every step has complete, runnable code and exact commands/expected output.
- **Type consistency:** `RefineRequest`'s `{searchId, regionId}` (Task 1) is used identically in Task 4's route and Task 5's/Task 8's frontend call sites. `ModelIdCheck`/`validateModelId` (Task 2) is called with the same three-argument order in both Task 3 and Task 4. `getSearchResult`'s `SearchResponse | null` return (Task 7) is consumed identically by Task 7's own route and Task 8's page — same `null` → 404/`notFound()` mapping pattern in both, just via different Next.js primitives.
