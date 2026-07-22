# External API Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate every existing API route so genuinely external callers need a valid, quota-checked, model-scoped API key, while the browser UI and the worker keep working exactly as they do today, unauthenticated.

**Architecture:** Confirmed this session — Next.js 14.2.5 (this app's version) does **not** support a Node.js runtime for `middleware.ts`; that only became available experimentally in Next 15.2+. Edge middleware can't run `pg` queries. So the design splits in two: a lightweight Edge `middleware.ts` only issues the session cookie (no DB access needed for that); the actual API-key/quota check is a shared `requireApiAuth()` helper that every route handler calls as its first line (runs in the normal Node.js route runtime, where `pg` works fine).

**Tech Stack:** Next.js 14 App Router (Edge middleware + Node route handlers), Postgres, TypeScript.

## Global Constraints

- No tests in this plan — every task ends with implementation + a typecheck/build step + a commit. Do not write Vitest tests anywhere.
- `/api/setup/*` and `/api/settings/*` routes are exempt from the API-key check (cookie/internal-secret layers still apply where relevant, but no key required) — confirmed in the spec, since the app isn't configured yet during setup and a user must be able to create their first key from Settings before any key exists.
- Commits use `git add <specific files>`, never `git add -A` or `git add .`.

---

### Task 1: Schema — `api_keys` table

**Files:**
- Create: `db/migrations/1722000000000_api_keys.js`

**Interfaces:**
- Produces: `api_keys(id, name, key_hash, authorized_model_ids, quota_limit, quota_period, request_count, quota_period_started_at, created_at, revoked_at, last_used_at)` — every later task's queries depend on these exact column names.

- [ ] **Step 1: Write the migration**

```js
// db/migrations/1722000000000_api_keys.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      authorized_model_ids TEXT[] NOT NULL,
      quota_limit INTEGER NOT NULL,
      quota_period TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      quota_period_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ
    );
  `);
  pgm.sql(`CREATE UNIQUE INDEX api_keys_key_hash_idx ON api_keys (key_hash);`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE api_keys;`);
};
```

- [ ] **Step 2: Run the migration**

```bash
cd /home/s7lver/Lumi/db && pnpm run migrate:up
```

Expected: output ends with `### MIGRATION 1722000000000_api_keys (UP) ###`, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/1722000000000_api_keys.js
git commit -m "feat(db): add api_keys table for external API authentication"
```

---

### Task 2: API key generation, hashing, and repo functions

**Files:**
- Create: `apps/web/lib/api-keys.ts`

**Interfaces:**
- Produces: `generateApiKey(): { raw: string; hash: string }`, `createApiKey(pool, args): Promise<{ id: string; raw: string }>`, `listApiKeys(pool): Promise<ApiKeyRow[]>`, `revokeApiKey(pool, id): Promise<void>`, `findApiKeyByRaw(pool, raw): Promise<ApiKeyRow | null>`, `recordApiKeyUsage(pool, id): Promise<void>` — Task 4's auth helper and Task 6's Settings routes depend on these exact names.

- [ ] **Step 1: Write the module**

```ts
// apps/web/lib/api-keys.ts
import { randomBytes, createHash } from "node:crypto";
import type { Pool } from "pg";

export interface ApiKeyRow {
  id: string;
  name: string;
  maskedKey: string;
  authorizedModelIds: string[];
  quotaLimit: number;
  quotaPeriod: "day" | "month";
  requestCount: number;
  quotaPeriodStartedAt: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

const KEY_PREFIX = "lumi_sk_";

/** Generates a new raw key (shown once to the user) and its stored hash.
 * The raw value is never persisted — only `hash` goes to the database. */
export function generateApiKey(): { raw: string; hash: string } {
  const raw = KEY_PREFIX + randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

function maskKey(raw: string): string {
  return `${KEY_PREFIX}${"•".repeat(12)}${raw.slice(-4)}`;
}

export async function createApiKey(
  pool: Pool,
  args: { name: string; authorizedModelIds: string[]; quotaLimit: number; quotaPeriod: "day" | "month" }
): Promise<{ id: string; raw: string }> {
  const { raw, hash } = generateApiKey();
  const { rows } = await pool.query(
    `INSERT INTO api_keys (name, key_hash, authorized_model_ids, quota_limit, quota_period)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [args.name, hash, args.authorizedModelIds, args.quotaLimit, args.quotaPeriod]
  );
  return { id: rows[0].id, raw };
}

export async function listApiKeys(pool: Pool): Promise<ApiKeyRow[]> {
  const { rows } = await pool.query(
    `SELECT id, name, key_hash, authorized_model_ids, quota_limit, quota_period,
            request_count, quota_period_started_at, created_at, revoked_at, last_used_at
     FROM api_keys ORDER BY created_at DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    maskedKey: `${KEY_PREFIX}${"•".repeat(12)}${r.key_hash.slice(-4)}`,
    authorizedModelIds: r.authorized_model_ids,
    quotaLimit: r.quota_limit,
    quotaPeriod: r.quota_period,
    requestCount: r.request_count,
    quotaPeriodStartedAt: r.quota_period_started_at,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
  }));
}

export async function revokeApiKey(pool: Pool, id: string): Promise<void> {
  await pool.query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [id]);
}

/** Looks up an active key by its raw (as presented in an Authorization
 * header) value — hashes it and compares against key_hash, never the
 * other way around. */
export async function findApiKeyByRaw(pool: Pool, raw: string): Promise<ApiKeyRow | null> {
  const hash = createHash("sha256").update(raw).digest("hex");
  const { rows } = await pool.query(
    `SELECT id, name, key_hash, authorized_model_ids, quota_limit, quota_period,
            request_count, quota_period_started_at, created_at, revoked_at, last_used_at
     FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
    [hash]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    maskedKey: maskKey(raw),
    authorizedModelIds: r.authorized_model_ids,
    quotaLimit: r.quota_limit,
    quotaPeriod: r.quota_period,
    requestCount: r.request_count,
    quotaPeriodStartedAt: r.quota_period_started_at,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
  };
}

/** Increments request_count (resetting it first if the current quota
 * period has elapsed) and stamps last_used_at — checked lazily per
 * request, no cron job. */
export async function recordApiKeyUsage(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `UPDATE api_keys SET
       request_count = CASE
         WHEN quota_period_started_at + (CASE WHEN quota_period = 'day' THEN interval '1 day' ELSE interval '1 month' END) < now()
         THEN 1 ELSE request_count + 1
       END,
       quota_period_started_at = CASE
         WHEN quota_period_started_at + (CASE WHEN quota_period = 'day' THEN interval '1 day' ELSE interval '1 month' END) < now()
         THEN now() ELSE quota_period_started_at
       END,
       last_used_at = now()
     WHERE id = $1`,
    [id]
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api-keys.ts
git commit -m "feat(web): add API key generation, hashing, and repo functions"
```

---

### Task 3: `INTERNAL_API_SECRET` + worker header

**Files:**
- Modify: `packages/shared-types/src/settings.ts`
- Create: `apps/web/lib/internal-secret.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Produces: `getOrCreateInternalSecret(repo): Promise<string>` — auto-generates and persists via the existing settings-repo the same lazy way other secrets in this codebase already work, never asks the user for it. `apps/worker`'s two `fetch()` calls to `apps/web` gain an `X-Internal-Secret` header.

- [ ] **Step 1: Register the setting**

```ts
// packages/shared-types/src/settings.ts — add to SETTINGS_SCHEMA
  {
    key: "INTERNAL_API_SECRET",
    label: "Secreto interno worker↔web (autogenerado, no editar)",
    type: "string",
    isSecret: true,
    required: false,
  },
```

- [ ] **Step 2: Write the lazy-generate helper**

```ts
// apps/web/lib/internal-secret.ts
import { randomBytes } from "node:crypto";
import type { SettingsRepo } from "./settings-repo";

/** Auto-generates and persists a shared secret the worker uses to prove
 * its calls to apps/web's own API are internal, not external — same
 * "never ask the user for it, generate lazily on first use" pattern as
 * SETTINGS_ENCRYPTION_KEY. */
export async function getOrCreateInternalSecret(repo: SettingsRepo): Promise<string> {
  const existing = await repo.getSetting("INTERNAL_API_SECRET");
  if (existing) return existing;
  const generated = randomBytes(32).toString("hex");
  await repo.setSetting("INTERNAL_API_SECRET", generated, true);
  return generated;
}
```

- [ ] **Step 3: Send the header from the worker**

In `apps/worker/src/index.ts`, read the shared secret once near the top of `main()` (alongside the existing `settingsRepo`/`pool` setup):

```ts
const internalSecret = await getOrCreateInternalSecret(settingsRepo);
```

(Import `getOrCreateInternalSecret` — since it's currently defined in `apps/web/lib/internal-secret.ts` and `apps/worker` can't import across app boundaries, duplicate this exact function verbatim into a new `apps/worker/src/internal-secret.ts` instead, using `apps/worker`'s own `SettingsRepo` type import path. Both copies read/write the same `INTERNAL_API_SECRET` row, so whichever process runs first generates it and the other reads the same value back.)

Add the header to both existing `fetch()` calls:

```ts
        const res = await fetch(`${webBaseUrl}/api/library/${imageId}/bytes`, {
          headers: { "X-Internal-Secret": internalSecret },
        });
```

and:

```ts
        const res = await fetch(`${webBaseUrl}/api/models/${modelId}/estimate`, {
          method: "POST",
          headers: { "X-Internal-Secret": internalSecret },
          body: form,
        });
```

- [ ] **Step 4: Typecheck**

```bash
cd /home/s7lver/Lumi/packages/shared-types && npx tsc --noEmit
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
```

Expected: no errors in any of the three.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/settings.ts apps/web/lib/internal-secret.ts apps/worker/src/internal-secret.ts apps/worker/src/index.ts
git commit -m "feat(worker,web): add INTERNAL_API_SECRET so the worker's own calls skip API-key auth"
```

---

### Task 4: Session cookie via Edge middleware

**Files:**
- Create: `apps/web/middleware.ts`

**Interfaces:**
- Produces: every response gets a `lumi_session` httpOnly cookie set if the request didn't already have one — Task 5's auth helper checks for this cookie's mere presence (no DB lookup needed; it's a trust signal, not a real session store yet, matching the spec's "seed of a real session system, not the real thing").

- [ ] **Step 1: Write the middleware**

```ts
// apps/web/middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";

const SESSION_COOKIE = "lumi_session";

/** Edge-runtime middleware — deliberately does nothing but stamp a
 * same-origin session cookie on first visit. It must NOT touch Postgres
 * (Next.js 14.2's middleware only supports the Edge runtime, which can't
 * run `pg` — confirmed this session; Node.js-runtime middleware only
 * became available experimentally in Next 15.2+). The actual API-key/
 * quota check lives in requireApiAuth() (Task 5), called from each route
 * handler's own Node.js runtime instead. */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (!request.cookies.has(SESSION_COOKIE)) {
    response.cookies.set(SESSION_COOKIE, randomBytes(16).toString("hex"), {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}

export const config = {
  matcher: "/:path*",
};
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "feat(web): issue a same-origin session cookie via Edge middleware"
```

---

### Task 5: `requireApiAuth` — the real gate

**Files:**
- Create: `apps/web/lib/require-api-auth.ts`

**Interfaces:**
- Consumes: `getOrCreateInternalSecret` (Task 3), `findApiKeyByRaw`/`recordApiKeyUsage` (Task 2), the `lumi_session` cookie (Task 4).
- Produces: `requireApiAuth(request: Request, pool: Pool, requiredModelId?: string): Promise<{ ok: true } | { ok: false; response: Response }>` — Task 6's route-wrapping sweep calls this as the first line of every non-exempt route handler.

- [ ] **Step 1: Write the helper**

```ts
// apps/web/lib/require-api-auth.ts
import type { Pool } from "pg";
import { getSettingsRepo } from "./settings-repo";
import { getOrCreateInternalSecret } from "./internal-secret";
import { findApiKeyByRaw, recordApiKeyUsage } from "./api-keys";

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

function forbidden(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Three-layer gate (spec: docs/superpowers/specs/2026-07-23-external-api-
 * authentication-design.md):
 *   1. X-Internal-Secret header matching INTERNAL_API_SECRET -> worker, allow.
 *   2. lumi_session cookie present -> browser UI, allow.
 *   3. Otherwise -> Authorization: Bearer <api_key> required, must be
 *      active, authorized for `requiredModelId` (if given), and within quota.
 */
export async function requireApiAuth(
  request: Request,
  pool: Pool,
  requiredModelId?: string
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const repo = getSettingsRepo();

  const internalSecretHeader = request.headers.get("x-internal-secret");
  if (internalSecretHeader) {
    const expected = await getOrCreateInternalSecret(repo);
    if (internalSecretHeader === expected) return { ok: true };
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  if (/(?:^|;\s*)lumi_session=/.test(cookieHeader)) {
    return { ok: true };
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, response: unauthorized("Missing Authorization: Bearer <api_key>") };
  }

  const key = await findApiKeyByRaw(pool, match[1]);
  if (!key) {
    return { ok: false, response: unauthorized("Invalid or revoked API key") };
  }

  if (requiredModelId && !key.authorizedModelIds.includes(requiredModelId)) {
    return { ok: false, response: forbidden(`This key is not authorized for model "${requiredModelId}"`) };
  }

  if (key.requestCount >= key.quotaLimit) {
    return { ok: false, response: forbidden("Quota exceeded for this API key") };
  }

  await recordApiKeyUsage(pool, key.id);
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/require-api-auth.ts
git commit -m "feat(web): add requireApiAuth, the shared three-layer auth gate"
```

---

### Task 6: Wrap every non-exempt route handler

**Files:**
- Modify: every file under `apps/web/app/api/**/route.ts` EXCEPT those under `apps/web/app/api/setup/` and `apps/web/app/api/settings/` (per the spec's explicit exemption) — read the full current list fresh via `find apps/web/app/api -name route.ts` before starting, since this plan's earlier research (list captured mid-session) may be stale by the time this task runs, especially with three other plans having landed new routes (`apps/web/app/api/settings/model-usage/*`, already exempt as a `/settings/` route; any new routes from the three parallel plans that merged in the meantime).

**Interfaces:**
- Consumes: `requireApiAuth` (Task 5).
- Produces: every gated route now rejects unauthenticated external calls; no change to any route's success-path behavior or response shape.

- [ ] **Step 1: Add the gate as the first line of every non-exempt handler**

For each exported HTTP method function (`GET`, `POST`, `PATCH`, etc.) in every non-exempt route file, add this as the very first statement in the function body (before any existing logic), using whichever model id makes sense for that route (most routes have none — pass `undefined`; routes under `/api/models/[modelId]/...` pass `params.modelId`):

```ts
  const pool = getPool(); // hoist above the auth check if the file doesn't already have this line before its first DB use
  const auth = await requireApiAuth(request, pool /*, params.modelId for /api/models/[modelId]/* routes */);
  if (!auth.ok) return auth.response;
```

Import `requireApiAuth` from `"../../../lib/require-api-auth"` (adjust the relative path per each file's actual depth) at the top of each file. Since every file's exact current parameter name for the incoming `Request` differs (some use `request`, some use `_request` when unused elsewhere — rename `_request` to `request` in files where it's currently unused-and-prefixed, since it's now used), check each file's actual signature before inserting the call.

This is mechanical but must be applied to EVERY remaining route file — do not skip any (a skipped route is a real, silent auth bypass). Work through the full file list obtained in this task's setup step one by one.

- [ ] **Step 2: Typecheck and build**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit && npx next build
```

Expected: no errors, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add -- <every route.ts file modified in Step 1>
git commit -m "feat(web): gate every external-facing API route with requireApiAuth"
```

---

### Task 7: Settings UI — API Keys section

**Files:**
- Create: `apps/web/app/components/ApiKeysSection.tsx`
- Create: `apps/web/app/api/settings/api-keys/route.ts`
- Create: `apps/web/app/api/settings/api-keys/[id]/route.ts`
- Modify: `apps/web/app/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: `createApiKey`/`listApiKeys`/`revokeApiKey` (Task 2), `RETRIEVAL_MODELS` (`@netryx/shared-types`), the existing `Badge`/`RingGauge`/`FloatingCard` components.
- Produces: a new "API Keys" tab in Settings, following the exact same tab-registration pattern already used for "usage" (added earlier this session) in `SettingsPanel.tsx`.

- [ ] **Step 1: Write the two API routes**

```ts
// apps/web/app/api/settings/api-keys/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../lib/db";
import { createApiKey, listApiKeys } from "../../../../lib/api-keys";

export async function GET() {
  const rows = await listApiKeys(getPool());
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: unknown; authorizedModelIds?: unknown; quotaLimit?: unknown; quotaPeriod?: unknown;
  };
  if (typeof body.name !== "string" || body.name.length === 0) {
    return NextResponse.json({ error: "name es obligatorio" }, { status: 400 });
  }
  if (!Array.isArray(body.authorizedModelIds) || body.authorizedModelIds.length === 0) {
    return NextResponse.json({ error: "authorizedModelIds debe tener al menos un modelo" }, { status: 400 });
  }
  if (typeof body.quotaLimit !== "number" || body.quotaLimit <= 0) {
    return NextResponse.json({ error: "quotaLimit debe ser un número positivo" }, { status: 400 });
  }
  if (body.quotaPeriod !== "day" && body.quotaPeriod !== "month") {
    return NextResponse.json({ error: "quotaPeriod debe ser 'day' o 'month'" }, { status: 400 });
  }
  const result = await createApiKey(getPool(), {
    name: body.name,
    authorizedModelIds: body.authorizedModelIds as string[],
    quotaLimit: body.quotaLimit,
    quotaPeriod: body.quotaPeriod,
  });
  return NextResponse.json(result, { status: 201 });
}
```

```ts
// apps/web/app/api/settings/api-keys/[id]/route.ts
import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/db";
import { revokeApiKey } from "../../../../../lib/api-keys";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  await revokeApiKey(getPool(), params.id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Write the Settings component**

```tsx
// apps/web/app/components/ApiKeysSection.tsx
"use client";
import { useEffect, useState } from "react";
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { FloatingCard } from "./FloatingCard";
import { Badge } from "./Badge";
import { RingGauge } from "./RingGauge";

interface ApiKeyRow {
  id: string; name: string; maskedKey: string; authorizedModelIds: string[];
  quotaLimit: number; quotaPeriod: "day" | "month"; requestCount: number;
  revokedAt: string | null; lastUsedAt: string | null;
}

export function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [name, setName] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([RETRIEVAL_MODELS[0]?.id ?? ""]);
  const [quotaLimit, setQuotaLimit] = useState(500);
  const [quotaPeriod, setQuotaPeriod] = useState<"day" | "month">("day");
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function load() {
    fetch("/api/settings/api-keys").then((r) => r.json()).then(setKeys).catch(() => setKeys([]));
  }
  useEffect(() => { load(); }, []);

  function toggleModel(id: string) {
    setSelectedModels((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  async function createKey() {
    const res = await fetch("/api/settings/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, authorizedModelIds: selectedModels, quotaLimit, quotaPeriod }),
    });
    const data = await res.json();
    if (res.ok) {
      setRevealedKey(data.raw);
      setName("");
      load();
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/settings/api-keys/${id}`, { method: "DELETE" });
    load();
  }

  if (keys === null) return null;

  return (
    <FloatingCard className="p-5">
      <h2 className="mb-4 text-sm font-medium text-fg">API Keys</h2>

      {keys.map((k) => (
        <div key={k.id} className="mb-2.5 rounded-card border border-border bg-elevated p-3.5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <RingGauge value={k.quotaLimit > 0 ? k.requestCount / k.quotaLimit : 0} size={30} tone={k.revokedAt ? "muted" : "accent"} />
              <div>
                <div className="text-[13px] font-medium text-fg">{k.name}</div>
                <div className="font-mono text-[10.5px] text-subtle">{k.maskedKey}</div>
              </div>
            </div>
            {k.revokedAt ? (
              <Badge tone="danger">revocada</Badge>
            ) : (
              <div className="flex items-center gap-2">
                <Badge tone="accent">activa</Badge>
                <button onClick={() => revoke(k.id)} className="rounded-md border border-danger/40 px-2.5 py-1 text-[11px] text-danger-fg hover:bg-danger/10">
                  Revocar
                </button>
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            {k.authorizedModelIds.map((id) => (
              <span key={id} className="rounded-full bg-white/5 px-2 py-0.5">{RETRIEVAL_MODELS.find((m) => m.id === id)?.displayName ?? id}</span>
            ))}
            <span>· {k.requestCount}/{k.quotaLimit} requests {k.quotaPeriod === "day" ? "hoy" : "este mes"}</span>
          </div>
        </div>
      ))}

      <div className="mt-5 rounded-card border border-border bg-elevated p-3.5">
        <div className="mb-3 text-[12.5px] font-medium text-fg">Nueva API Key</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ej. Integración móvil"
          className="mb-3 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25"
        />
        <div className="mb-3 flex gap-2">
          {RETRIEVAL_MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => toggleModel(m.id)}
              className={`rounded-full px-3 py-1 text-[11px] ${selectedModels.includes(m.id) ? "bg-accent font-medium text-black" : "border border-white/10 text-muted"}`}
            >
              {m.displayName}
            </button>
          ))}
        </div>
        <div className="mb-4 flex gap-2">
          <input
            type="number"
            value={quotaLimit}
            onChange={(e) => setQuotaLimit(Number(e.target.value))}
            className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-fg"
          />
          <select
            value={quotaPeriod}
            onChange={(e) => setQuotaPeriod(e.target.value as "day" | "month")}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-fg"
          >
            <option value="day">requests/día</option>
            <option value="month">requests/mes</option>
          </select>
        </div>
        <button onClick={createKey} disabled={!name || selectedModels.length === 0} className="w-full rounded-md bg-accent py-2 text-xs font-medium text-black disabled:opacity-50">
          Generar key
        </button>
      </div>

      {revealedKey && (
        <div className="mt-4 rounded-card border border-white/20 bg-elevated p-3.5">
          <div className="mb-2 text-[11.5px] text-fg">✓ Key generada — copiala ahora, no se puede volver a ver</div>
          <div className="break-all rounded-md bg-bg p-3 font-mono text-xs text-fg">{revealedKey}</div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(revealedKey);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
            className="mt-2 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-black"
          >
            {copied ? "¡Copiado! ✓" : "Copiar"}
          </button>
        </div>
      )}
    </FloatingCard>
  );
}
```

- [ ] **Step 3: Register the tab in SettingsPanel**

Follow the exact pattern already established for the "usage" tab (added earlier this session — read `SettingsPanel.tsx`'s current `tabItems`/`SECTION_ICON`/render-branch for "usage" as the template): add an `"api-keys"` entry to `tabItems` with a suitable icon, add `activeTab === "api-keys" ? <ApiKeysSection /> :` to the render branch, and add `"api-keys"` to the `activeTab !== "areas" && activeTab !== "system" && activeTab !== "usage"` exclusion list (extend it to also exclude `"api-keys"`) so the generic "Guardar cambios" button doesn't show for this tab either.

- [ ] **Step 4: Typecheck and build**

```bash
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit && npx next build
```

Expected: no errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/ApiKeysSection.tsx apps/web/app/api/settings/api-keys apps/web/app/components/SettingsPanel.tsx
git commit -m "feat(web): add API Keys management UI to Settings"
```

---

### Task 8: Final verification pass

**Files:** none — verification only.

- [ ] **Step 1: Typecheck every touched package**

```bash
cd /home/s7lver/Lumi/packages/shared-types && npx tsc --noEmit
cd /home/s7lver/Lumi/apps/web && npx tsc --noEmit
cd /home/s7lver/Lumi/apps/worker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Build the web app**

```bash
cd /home/s7lver/Lumi/apps/web && npx next build
```

Expected: build succeeds.

- [ ] **Step 3: Report to the user**

No commit for this task. Summarize: all 7 implementation tasks done, list any route files that were skipped/missed in Task 6 and why (there should be none), and remind the user this is explicitly step one of a real auth system (per the spec) — the session cookie is a trust seed, not a real login, and quota is intentionally simple/independent of the separate usage-metrics redesign.
