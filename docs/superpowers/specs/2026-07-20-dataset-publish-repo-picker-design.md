# Dataset publish — repo picker — design spec

Status: approved (design phase) — implementation not started.
Related: `apps/web/app/components/PublishWizard.tsx` (step 3 of 3),
`apps/web/lib/datasets/github.ts`, `apps/web/app/api/datasets/publish/route.ts`.

## Context

`PublishWizard`'s step 3 asks the user to type a destination repo as free
text (`owner/repo`), which the user then has to split and remember by
hand. There's no listing of the user's own GitHub repos anywhere in the
app yet — `github.ts` only has `searchRepositoriesByTopic` (search by
topic, used for the dataset catalog browser) and `ensureRepoWithTopic`
(get-or-create a specific known repo).

## Goals

- Replace the free-text `owner/repo` input in `PublishWizard`'s step 3
  with a searchable/filterable picker over the repos the user's
  `GITHUB_TOKEN` already has write access to (personal account +
  organizations), so the common case (repo already exists) needs no
  typing beyond a filter query.
- Keep a fallback for publishing to a **new** repo that doesn't exist yet
  (today's implicit behavior via `ensureRepoWithTopic`'s auto-create) —
  new repos can only be created under the token owner's personal account
  (GitHub's `POST /user/repos` has no way to target an org), same
  limitation as today.
- Surface a clear message when `GITHUB_TOKEN` isn't configured yet,
  instead of only failing at publish time.

## Non-goals

- No change to `ensureRepoWithTopic` / `upsertRelease` / the publish
  route's actual publish logic — this only changes how `owner`/`repo` are
  chosen in the UI before submit.
- No support for creating a repo under an organization from this picker.
- No live/debounced GitHub search-API calls — the repo list is fetched
  once per wizard open and filtered entirely client-side.

## Architecture

**Backend — `apps/web/lib/datasets/github.ts`:**

- `listUserRepositories(token): Promise<{ owner: string; repo: string; private: boolean; description: string | null }[]>`
  — `GET /user/repos?affiliation=owner,collaborator,organization_member&per_page=100`,
  following the `Link` response header to page through all results (same
  `NO_STORE` fetch convention as the rest of this file).
- `getAuthenticatedLogin(token): Promise<string>` — `GET /user`, returns
  `login`. Needed because a typed "create new" name has no explicit
  owner; it's always created under this login.

**Backend — new route `GET /api/datasets/repos`:**

- Reads `GITHUB_TOKEN` via `getSettingsRepo().getSetting(...)`; if unset,
  responds `400 { error: "GITHUB_TOKEN no está configurado — configúralo en Ajustes primero" }`.
- Otherwise calls both `listUserRepositories` and `getAuthenticatedLogin`
  (in parallel) and responds `200 { login, repos }`.
- No caching (`cache: "no-store"` throughout, matching `github.ts`'s
  existing standard) — the list should reflect repos created since the
  wizard was last opened.

**Frontend — new component `apps/web/app/components/RepoPicker.tsx`:**

- Props: `value: string`, `onChange: (value: string) => void` — same
  shape as a controlled text input, so it drops into `PublishWizard`
  without changing how `repo` state is stored (`"owner/repo"` string).
- On mount, fetches `/api/datasets/repos` once. Three states:
  - loading → "Cargando repositorios…"
  - error (including the "token not configured" 400) → shows the
    server's error message with a note to check Ajustes
  - loaded → renders an `<input>` (the filter query) plus a dropdown list
    below it
- Filtering is client-side substring match (case-insensitive) against
  `"${owner}/${repo}"` over the fetched list, re-computed on every
  keystroke — no network calls after the initial fetch.
- If the current filter text doesn't exactly match any `"${owner}/${repo}"`
  in the list, an extra row is appended at the end of the dropdown:
  **"Crear repositorio nuevo '<texto>' en tu cuenta"** — selecting it calls
  `onChange(`${login}/${text}`)` (using the `login` from the fetch
  response; the text itself is treated as the new repo's name, so slashes
  in it are invalid — see Edge cases).
- Selecting any existing-repo row calls `onChange("${owner}/${repo}")` and
  closes the dropdown.
- The dropdown opens on focus and closes on blur (with a small delay so a
  click on a row registers before blur closes it) or on selection.

**`PublishWizard.tsx` changes:**

- Step 3's `<input>` for `repo` is replaced with
  `<RepoPicker value={repo} onChange={setRepo} />`.
- `getLastDatasetRepo`/`setLastDatasetRepo` behavior is unchanged — the
  last-used repo string still prefills `repo` state before `RepoPicker`
  mounts, so it shows up as the initial filter text.
- `publish()`'s existing `repo.split("/")` parsing is unchanged — 
  `RepoPicker` always produces a value in `"owner/repo"` form.

## Edge cases

- **Typed text contains no `/` and matches nothing:** treated as a new
  repo name under the authenticated login (the primary "create new"
  case).
- **Typed text contains a `/` and matches nothing:** still offered as
  "create new", but using only the part after the last `/` as the repo
  name (owner is always the authenticated login, never the typed
  prefix — `POST /user/repos` has no way to create under another owner
  anyway). This avoids attempting to create a literally-slashed repo name
  that GitHub would reject.
- **Empty repo list** (token valid but zero accessible repos): dropdown
  shows only the "create new" row once the user types something.
- **`canPublish(repo, accepted)` validation** in
  `apps/web/lib/publish-wizard-steps.ts` is unchanged — it already just
  checks `repo` is non-empty and contains a `/`.

## Testing

- `github.ts`: unit tests for `listUserRepositories` (single page,
  multi-page via `Link` header) and `getAuthenticatedLogin`, mocking
  `fetch`.
- `/api/datasets/repos/route.ts`: unit tests for the missing-token 400
  and the happy-path 200 shape.
- `RepoPicker.tsx`: component test covering loading/error/loaded states,
  filtering, and both selection paths (existing repo vs. create-new row).
