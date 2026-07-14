# API-first architecture (Epic A) — design spec

Status: approved (design phase) — implementation not started.
Related: `docs/superpowers/backlog/2026-07-14-api-first-model-catalog-initiative.md`
(Epic A) — the foundation Epic B (model catalog), Epic C (Lumi Preview
unification), and Epic D (a future Claude skill) all build on.

## Context

The user wants every capability the project has — today's and anything
built in the future — exposed as a real, addressable API, with `apps/web`
consuming it like any other client instead of having privileged direct
access.

A grounding finding changed the shape of this work: `apps/web` already has
**no** direct DB access outside `apps/web/app/api/**` — every page/
component that touches data does so via `fetch` to this app's own API
routes. And `POST /api/search` (image → clustered candidate regions with
scores) plus `POST /api/search/:searchId/refine` (candidates → geometric-
verification-scored refined result) are, structurally, already almost
exactly the "estimation" and "refinement" endpoints the user described —
`SearchResponse`/`RefineResponse` (`packages/shared-types/src/search.ts`)
already carry candidate coordinates + score, and refined candidates +
verification score.

So this epic is much less "build a new API from scratch" than it first
looked. The real gaps are: these endpoints aren't namespaced per model
(there's only ever been one model, so it never needed to be), there's no
model-listing/self-description endpoint, and there's no way to get back a
shareable result view instead of raw JSON.

## Goals

- Every model-invoking endpoint lives under a per-model namespace
  (`/api/models/{modelId}/...`), so a future second model doesn't require
  redesigning URLs — it just gets its own.
- `GET /api/models` self-describes the registry: each model's id, version,
  status, and its own endpoints with a short usage description — enough
  for an external tool (or a future Claude skill) to learn how to call
  everything without any separate documentation system.
- A shareable result view (`/results/{searchId}`) reusing the app's real,
  existing map UI — not a new visual design — backed by a real JSON read
  endpoint (`GET /api/searches/{searchId}`) any external tool can also call.
- No regression to today's estimate/refine behavior — same underlying
  logic (`runSearch`/`runRefine`), just relocated and validated.

## Non-goals

- Authentication/API keys — this project's existing documented trust
  boundary (self-hosted, trusted local network, no auth) is unchanged;
  adding auth is a separate, bigger piece of work not undertaken here.
- A formal OpenAPI/Swagger spec — `GET /api/models`'s self-describing JSON
  satisfies the stated need (a tool/skill learning how to call the API)
  without the ongoing maintenance cost of schema annotations on every
  route. Nothing here precludes adding OpenAPI later if a real second
  consumer beyond this app's frontend and a future Claude skill needs
  generic tooling (Postman, Swagger UI) — the route structure doesn't
  change either way.
- The model catalog itself (Epic B — uploadable model versions, benchmark
  gating) and the Lumi Preview/Laila unification (Epic C) — this epic only
  establishes the API surface/namespace convention those will slot into;
  it doesn't build them.
- A static-image map renderer — the result subpage reuses the existing
  interactive MapLibre/Mapbox-gl stack, not a second rendering path.

## Architecture

### Per-model namespace

`POST /api/search` and `POST /api/search/:searchId/refine` are **renamed**
(not aliased — no external consumers exist yet to break) to:

- `POST /api/models/{modelId}/estimate`
- `POST /api/models/{modelId}/refine`

`{modelId}` is validated against two things before either route does any
work: (1) it must exist in `RETRIEVAL_MODELS`
(`packages/shared-types/src/models.ts`) — unknown id → `404`; (2) it must
be the `RETRIEVAL_MODEL` currently active in `system_settings` — a known
but not-currently-loaded model → `409` with a message naming which model
*is* active (only one model can be loaded in the inference service at a
time, spec §15.4 — silently running against whatever's active instead of
the one the caller asked for would be a worse failure mode than a clear
error).

Both endpoints are namespaced by the **retrieval** model's id, not the
verification model's — `refine` is the continuation of the same product
pipeline the estimate call started (this is also the direction Epic C's
Lumi Preview unification is heading: one product-facing identity per
pipeline, whatever runs underneath it).

Internally, nothing about `runSearch`/`runRefine`
(`apps/web/lib/search/run-search.ts`, `run-refine.ts`) changes — they're
reused exactly as they are today, just called from the new route paths
after the `modelId` check.

### `GET /api/models`

Self-describing catalog of what's callable right now. For each entry in
`RETRIEVAL_MODELS`:

```json
{
  "models": [
    {
      "id": "lumi-preview",
      "displayName": "Lumi Preview",
      "status": "preview",
      "version": "1.0",
      "endpoints": {
        "estimate": {
          "method": "POST",
          "path": "/api/models/lumi-preview/estimate",
          "description": "Sube una imagen (multipart/form-data, campo \"image\"); devuelve regiones candidatas con su score."
        },
        "refine": {
          "method": "POST",
          "path": "/api/models/lumi-preview/refine",
          "description": "Envía un regionId de una estimación previa; devuelve los candidatos de esa región re-puntuados por verificación geométrica (streaming SSE)."
        }
      }
    }
  ]
}
```

Plain data assembled from the existing registry — no new persistence,
no OpenAPI generation, nothing beyond what's already in
`RETRIEVAL_MODELS`.

### `GET /api/searches/{searchId}` + `/results/{searchId}`

**`GET /api/searches/{searchId}`** — deliberately **outside** the
`/api/models/` namespace: unlike `estimate`/`refine`, this doesn't invoke
any model, it reads back an already-persisted result (regions, candidates,
and refinement data if it's run), so there's no ambiguity a `modelId` would
resolve — the `searchId` alone fully determines the record. Returns `404`
if the id doesn't exist.

**`/results/{searchId}`** (new page, `apps/web/app/results/[searchId]/
page.tsx`) — a Server Component rendering the **exact same** map +
result-card UI the interactive dashboard already uses (`TopResultCard`,
`ResultsPanel`/`RefinedCandidateCard`, the real MapLibre/Mapbox-gl map),
hydrated from one specific stored search instead of live client state.
This is not a new visual design — approved mockup (below) mirrors the
existing components' exact classes/structure. Works whether the search
has only an estimation or has also been refined. Missing `searchId` →
Next.js `notFound()`.

**Architecture note, called out explicitly because it's the one place this
spec takes a standard shortcut without a dedicated question:** the page's
Server Component calls the same internal read function `GET /api/searches/
{searchId}` also calls, rather than making its own HTTP round-trip against
its own API. This is ordinary Next.js practice (avoiding a same-process
network hop) and doesn't weaken "the web is a consumer, not privileged" —
the property that matters is that no capability exists *only* for this
page; everything it shows is independently fetchable via
`GET /api/searches/{searchId}` by any other tool.

## Error handling

- `estimate`/`refine`: unknown `modelId` → `404`; known but inactive → `409`
  naming the actually-active model. All other failure modes unchanged from
  today's `runSearch`/`runRefine` (`400` invalid input, `502` inference/DB
  failure).
- `GET /api/searches/{searchId}`: `404` for an unknown id.
- `/results/{searchId}`: unknown id → Next.js `notFound()`, not a crash.

## Testing

- Unit: the `modelId` validator — unknown id → `404`-equivalent, known-but-
  inactive → `409`-equivalent, active → passes through — against a fake
  registry + fake active-model setting.
- The existing `runSearch`/`runRefine` unit tests move as-is to the new
  route test files — same assertions, only the HTTP path under test changes.
- Unit: `GET /api/models` returns the expected self-describing shape
  (id/status/version/endpoints with method+path+description) for the
  current single-model registry.
- Unit: `GET /api/searches/{searchId}` returns `404` for an unknown id, and
  the full JSON (with and without refinement data) for an existing one.
- Manual: open `/results/{searchId}` for a real search, confirm the map
  renders regions/candidates; refine it and confirm the refined location +
  confidence badge appear, matching the interactive dashboard's own look.

Mockup (approved 2026-07-14, served locally during design, not persisted
as a public artifact URL): `results-subpage-mockup.html`, this session's
scratchpad — built to mirror `AppShell`/`TopResultCard`/
`RefinedCandidateCard`'s exact real classes/colors/structure, not a new
design (an earlier schematic-map version was rejected specifically for not
looking like the real app).
