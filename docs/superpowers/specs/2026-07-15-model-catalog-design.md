# Model catalog (Epic B) — design spec

Status: approved (design phase) — implementation not started.
Related: `docs/superpowers/backlog/2026-07-14-api-first-model-catalog-initiative.md`
(Epic B) — depends on Epic C's `MODEL_BUNDLES` registry
(`docs/superpowers/specs/2026-07-14-lumi-preview-unification-design.md`,
not yet implemented) and reuses several patterns from the "publish
weights" dataset catalog
(`docs/superpowers/specs/2026-07-13-dataset-catalog-design.md`).

## Context

A catalog of downloadable model versions — initially one entry, "Lumi
Preview" — with mandatory automatic benchmarks before publish, and
owner-only upload (not community, unlike the dataset catalog).

Several grounding facts shaped this design away from a naive reading of
the original request:

- **No auth system exists anywhere in this project** (documented
  self-hosted, trusted-network, no-auth boundary). "Owner-only upload"
  needed a real mechanism — resolved by reusing the dataset catalog's own
  answer to the same problem: GitHub repo write-access *is* the
  authorization boundary. No new auth infrastructure.
- **Today's "Lumi Preview" has no custom trained weights** — it's wrapper
  code (re-ranking, TTA, tile-matching) around publicly pretrained MegaLoc
  (`torch.hub`) and RoMa (`pip`), per this project's own "no training from
  scratch" constraint. So a catalog release versions `services/inference`'s
  **code**, not a weights file.
- Because a release versions code, "installing a different version" is
  functionally an update mechanism — raised explicitly against the
  user's own prior instruction to drop the app-update-system idea entirely.
  **Explicit decision: build a narrow, catalog-specific install flow
  anyway** (code swap + dependency reinstall + service restart, scoped
  only to `services/inference`), distinct from a general app updater.

## Goals

- Catalog `MODEL_BUNDLES` entries (Epic C) — initially "Lumi Preview" —
  with their published versions, each showing a description and mandatory
  benchmark results.
- A benchmark suite that runs automatically and gates publishing — a
  version that doesn't clear the accuracy threshold never reaches GitHub.
- Publish is owner-only via GitHub repo write access (same mechanism as
  the dataset catalog), not community-upload.
- Browse the catalog and install a different version, with a narrow,
  catalog-scoped mechanism (code swap + restart) — not a general updater.

## Non-goals

- Any general app-update system (explicitly discarded 2026-07-13) — this
  epic's install flow only ever swaps `services/inference`'s own code,
  triggered manually from the catalog UI, never automatic/background.
- Real weight-file distribution — no model here has custom weights to
  distribute; if a future model needs this, it's a separate design
  question when it actually arrives.
- Community upload — publishing is owner-only, full stop.
- Changes to `GET /api/models` (Epic A) — it keeps describing only the
  currently-active bundle's live endpoints; this epic's browsing surface
  is a separate endpoint (see Architecture).

## Architecture

### Benchmark suite (mandatory publish gate)

- **Reference set:** a fixed, curated list of N existing `indexed_images`
  rows (pano_id + heading) from the owner's own already-indexed areas —
  each already has a known-true location (where the real Street View
  capture was taken). Fixed, not randomly resampled per run, so results
  are comparable release to release.
- **Leave-one-out scoring:** `retrieveCandidates` gains an optional
  `excludeIndexedImageId` parameter — when scoring a reference case, that
  exact row is excluded from the candidate pool, so the pipeline has to
  find the area without trivially matching itself.
- **What it measures:** for each reference case, run real estimate +
  refine, compare the returned location (refined if confirmed, else the
  top region's centroid) against the known-true location. Reports
  `{accuracyWithin50m, avgDistanceM, sampleCount, ranAt}`.
- **Pass threshold:** `accuracyWithin50m >= 0.7` — a starting number, not
  load-bearing precision; the point is an automatic, non-negotiable gate
  existing at all, not this exact figure being final.
- Runs **locally**, as part of the publish flow itself (no CI in this
  project) — a failing run blocks publish before anything reaches GitHub.

### Catalog manifest + publish flow

Same backend pattern as the dataset catalog (GitHub Releases, the same
`ensureRepoWithTopic`/`upsertRelease`/`encryptBuffer`/`decryptBuffer`
primitives reused as-is) — but its own topic, `lumi-model-catalog`
(distinct from `lumi-dataset`, so discovery never mixes area datasets and
model releases), and its **own** shared encryption key
(`MODEL_CATALOG_SHARED_KEY`, a separate constant from the dataset
catalog's) — these are different trust surfaces (owner-only publish vs.
community publish) and shouldn't share a key just because the encryption
mechanism is the same code.

Manifest (`metadata.json.enc`):

```json
{
  "bundleId": "lumi-preview",
  "version": "1.0",
  "backbones": [
    { "name": "MegaLoc", "source": "torch.hub:gmberton/MegaLoc" },
    { "name": "RoMa", "source": "pip:romatch" }
  ],
  "benchmark": { "accuracyWithin50m": 0.83, "avgDistanceM": 12.4, "sampleCount": 20, "ranAt": "2026-07-15T10:00:00.000Z" },
  "description": "Free-text the owner writes when publishing."
}
```

Code bundle (`code.zip.enc`): a zip of `services/inference`'s `.py` files
+ `requirements.txt` — explicitly excluding `venv/`, `data/`, and any
cache directories.

Publish flow:
1. Run the benchmark suite. Below threshold → stop here, nothing uploaded.
2. Build the code zip + manifest (benchmark results filled in
   automatically from the run above — never hand-typed).
3. Encrypt both with `MODEL_CATALOG_SHARED_KEY`.
4. Upload as a GitHub Release tagged `{bundleId}-v{version}` (e.g.
   `lumi-preview-v1.1`) to the configured catalog repo (a new
   `MODEL_CATALOG_REPO` setting, `owner/repo`, alongside the existing
   `GITHUB_TOKEN`). Same tag reused → overwrite; different version → new
   release, same as the dataset catalog's convention.
5. `ensureRepoWithTopic` adds `lumi-model-catalog`.

### Discovery — `GET /api/model-catalog`

A new, separate endpoint from Epic A's `GET /api/models`. Searches
`topic:lumi-model-catalog`, lists every release in every matching repo,
decrypts each manifest with `MODEL_CATALOG_SHARED_KEY`, and marks each
release `isActive` by comparing `(bundleId, version)` against what's
currently running. Response: `{ bundles: [{ owner, repo, releases: [{
tag, bundleId, version, backbones, benchmark, description, isActive }]
}] }`.

`GET /api/models` (Epic A) is **unchanged** — it answers "what can I call
right now," this answers "what versions exist to install." Keeping them
separate means Epic A's already-approved spec needs no revision.

### Install flow (narrow, catalog-scoped — not a general updater)

1. Download + decrypt both assets for the chosen release; validate the
   manifest strictly (same discipline as the dataset catalog's validator:
   reject unknown/malformed fields, require `benchmark` to be present).
2. **Stage**: extract the code zip into a scratch temp directory — never
   directly into `services/inference/`.
3. **Backup**: copy the current `services/inference/*.py` files into
   `services/inference/.catalog-backup/` before overwriting anything.
4. Copy the staged `.py` files + `requirements.txt` over
   `services/inference/` — never touching `venv/`, `data/`, `.env`, or
   anything not managed by the catalog.
5. If `requirements.txt` changed, reinstall dependencies by reusing the
   existing `inference-deps` step already defined in `apps/web/app/api/
   setup/run/[step]/route.ts` (same venv, same `pip install -r
   requirements.txt`).
6. Restart the inference service by reusing the low-VRAM-mode epic's
   already-designed mechanism (`killProcessOnPort` + respawn, `POST
   /api/setup/run/restart-inference`) — the user watches the same real
   `BootGate` loading screen while it comes back up.
7. Only once the restarted service responds (`/model-status`/`/docs`) is
   the install considered successful. If it never comes back healthy
   within a timeout, automatically restore from `.catalog-backup/` and
   restart again with the previous code — the user sees a clear "couldn't
   apply v1.1, restored v1.0" message, never a silently broken service.

## UI

Settings gains a new tab, "Catálogo de modelos" (same convention as
"Áreas"/"Datasets publicados" — a full tab, not a popup), with the exact
same Explorar/Publicar layout already approved for the dataset catalog:

- **Explorar**: search + filter row, expandable bundle cards (today: one,
  "Lumi Preview") → release rows, each showing a benchmark badge (e.g.
  "89% ≤ 50m") and an "Activa" badge on whichever one is currently
  installed. Selecting a release shows its detail (benchmark stats,
  backbone list) and an "Instalar" button (disabled/relabeled "Instalada"
  for the active one).
- **Publicar**: description field, catalog repo field, a read-only "se
  publicará como {bundle} v{version}" tag (sourced from the currently
  running code's own version, not user-editable), and a benchmark-gate
  readout in the same visual slot the dataset catalog uses for its ToS
  disclaimer — green "benchmark superado" with the actual numbers when it
  passes, would show a failing/red state if it didn't (not reachable in
  today's single-model-always-passes case, but the UI supports it).

Mockup (approved 2026-07-15, served locally during design, not persisted
as a public artifact URL): `model-catalog-mockup.html`, this session's
scratchpad — deliberately mirrors the dataset catalog's own approved
mockup structure (same card/badge/tab conventions), per explicit
instruction that this catalog should look like that one.

## Error handling

- Benchmark below threshold → publish blocked, full report shown (which
  case failed, the distance it got), nothing reaches GitHub.
- Invalid/unexpected manifest fields on install → rejected before
  `services/inference/` is touched at all.
- Restart failure after a code swap → automatic restore from
  `.catalog-backup/`, restart with the previous code, clear error in the UI
  naming both the failed version and the one restored.
- Repo/release unreachable (bad token, network down) → a clear catalog-
  level error, never a crashed tab or a half-rendered list.

## Testing

- Unit: the benchmark scorer (distance vs. threshold, aggregation into
  `accuracyWithin50m`) against synthetic cases with known distances.
- Unit: `retrieveCandidates` with `excludeIndexedImageId` actually excludes
  that row from the candidate pool.
- Unit: the model-catalog manifest validator (expected fields, `benchmark`
  required) — same style as `validateDatasetManifest`.
- Unit: the `.catalog-backup/` backup/restore helper — restores correctly
  when a post-swap restart fails.
- Manual: publish a real version (benchmark passes), confirm it appears in
  `GET /api/model-catalog`; install that same version (already active, no
  real change) and confirm the full flow (swap, conditional dependency
  reinstall, restart) completes end to end.
