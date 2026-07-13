# "Publish weights" dataset catalog — design spec

Status: approved (design phase) — implementation not started.
Related: independent of features #1/#2, but shares this session's overall
context (2026-07-13 design pass, 3 of 3).

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

## Non-goals

- A central Lumi-run index/moderation server.
- True per-publisher secrecy (see "Key model" — the shared key is
  obfuscation from non-Lumi observers, not secrecy from other Lumi users).
- Automated content moderation beyond the safety validation in "Security"
  below (a local per-user blocklist is in scope; a review/reporting backend
  is not).

## Architecture

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
3. Bundle bytes + a small metadata blob (title, description, stats) both
   encrypted with the shared app key (AES-256-GCM, reusing
   `packages/settings-repo/src/crypto.ts`'s primitives — needs a
   Buffer-accepting variant of `encrypt()`, which currently takes a
   `string`).
4. Uploaded as GitHub Release assets in the user's repo (auto-created if it
   doesn't exist); repo gets the `lumi-dataset` topic added
   (`PUT /repos/{owner}/{repo}/topics`).
5. Metadata blob is uploaded separately/small so browsing can decrypt just
   that (fast) without pulling the full bundle.
6. Publish is gated behind an explicit, non-blocking disclaimer + checkbox
   surfacing the ToS note above — shown every time, not a one-time dismiss,
   since this is a per-publish legal decision each time real content goes
   out.

### Discovery

GitHub topic search (`GET /search/repositories?q=topic:lumi-dataset`) —
fully decentralized, no shared index file to maintain, no PR review queue.
Trade-off accepted: new repos/topics can take a little while to appear in
GitHub's search index, and unauthenticated search has modest rate limits.

### Install flow

1. Fetch the repo's latest release, download the small encrypted metadata
   asset, decrypt with the shared key → renders the catalog card/detail.
2. On "Instalar": download the full encrypted bundle asset.
3. Decrypt → **stage into a scratch temp directory** (not real `data/`
   dirs yet).
4. Run the full validation pipeline (see Security) against the staged
   content.
5. Only on full success: copy validated images into the real image
   directory and insert DB rows via (a hardened version of) the existing
   import pipeline (`apps/web/app/api/areas/import/route.ts`).
6. On any validation failure: discard the entire staging directory, surface
   a clear error, no partial writes.

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

- **Explorar**: search box + filter chips, two-pane list/detail (Factorio
  mod-portal layout reference — search, browsable list, detail pane with
  stats and an install action — entirely reskinned: dark glass panels,
  Lumi's existing color tokens, no visual trace of the reference). Detail
  pane shows an explicit note that content is encrypted/decrypted
  automatically, not a secret between users.
- **Publicar**: pick an indexed area, title/description fields, target
  repo field, the ToS disclaimer + checkbox gating the publish button.

Mockup (approved, served locally during design, not persisted as a public
artifact URL): `dataset-catalog-mockup.html` in this session's scratchpad.

## Testing

- Unit: manifest schema validator rejects malformed/oversized input;
  `panoId` sanitizer rejects traversal/invalid characters; bundle size-cap
  check rejects an oversized declared/actual size before decompression.
- Unit: staged-install helper discards the staging dir and makes no DB
  writes on a validation failure partway through.
- Manual: publish a real small indexed area to a test repo, confirm the
  topic is set and the release assets are encrypted (not readable without
  the app); install it back on a clean instance; attempt installing a
  hand-crafted malicious manifest (traversal `panoId`, oversized bundle,
  non-image file disguised as `.jpg`) and confirm each is rejected before
  any write.
