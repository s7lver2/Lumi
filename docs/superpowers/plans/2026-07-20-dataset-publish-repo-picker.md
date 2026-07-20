# Dataset publish repo picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `PublishWizard`'s free-text "owner/repo" input with a searchable picker over the user's own GitHub repos (personal + orgs), with a fallback to create a new repo under the user's account.

**Architecture:** A new `listUserRepositories`/`getAuthenticatedLogin` pair in `github.ts` backs a new `GET /api/datasets/repos` route; a pure logic module (`repo-picker.ts`) computes the filtered dropdown rows (existing repos + an optional "create new" row) from repos + query + login; a thin `RepoPicker.tsx` component fetches once, holds the query string, and renders rows from that logic module; `PublishWizard.tsx` swaps its step-3 `<input>` for `<RepoPicker>`.

**Tech Stack:** Next.js App Router route handlers, `fetch` (native, no SDK) against the GitHub REST API, Vitest for tests, React (client component) for the picker.

## Global Constraints

- Repo list fetched once per wizard open, filtered entirely client-side — no live/debounced GitHub search calls (spec Non-goals).
- New repos can only be created under the token owner's personal account — `POST /user/repos` has no org-targeting; a typed name that doesn't match any existing repo is always paired with the authenticated login, never a typed owner prefix (spec Edge cases).
- `repo` state in `PublishWizard` stays an `"owner/repo"` string — `RepoPicker`'s public interface is `{ value: string; onChange: (value: string) => void }`, a drop-in replacement for the old `<input>` (spec Architecture).
- No caching on any new `fetch` call — reuse the existing `NO_STORE` convention already in `github.ts` (spec Architecture, existing file comment at `apps/web/lib/datasets/github.ts:5-13`).
- `canPublish(repo, accepted)` in `apps/web/app/lib/publish-wizard-steps.ts` is unchanged — already validates `"owner/repo"` shape.
- This repo has no jsdom/testing-library setup (`apps/web/vitest.config.ts` uses `environment: "node"`, and no `.tsx` test files exist anywhere in `apps/web/app/components`). Following the codebase's own established pattern (`publish-wizard-steps.ts`, `last-dataset-repo.ts` — pure logic extracted from components into plain `.ts` modules and unit-tested there), the picker's filtering/selection logic is tested via `repo-picker.ts`, not via a React component test. `RepoPicker.tsx` itself is verified by manually exercising the wizard in a running dev server (Task 5), matching how `PublishWizard.tsx` itself has no test file today.

---

### Task 1: `github.ts` — list user repos + authenticated login

**Files:**
- Modify: `apps/web/lib/datasets/github.ts`
- Test: `apps/web/lib/datasets/github.test.ts`

**Interfaces:**
- Produces: `export interface UserRepository { owner: string; repo: string; private: boolean; description: string | null }`
- Produces: `export async function listUserRepositories(token: string): Promise<UserRepository[]>`
- Produces: `export async function getAuthenticatedLogin(token: string): Promise<string>`

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/lib/datasets/github.test.ts` (append after the existing `describe("searchRepositoriesByTopic", ...)` block, before `describe("downloadReleaseAsset", ...)`):

```ts
describe("listUserRepositories", () => {
  it("maps a single page of results to UserRepository", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      headers: { get: () => null },
      json: async () => ([
        { owner: { login: "inigo" }, name: "lumi-madrid", private: false, description: "desc" },
      ]),
    } as unknown as Response)));

    const { listUserRepositories } = await import("./github");
    expect(await listUserRepositories("tok")).toEqual([
      { owner: "inigo", repo: "lumi-madrid", private: false, description: "desc" },
    ]);
  });

  it("follows the Link header to page through all results", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          headers: { get: () => '<https://api.github.com/user/repos?page=2>; rel="next"' },
          json: async () => ([{ owner: { login: "inigo" }, name: "repo-one", private: false, description: null }]),
        } as unknown as Response;
      }
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ([{ owner: { login: "inigo" }, name: "repo-two", private: true, description: null }]),
      } as unknown as Response;
    }));

    const { listUserRepositories } = await import("./github");
    const result = await listUserRepositories("tok");
    expect(result).toEqual([
      { owner: "inigo", repo: "repo-one", private: false, description: null },
      { owner: "inigo", repo: "repo-two", private: true, description: null },
    ]);
    expect(call).toBe(2);
  });
});

describe("getAuthenticatedLogin", () => {
  it("returns the token's own login", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ login: "inigo" }),
    } as Response)));

    const { getAuthenticatedLogin } = await import("./github");
    expect(await getAuthenticatedLogin("tok")).toBe("inigo");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/lib/datasets/github.test.ts`
Expected: FAIL — `listUserRepositories`/`getAuthenticatedLogin` are not exported from `./github`.

- [ ] **Step 3: Implement `listUserRepositories` and `getAuthenticatedLogin`**

In `apps/web/lib/datasets/github.ts`, add after `searchRepositoriesByTopic` (before `downloadReleaseAsset`):

```ts
export interface UserRepository {
  owner: string;
  repo: string;
  private: boolean;
  description: string | null;
}

/** Extracts the `rel="next"` URL from a GitHub `Link` response header, or
 * null on the last page (GitHub's own pagination convention — no `next`
 * relation once there's nothing left). */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const nextPart = linkHeader.split(",").map((part) => part.trim()).find((part) => part.endsWith('rel="next"'));
  if (!nextPart) return null;
  const match = nextPart.match(/^<([^>]+)>/);
  return match ? match[1] : null;
}

/** Every repo the token has write access to — own account plus any
 * organization membership — paginated via the `Link` header since a
 * single `per_page` request caps at 100. Used to back the dataset-publish
 * repo picker (spec: docs/superpowers/specs/2026-07-20-dataset-publish-repo-picker-design.md). */
export async function listUserRepositories(token: string): Promise<UserRepository[]> {
  const results: UserRepository[] = [];
  let url: string | null = `${GITHUB_API}/user/repos?affiliation=owner,collaborator,organization_member&per_page=100`;

  while (url) {
    const res: Response = await fetch(url, { headers: authHeaders(token), ...NO_STORE });
    if (!res.ok) throw new Error(`Failed to list user repos: ${res.status}`);
    const body = (await res.json()) as Array<{
      owner: { login: string };
      name: string;
      private: boolean;
      description: string | null;
    }>;
    results.push(...body.map((r) => ({ owner: r.owner.login, repo: r.name, private: r.private, description: r.description })));
    url = parseNextLink(res.headers.get("link"));
  }

  return results;
}

/** The username the given token belongs to — a typed "create new repo"
 * name in the picker always creates under this login (GitHub's
 * `POST /user/repos` has no way to target an org). */
export async function getAuthenticatedLogin(token: string): Promise<string> {
  const res = await fetch(`${GITHUB_API}/user`, { headers: authHeaders(token), ...NO_STORE });
  if (!res.ok) throw new Error(`Failed to fetch authenticated user: ${res.status}`);
  const body = (await res.json()) as { login: string };
  return body.login;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/datasets/github.test.ts`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/datasets/github.ts apps/web/lib/datasets/github.test.ts
git commit -m "feat(web): add listUserRepositories and getAuthenticatedLogin to github.ts"
```

---

### Task 2: `GET /api/datasets/repos` route

**Files:**
- Create: `apps/web/app/api/datasets/repos/route.ts`
- Create: `apps/web/app/api/datasets/repos/route.test.ts`

**Interfaces:**
- Consumes: `listUserRepositories(token: string): Promise<UserRepository[]>`, `getAuthenticatedLogin(token: string): Promise<string>` (Task 1), `getSettingsRepo().getSetting("GITHUB_TOKEN"): Promise<string | null>` (existing, see `apps/web/app/api/datasets/publish/route.ts:27`)
- Produces: `GET` handler responding `200 { login: string; repos: UserRepository[] }` or `400 { error: string }`

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/api/datasets/repos/route.test.ts`:

```ts
// apps/web/app/api/datasets/repos/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../lib/settings-repo", () => ({ getSettingsRepo: vi.fn() }));
vi.mock("../../../../lib/datasets/github", () => ({
  listUserRepositories: vi.fn(),
  getAuthenticatedLogin: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/datasets/repos", () => {
  it("400s when GITHUB_TOKEN isn't configured", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue(null) });

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(400);
  });

  it("returns the authenticated login and repo list", async () => {
    const { getSettingsRepo } = await import("../../../../lib/settings-repo");
    (getSettingsRepo as any).mockReturnValue({ getSetting: vi.fn().mockResolvedValue("gh-token") });

    const { listUserRepositories, getAuthenticatedLogin } = await import("../../../../lib/datasets/github");
    (getAuthenticatedLogin as any).mockResolvedValue("inigo");
    (listUserRepositories as any).mockResolvedValue([
      { owner: "inigo", repo: "lumi-madrid", private: false, description: null },
    ]);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      login: "inigo",
      repos: [{ owner: "inigo", repo: "lumi-madrid", private: false, description: null }],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/app/api/datasets/repos/route.test.ts`
Expected: FAIL — `./route` doesn't exist yet.

- [ ] **Step 3: Write the route**

Create `apps/web/app/api/datasets/repos/route.ts`:

```ts
// apps/web/app/api/datasets/repos/route.ts
import { NextResponse } from "next/server";
import { getSettingsRepo } from "../../../../lib/settings-repo";
import { listUserRepositories, getAuthenticatedLogin } from "../../../../lib/datasets/github";

export async function GET() {
  const token = await getSettingsRepo().getSetting("GITHUB_TOKEN");
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN no está configurado — configúralo en Ajustes primero" },
      { status: 400 }
    );
  }

  const [login, repos] = await Promise.all([getAuthenticatedLogin(token), listUserRepositories(token)]);
  return NextResponse.json({ login, repos });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/app/api/datasets/repos/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/datasets/repos/route.ts apps/web/app/api/datasets/repos/route.test.ts
git commit -m "feat(web): add GET /api/datasets/repos route"
```

---

### Task 3: `repo-picker.ts` — pure filtering/selection logic

**Files:**
- Create: `apps/web/app/lib/repo-picker.ts`
- Create: `apps/web/app/lib/repo-picker.test.ts`

**Interfaces:**
- Produces: `export interface RepoOption { owner: string; repo: string }`
- Produces: `export interface RepoRow { kind: "existing" | "create"; label: string; value: string }`
- Produces: `export function filterRepos(repos: RepoOption[], query: string): RepoOption[]`
- Produces: `export function buildRepoRows(repos: RepoOption[], query: string, login: string): RepoRow[]`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/lib/repo-picker.test.ts`:

```ts
// apps/web/app/lib/repo-picker.test.ts
import { describe, it, expect } from "vitest";
import { filterRepos, buildRepoRows } from "./repo-picker";

const REPOS = [
  { owner: "inigo", repo: "lumi-madrid" },
  { owner: "inigo", repo: "lumi-sevilla" },
  { owner: "some-org", repo: "other-project" },
];

describe("filterRepos", () => {
  it("returns everything when the query is blank", () => {
    expect(filterRepos(REPOS, "")).toEqual(REPOS);
    expect(filterRepos(REPOS, "   ")).toEqual(REPOS);
  });

  it("matches owner/repo as a case-insensitive substring", () => {
    expect(filterRepos(REPOS, "madrid")).toEqual([{ owner: "inigo", repo: "lumi-madrid" }]);
    expect(filterRepos(REPOS, "INIGO/LUMI")).toEqual([
      { owner: "inigo", repo: "lumi-madrid" },
      { owner: "inigo", repo: "lumi-sevilla" },
    ]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterRepos(REPOS, "nonexistent")).toEqual([]);
  });
});

describe("buildRepoRows", () => {
  it("renders one existing row per match, no create row, when the query is blank", () => {
    const rows = buildRepoRows(REPOS, "", "inigo");
    expect(rows).toEqual([
      { kind: "existing", label: "inigo/lumi-madrid", value: "inigo/lumi-madrid" },
      { kind: "existing", label: "inigo/lumi-sevilla", value: "inigo/lumi-sevilla" },
      { kind: "existing", label: "some-org/other-project", value: "some-org/other-project" },
    ]);
  });

  it("omits the create row when the query exactly matches an existing repo", () => {
    const rows = buildRepoRows(REPOS, "inigo/lumi-madrid", "inigo");
    expect(rows).toEqual([{ kind: "existing", label: "inigo/lumi-madrid", value: "inigo/lumi-madrid" }]);
  });

  it("appends a create-new row under the authenticated login when nothing matches", () => {
    const rows = buildRepoRows(REPOS, "brand-new-repo", "inigo");
    expect(rows).toEqual([
      { kind: "create", label: 'Crear repositorio nuevo "brand-new-repo" en tu cuenta', value: "inigo/brand-new-repo" },
    ]);
  });

  it("uses only the text after the last slash as the new repo's name, ignoring any typed owner", () => {
    const rows = buildRepoRows(REPOS, "someorg/brand-new-repo", "inigo");
    expect(rows).toEqual([
      { kind: "create", label: 'Crear repositorio nuevo "brand-new-repo" en tu cuenta', value: "inigo/brand-new-repo" },
    ]);
  });

  it("shows partial matches alongside the create row when no existing repo is an exact match", () => {
    const rows = buildRepoRows(REPOS, "lumi", "inigo");
    expect(rows).toEqual([
      { kind: "existing", label: "inigo/lumi-madrid", value: "inigo/lumi-madrid" },
      { kind: "existing", label: "inigo/lumi-sevilla", value: "inigo/lumi-sevilla" },
      { kind: "create", label: 'Crear repositorio nuevo "lumi" en tu cuenta', value: "inigo/lumi" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/app/lib/repo-picker.test.ts`
Expected: FAIL — `./repo-picker` doesn't exist yet.

- [ ] **Step 3: Implement `repo-picker.ts`**

Create `apps/web/app/lib/repo-picker.ts`:

```ts
// apps/web/app/lib/repo-picker.ts

export interface RepoOption {
  owner: string;
  repo: string;
}

export interface RepoRow {
  kind: "existing" | "create";
  label: string;
  value: string;
}

/** Client-side substring filter over the fetched repo list — no live
 * GitHub search calls (spec Non-goals). */
export function filterRepos(repos: RepoOption[], query: string): RepoOption[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return repos;
  return repos.filter((r) => `${r.owner}/${r.repo}`.toLowerCase().includes(trimmed));
}

/** Existing-repo rows for whatever matches the query, plus — unless the
 * query is blank or exactly matches an existing repo — a trailing
 * "create new" row. New repos can only be created under the
 * authenticated login (GitHub's create-repo endpoint has no org
 * targeting), so a typed "owner/name" only keeps the part after the last
 * slash as the new repo's name; `login` always supplies the owner. */
export function buildRepoRows(repos: RepoOption[], query: string, login: string): RepoRow[] {
  const trimmed = query.trim();
  const matches = filterRepos(repos, trimmed);
  const rows: RepoRow[] = matches.map((r) => ({
    kind: "existing",
    label: `${r.owner}/${r.repo}`,
    value: `${r.owner}/${r.repo}`,
  }));

  if (trimmed.length === 0) return rows;

  const exactMatch = matches.some((r) => `${r.owner}/${r.repo}`.toLowerCase() === trimmed.toLowerCase());
  if (exactMatch) return rows;

  const name = trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed;
  if (name.length === 0) return rows;

  rows.push({
    kind: "create",
    label: `Crear repositorio nuevo "${name}" en tu cuenta`,
    value: `${login}/${name}`,
  });
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/app/lib/repo-picker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib/repo-picker.ts apps/web/app/lib/repo-picker.test.ts
git commit -m "feat(web): add repo-picker filtering/selection logic"
```

---

### Task 4: `RepoPicker.tsx` component

**Files:**
- Create: `apps/web/app/components/RepoPicker.tsx`

**Interfaces:**
- Consumes: `fetchJson<T>(input: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }>` (existing, `apps/web/app/lib/fetch-json.ts`), `RepoOption`, `buildRepoRows` (Task 3)
- Produces: `export function RepoPicker({ value, onChange }: { value: string; onChange: (value: string) => void }): JSX.Element` — a drop-in replacement for a controlled text `<input>`.

No automated test for this file — see "Global Constraints" for why (no component-testing infra in this repo; verified manually in Task 5).

- [ ] **Step 1: Write the component**

Create `apps/web/app/components/RepoPicker.tsx`:

```tsx
// apps/web/app/components/RepoPicker.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { fetchJson } from "../lib/fetch-json";
import { buildRepoRows, type RepoOption } from "../lib/repo-picker";

interface ReposResponse {
  login: string;
  repos: RepoOption[];
}

export function RepoPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [query, setQuery] = useState(value);
  const [status, setStatus] = useState<"loading" | "error" | "loaded">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [login, setLogin] = useState("");
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [open, setOpen] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // `value` only ever changes externally at mount (PublishWizard's
  // localStorage prefill) or right after this component's own onChange
  // call — either way it's safe to mirror into the local query.
  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    fetchJson<ReposResponse>("/api/datasets/repos").then((r) => {
      if (!r.ok || !r.data) {
        setErrorMessage((r.data as { error?: string } | null)?.error ?? "No se pudieron cargar los repositorios");
        setStatus("error");
        return;
      }
      setLogin(r.data.login);
      setRepos(r.data.repos);
      setStatus("loaded");
    });
  }, []);

  if (status === "loading") {
    return <div className="mb-3 text-xs text-muted">Cargando repositorios…</div>;
  }
  if (status === "error") {
    return <div className="mb-3 text-xs text-danger-fg">{errorMessage}</div>;
  }

  const rows = buildRepoRows(repos, query, login);

  function select(v: string) {
    onChange(v);
    setQuery(v);
    setOpen(false);
  }

  return (
    <div className="relative mb-3">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimeout.current = setTimeout(() => setOpen(false), 150);
        }}
        placeholder="Buscar repositorio…"
        className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25"
      />
      {open && rows.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-[200px] w-full overflow-y-auto rounded-md border border-white/10 bg-panel">
          {rows.map((row) => (
            <div
              key={row.value}
              onMouseDown={() => {
                if (blurTimeout.current) clearTimeout(blurTimeout.current);
                select(row.value);
              }}
              className="cursor-pointer px-3 py-2 text-xs text-fg hover:bg-white/10"
            >
              {row.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

Note on the `onMouseDown`/`onBlur` pairing: a row click fires `onMouseDown` before the input's `onBlur` fires, and clears the pending blur-close timeout — otherwise the dropdown would close (on blur) before the click's `onClick` had a chance to register, discarding the selection.

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `RepoPicker.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/RepoPicker.tsx
git commit -m "feat(web): add RepoPicker component"
```

---

### Task 5: Wire `RepoPicker` into `PublishWizard` step 3 + manual verification

**Files:**
- Modify: `apps/web/app/components/PublishWizard.tsx:144-150`

**Interfaces:**
- Consumes: `RepoPicker` (Task 4)

- [ ] **Step 1: Replace the free-text input with `RepoPicker`**

In `apps/web/app/components/PublishWizard.tsx`, add the import alongside the existing ones at the top:

```tsx
import { RepoPicker } from "./RepoPicker";
```

Replace:

```tsx
            <label className="mb-1 block text-xs text-muted">Repositorio destino (owner/repo)</label>
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repo"
              className="mb-3 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-fg outline-none focus:border-white/25"
            />
```

with:

```tsx
            <label className="mb-1 block text-xs text-muted">Repositorio destino</label>
            <RepoPicker value={repo} onChange={setRepo} />
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Run the full web test suite**

Run: `npx vitest run apps/web`
Expected: PASS (all existing tests plus the three new test files from Tasks 1-3).

- [ ] **Step 4: Manually verify in a running dev server**

Use the `run` skill (or start the dev server directly) to launch Lumi locally, then:
1. Make sure `GITHUB_TOKEN` is set in Ajustes (needed for the picker to load).
2. Open the dataset-publish wizard (Datasets section → publish), advance to step 3.
3. Confirm the picker shows "Cargando repositorios…" briefly, then a list of real repos.
4. Type a substring of an existing repo's name — confirm the list filters down to matches.
5. Type a name that matches nothing — confirm a "Crear repositorio nuevo "..." en tu cuenta" row appears at the bottom.
6. Select a row (both an existing-repo row and the create-new row) — confirm the input reflects the selected `owner/repo` and the "Publicar" button's disabled state matches `canPublish`.
7. Temporarily clear `GITHUB_TOKEN` in Ajustes and reopen the wizard to step 3 — confirm the picker shows the "GITHUB_TOKEN no está configurado" message instead of hanging on "Cargando…". Restore the token afterward.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/PublishWizard.tsx
git commit -m "feat(web): wire RepoPicker into PublishWizard step 3"
```
