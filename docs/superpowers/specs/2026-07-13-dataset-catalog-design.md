# "Publish weights" dataset catalog — design spec

Status: approved (design phase) — implementation not started.
Related: independent of features #1/#2, but shares this session's overall
context (2026-07-13 design pass, 3 of 3).

## Revision note (2026-07-14)

This spec was revised to add **per-model scoping**: a published dataset's
embeddings are tied to whichever retrieval model produced them, and that's
no longer implicit. This was prompted by a real gap found while reviewing
the original design against the current codebase: `indexed_images.embedding`
is a fixed-width `vector(8448)` column with zero `model_id` tracking
anywhere, and the existing export/import routes this feature reuses carry
raw embedding arrays with no model metadata at all. Two models can even
share the same `embedding_dim` while producing totally incompatible
embedding spaces — so "does it fit in the column" was never a safe proxy
for "is it actually usable."

Everything in this revision builds on the existing, already-implemented
model registry (`services/inference/models/registry.py` +
`packages/shared-types/src/models.ts`, spec `docs/2026-07-08-astra-fork-
spec(2).md` §15.3) — this doc doesn't invent a new model-identity concept,
it reuses that one and extends it with a `version` field. Superseded
assumption from the original spec: "fetch the repo's latest release" — a
repo can now hold multiple releases (one per model+version), see
Architecture below. Mockup for the revised UI approved 2026-07-14 (see
"UI" section).

## Context

Indexing an area (Street View download + embedding) is expensive — API cost,
time, GPU compute. Users want to share/reuse that work: publish an indexed
area ("dataset") so other Lumi users can discover and install it, browsing a
catalog styled after Factorio's mod portal (search/filter list → detail →
install), reskinned entirely in Lumi's own visual language.

**Explicit, informed decision (see "ToS risk" below):** this is a shared
community catalog, not a personal-backup-only feature — the user chose this
scope after reviewing that it scales an already-documented risk in this
project's own `docs/PROOF_OF_CONCEPT.md` §3.1 (Google Maps Platform ToS
explicitly prohibits bulk-download/caching/indexing of Street View content
outside the original map context — redistributing that cached content to
other users is not a gray area, it's the exact thing §3.1 already calls
out). This spec proceeds with that risk accepted, not unexamined.

## Goals

- Publish an indexed area to the user's own GitHub repo, encrypted.
- Browse/search datasets published by any Lumi user, without a central
  Lumi-run server — pure GitHub-as-backend, matching the project's
  self-hosted philosophy.
- Install a browsed dataset into the local Lumi instance.
- Settings entry point: a button opening a popup (Explorar / Publicar tabs).
- **(2026-07-14)** A dataset makes explicit which model — and which
  version of that model — produced its embeddings, and the catalog/install
  flow respect that: no silent cross-model corruption of local search
  results, and no dataset sits unusable forever just because it doesn't
  match the locally active model.

## Non-goals

- A central Lumi-run index/moderation server.
- True per-publisher secrecy (see "Key model" — the shared key is
  obfuscation from non-Lumi observers, not secrecy from other Lumi users).
- Automated content moderation beyond the safety validation in "Security"
  below (a local per-user blocklist is in scope; a review/reporting backend
  is not).
- **(2026-07-14)** Bundling more than one model's embeddings inside a
  single release — one model+version per release, always (see
  Architecture). Publishing under a model other than the one currently
  active locally — the tag must reflect what actually produced the
  embeddings, never a user-editable label.

## Architecture

### Model registry change

`services/inference/models/registry.py` and its mirror
`packages/shared-types/src/models.ts` gain a `version` field (string, e.g.
`"1.0"`) on each `RETRIEVAL_MODELS` entry:

```python
RETRIEVAL_MODELS = [
    {
        "id": "lumi-preview",
        "display_name": "Lumi Preview",
        "base_model": "MegaLoc (frozen)",
        "status": "preview",
        "embedding_dim": 8448,
        "version": "1.0",
    },
]
```

Only `RETRIEVAL_MODELS` gains this field — `VERIFICATION_MODELS` (Laila)
doesn't participate in dataset tagging at all, because verification is
never persisted against an indexed area (it only runs live, on demand,
against a search's candidates — see `docs/2026-07-08-astra-fork-
spec(2).md` §9.3). There is no "Laila embedding" a dataset could contain,
so the catalog has no need to know anything about the user's active
verification model.

`version` is set manually, same as the rest of the registry (no deriving it
from git tags or a weight hash) — consistent with the existing "adding a
future model is one new entry, no other code changes" pattern. This is
also the exact field the future model-catalog epic
(`docs/superpowers/backlog/2026-07-14-api-first-model-catalog-initiative.md`,
Epic B) will need — introduced here first because this feature needs it
now, not wasted work.

### Auth

User's own GitHub Personal Access Token, stored via the existing encrypted
settings pattern (same as `GOOGLE_MAPS_API_KEY`) — server-side only, never
sent to the client. Settings UI copy recommends a fine-grained PAT scoped
to just one repo (`Contents: write`, `Metadata: write` for topics), not a
broad classic token.

### Publish flow

1. User picks one of their own `status = 'indexed'` areas, writes a public
   title/description, confirms/creates the target repo (`owner/repo`).
2. Bundle built via the **existing** export pipeline
   (`apps/web/app/api/areas/export/route.ts`'s jszip manifest+images
   approach) — reused as-is, not reimplemented.
3. **(2026-07-14)** The manifest's and metadata blob's `model` field
   (`{id, version, embeddingDim}`) is filled in **automatically** from
   whichever `RETRIEVAL_MODEL` is active locally, read from the registry —
   never a value the publisher types or edits, so a dataset can't be
   mislabeled by mistake (or on purpose).
4. Bundle bytes + a small metadata blob (title, description, stats,
   `model`) both encrypted with the shared app key (AES-256-GCM, reusing
   `packages/settings-repo/src/crypto.ts`'s primitives — needs a
   Buffer-accepting variant of `encrypt()`, which currently takes a
   `string`).
5. **(2026-07-14)** Uploaded as a GitHub Release tagged `{modelId}-v
   {version}` (e.g. `lumi-preview-v1.0`), title in human-readable form
   ("Lumi Preview v1.0"), in the user's repo (auto-created if it doesn't
   exist); repo gets the `lumi-dataset` topic added
   (`PUT /repos/{owner}/{repo}/topics`). Republishing the same area under
   the same model+version **overwrites** that release's assets (same tag);
   publishing under a different model or version **creates a new release**
   in the same repo — one repo can hold several releases over time.
6. Metadata blob is uploaded separately/small so browsing can decrypt just
   that (fast) without pulling the full bundle.
7. Publish is gated behind an explicit, non-blocking disclaimer + checkbox
   surfacing the ToS note above — shown every time, not a one-time dismiss,
   since this is a per-publish legal decision each time real content goes
   out.

### Discovery

GitHub topic search (`GET /search/repositories?q=topic:lumi-dataset`) —
fully decentralized, no shared index file to maintain, no PR review queue.

**(2026-07-14)** For each matching repo, **all** of its releases are
listed (`GET /repos/{owner}/{repo}/releases` — one call returns every
release's tag/name/body/assets, no extra round trips needed per release).
Each release is its own catalog entry — its own model+version, own
compatibility badge, own install action — but grouped visually under its
parent repo/area (one expandable card per repo, one row per release
inside it). Trade-off accepted, unchanged from the original spec: new
repos/topics can take a little while to appear in GitHub's search index,
and unauthenticated search has modest rate limits.

### Install flow

1. User picks a specific release (already showing its model+version and
   compatibility badge from the catalog browse step).
2. **(2026-07-14)** Before downloading the (potentially large) full
   bundle, the release's already-decrypted metadata blob is compared
   against the locally active `RETRIEVAL_MODEL` (from `system_settings`)
   and its `embeddingDim` (from the registry) — `{modelId, version}` must
   match exactly for a "compatible" verdict.
3. **If compatible:** proceeds exactly as below (download → decrypt →
   stage → validate → copy → insert, embeddings included).
4. **If not compatible:** an explicit dialog surfaces the mismatch
   ("built with {model} v{version} (dim {N}); you have {local model}
   v{version} (dim {N}) active") with two choices: **"Instalar y completar
   embeddings automáticamente"** or **"Cancelar"** — nothing proceeds
   silently.
5. Download the full encrypted bundle asset, decrypt.
6. **Stage into a scratch temp directory** (not real `data/` dirs yet).
7. Run the full validation pipeline (see Security) against the staged
   content — unchanged by the compatibility path taken.
8. Only on full success: copy validated images into the real image
   directory and insert DB rows via (a hardened version of) the existing
   import pipeline (`apps/web/app/api/areas/import/route.ts`).
   - **Compatible path:** embeddings are inserted from the manifest as-is.
   - **(2026-07-14) Mismatched, user chose to proceed:** rows are inserted
     with `embedding = NULL` instead of the incompatible-dimension vector
     — reusing the *existing* meaning of a null embedding (the worker
     already inserts a row at capture time and fills the embedding in
     later, so a resumable indexing job can pick up partial progress; see
     `db/migrations` schema notes). Right after a successful import, the
     new "complete embeddings" job (below) is **automatically enqueued**
     for that area — no separate manual step the user has to remember.
9. On any validation failure: discard the entire staging directory, surface
   a clear error, no partial writes.

### Completing embeddings after a mismatched install

**(2026-07-14, new)** The existing generic reindex job
(`apps/worker/src/jobs/index-area.ts`, triggered by `POST /api/areas/[id]`
`{action: "reindex"}`) does **not** work for this: it re-walks the area's
street geometry and re-attempts Street View downloads, using a global
`(pano_id, heading)` dedup to skip anything already captured — which means
rows that already exist (like the images-only rows just imported) are
skipped entirely, embedding included. Calling the existing reindex on a
freshly-installed mismatched dataset would silently do nothing for it.

A new, narrower job — **`embedPendingImages(areaId)`** — is introduced
instead:

- Selects every `indexed_images` row for the area where `embedding IS NULL
  AND image_path IS NOT NULL` (image already on disk, from the installed
  bundle).
- Reads each image's bytes directly from `image_path` — **no Street View
  API calls, no geometry sampling, no cost** (`docs/2026-07-08-astra-fork-
  spec(2).md` §12 budget tracking is untouched by this job).
- Sends them to the inference service's embed endpoint in the same
  `EMBED_CHUNK_SIZE`-sized chunks `index-area.ts` already uses, updating
  each row's `embedding` as chunks complete (same progressive-insert
  pattern, so `/api/areas/:id` polling shows progress).
- Sets the area's `status` to `pending`/`indexing` immediately after
  import (same states an area already passes through) and flips it to
  `indexed` once every row has an embedding — visually indistinguishable
  from indexing a brand-new area.

### Key model

One key built into the Lumi app itself (same for every install). This is
**obfuscation from someone browsing GitHub directly without running
Lumi**, not secrecy from other Lumi users or a security boundary — it's
extractable from the open-source app by anyone who looks. Documenting this
plainly so it's never mistaken for "this content is vetted/trusted" later.
The actual trust/safety boundary for installed content is the validation
pipeline below, not this encryption.

## Security

This feature automatically fetches and processes content from arbitrary
GitHub repos tagged by anyone — meaningfully higher risk than every other
route in this app, which only ever processes input the user themselves
provided. Concrete measures:

- **Fix `captureImagePath` path traversal (pre-existing bug, not new to
  this feature)**: `apps/web/lib/street-view-image-dir.ts`'s
  `captureImagePath(panoId, heading)` builds a filesystem path from
  `panoId` with zero sanitization — `resolve()` happily honors `../`
  sequences in it, and the "image" bytes are never validated as an actual
  image before being written. Today this only matters for a self-uploaded
  zip; once import is automatic and fed by strangers' repos, it's a
  remote arbitrary-file-write. Fix: allowlist `panoId` (and any other
  filename-driving manifest field) against `^[A-Za-z0-9_-]+$`, reject
  anything else, before it ever reaches a path. **To implement now, folded
  into this feature's implementation pass** (not a separate patch) per
  explicit instruction.
- **Manifest schema validation**: strictly validate the decrypted
  manifest's shape/types (not the current loose `as ManifestArea[]` cast)
  — reject malformed/oversized/wrong-typed fields outright.
- **(2026-07-14) Model-tag validation**: reject a manifest whose declared
  `model.id` isn't a known entry in the local `RETRIEVAL_MODELS` registry,
  and reject it if any embedding array's length doesn't match the
  manifest's own declared `model.embeddingDim` — defends against a
  corrupted or malicious bundle claiming a compatible tag while actually
  carrying mismatched-dimension data, which would otherwise either crash
  the insert (Postgres enforces the column's fixed vector width) or, worse
  if the dimension happened to coincidentally match, silently corrupt the
  local search index with embeddings from an unrelated space.
- **Image content validation**: confirm every "image" file actually
  decodes as an image (dimensions/format sniffed) before it's trusted or
  persisted — never trust a file extension alone.
- **Bundle size limits**: cap total compressed size, total decompressed
  size, and file count, checked *before* decompression — zip-bomb defense.
- **Staged install**: download → decrypt → validate all happen in a
  scratch temp dir; only a fully-validated result is copied into real
  `data/` dirs / inserted into the DB. Any failure discards the whole
  staging dir.
- **Local blocklist**: user can hide a specific repo/author from their own
  catalog view — lightweight, client-side, no moderation backend.
- **GitHub API robustness**: rate-limit/failure responses from GitHub are
  caught and surfaced as a clear catalog-level error, never crash the
  popup or half-render a broken list.
- **Trust boundary note**: `/api/datasets/*` inherits this app's existing
  documented "self-hosted, trusted network, no auth" boundary like every
  other route — called out explicitly here because the blast radius
  (network fetch + file write + DB import triggered by remote input) is
  larger than a typical settings change, even though the boundary itself
  isn't new.

## UI

Settings → "Datasets publicados" button → large popup (two tabs):

- **Explorar**: search box + filter chips, list of area cards (Factorio
  mod-portal layout reference — search, browsable list, detail pane with
  stats and an install action — entirely reskinned: dark glass panels,
  Lumi's existing color tokens, no visual trace of the reference).
  **(2026-07-14)** Each area card expands into one row per release
  (model+version), each with a compatibility badge — green "Compatible" on
  an exact model+version match against the locally active retrieval model,
  amber "Requiere completar embeddings — construido con {model} v
  {version}" otherwise. The detail pane (for whichever release is
  selected) shows title/description/stats plus that same badge; installing
  a mismatched release surfaces the confirmation dialog from "Install
  flow" before any download happens. Detail pane also keeps the existing
  note that content is encrypted/decrypted automatically, not a secret
  between users.
- **Publicar**: pick an indexed area, title/description fields, target
  repo field, **(2026-07-14)** a read-only "will publish tagged as
  {model} {version}" indicator (sourced from the local active
  `RETRIEVAL_MODEL`, never editable — see Non-goals), and the ToS
  disclaimer + checkbox gating the publish button.

Mockup (approved, served locally during design, not persisted as a public
artifact URL): `dataset-catalog-mockup.html` in this session's scratchpad.

## Testing

- Unit: manifest schema validator rejects malformed/oversized input;
  `panoId` sanitizer rejects traversal/invalid characters; bundle size-cap
  check rejects an oversized declared/actual size before decompression.
- Unit: staged-install helper discards the staging dir and makes no DB
  writes on a validation failure partway through.
- **(2026-07-14)** Unit: compatibility-check function returns "compatible"
  only on an exact `(modelId, version)` match against a fake registry, and
  "incompatible" for any mismatch on either field — including two entries
  that happen to share the same `embeddingDim`.
- **(2026-07-14)** Unit: manifest validator rejects an unknown `model.id`
  (not present in the local registry) and rejects a manifest whose
  embedding array lengths don't match its own declared `model.embeddingDim`.
- **(2026-07-14)** Unit: `embedPendingImages` only selects rows with
  `embedding IS NULL AND image_path IS NOT NULL`, never calls the Street
  View download path, calls the inference embed endpoint in
  `EMBED_CHUNK_SIZE` chunks, and flips the area to `indexed` only once
  every row has an embedding.
- Manual: publish a real small indexed area to a test repo, confirm the
  topic is set and the release assets are encrypted (not readable without
  the app); install it back on a clean instance; attempt installing a
  hand-crafted malicious manifest (traversal `panoId`, oversized bundle,
  non-image file disguised as `.jpg`, unknown `model.id`, mismatched
  embedding-array length vs. declared `embeddingDim`) and confirm each is
  rejected before any write.
- **(2026-07-14)** Manual: publish the same area under two different
  (test) models, confirm both appear as separate releases under one
  catalog entry with correct badges; install the mismatched one, confirm
  images/points land with `embedding = NULL` and `embedPendingImages`
  automatically fills them in afterward with no new Street View API calls.
