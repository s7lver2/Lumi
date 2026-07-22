# External API Authentication (API Keys) — Design

## Goal

Let the app's existing API be called from genuinely external clients (not
this app's own browser UI or its worker process), gated by API keys
generated and managed from `/settings`. This is explicitly the first step
of a real authentication system for this project — today the app has
**zero** authentication anywhere (confirmed: it's self-hosted on a
trusted local network by design, per an existing code comment in
`apps/web/app/api/setup/run/[step]/route.ts`).

## Why this needs care: three kinds of caller, not two

Before this project, "who calls `apps/web`'s API" was assumed to be just
the browser. It isn't: `apps/worker` also calls `apps/web`'s own routes
directly over HTTP today (confirmed live: `POST /api/models/{modelId}/estimate`
and `GET /api/library/{id}/bytes`, from `apps/worker/src/index.ts`). Any
gate on these routes must keep both of those working without a key, while
requiring one for anyone else.

## 1. Architecture: gate existing routes (not a parallel API surface)

Chosen over building a separate `/api/v1/...` surface (which would have
been lower-risk but meant maintaining two entry points to the same
functionality). Enforcement lives in one place — `apps/web/middleware.ts`
(Next.js middleware, runs before every matched route) — rather than
repeated per-route checks, so adding the gate doesn't mean touching every
existing route file individually.

## 2. Three-layer trust model

A request is allowed through if it satisfies **any** of these, checked in
order:

1. **Internal (worker) traffic** — a request carrying a valid
   `X-Internal-Secret` header matching `INTERNAL_API_SECRET`. This value
   is generated once and persisted the same way
   `SETTINGS_ENCRYPTION_KEY` already is (auto-generated on first boot if
   unset, written to a file both `apps/web` and `apps/worker` read from
   the shared root `.env`/settings mechanism). The browser never sees
   this value.
2. **Internal (browser) traffic** — a request carrying a valid httpOnly
   session cookie, issued automatically on a visitor's first request (no
   login required yet — this is deliberately the seed of a real session
   system, not a full one). A third-party caller who has never loaded the
   app's own pages cannot have this cookie.
3. **External traffic** — anything else must carry
   `Authorization: Bearer <api_key>` matching an active, non-revoked key
   in `api_keys`, and that key must be authorized for whatever
   model/route it's hitting (see §4) and within its quota (see §5).
   Missing or invalid → `401`.

**Explicit exceptions** (no key required, cookie-layer only): `/setup/*`
routes (the app isn't configured yet during first run — there's no
session/model/quota concept to check against) and `/settings/*` routes
(a user must be able to create their very first API key from the browser
before any key exists to check against).

## 3. Storage

New table:

```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  authorized_model_ids TEXT[] NOT NULL,
  quota_limit INTEGER NOT NULL,
  quota_period TEXT NOT NULL, -- 'day' | 'month'
  request_count INTEGER NOT NULL DEFAULT 0,
  quota_period_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);
```

The raw key is never stored — only `key_hash` (a standard one-way hash,
e.g. SHA-256, of the generated key value). The full key is shown to the
user exactly once, at creation time, matching the GitHub/Stripe-style
pattern the user confirmed. `request_count`/`quota_period_started_at`
reset when the current period elapses (checked lazily on each request,
not via a cron job — if `now() > quota_period_started_at + interval`,
reset both before checking/incrementing).

## 4. Authorized models

Each key stores `authorized_model_ids: text[]` — a subset of
`RETRIEVAL_MODELS`' ids (today: `lumi-preview`, and `lumi-2` once that
project lands). A request using a model the key isn't authorized for is
rejected with `403`, distinct from the `401` an invalid/missing key gets.

## 5. Quota — simple and independent, not tied to the usage-metrics redesign

Deliberately not integrated with the separate usage/cost-tracking redesign
(a different project, brainstormed independently — see its own spec).
Each key just has `quota_limit` + `quota_period` (`day` or `month`) and a
raw request counter, checked/incremented per request. This can be
enriched later once the usage-metrics redesign lands, without requiring
this project to wait on that one.

## 6. Settings UI

The approved mockup: a new "API Keys" section in `/settings`, matching
the app's real visual tokens (confirmed against `tailwind.config.ts` —
`panel`/`elevated`/`border`/`accent` (white, `#f2f3f5`, NOT the teal used
elsewhere for score gauges) — not approximated from memory). Shows:

- A list of keys, each as a card: name, masked key (`lumi_sk_••••••••1234`),
  active/revoked badge, authorized-model chips, quota usage (a small
  RingGauge-style ring — reusing the app's existing gauge visual
  language, animated filling in on load), last-used timestamp, a
  "Revocar" button.
- A "+ Nueva key" flow: name field, model-authorization chips, quota
  value + period picker, a "Generar key" button.
- After generation: a one-time reveal card showing the full key in
  monospace with a "Copiar" button (clipboard copy with a brief "¡Copiado!"
  confirmation) and an explicit warning that it won't be shown again.

## Out of scope

- A full user-login/account system — this project only adds the
  session-cookie seed a real one would build on, not the real thing.
- Tying quota to the usage-metrics redesign (separate project, see §5).
- A separate `/api/v1/...` namespace — rejected in favor of gating
  existing routes directly (the riskier but chosen option).
- Per-route (as opposed to per-model) authorization granularity for keys.
