# Unified model catalog — design spec

Status: approved (design phase) — implementation not started.
Related: `docs/superpowers/specs/2026-07-18-forensic-vision-brainstorm-notes.md`
(this spec picks up that document's Sub-project B, "VRAM usage bar per
model card", and part of Sub-project A, "real multi-level version
history" — for the new install strategy only, see Non-goals) and Sub-
project C/D's Velle/Wanda model decisions (purpose, HF model choices).
This spec does NOT cover the Forensic Vision standalone screen, or the
benchmark-console ("Consola") UI — that's a separate, later spec.

## Context

Today's model-catalog system (`apps/web/app/api/model-catalog/*`,
`apps/web/lib/model-catalog/*`) only knows how to install one thing: a
release that replaces `services/inference`'s entire codebase and restarts
the process (used for Lumi Preview retrieval/verification releases). This
assumption runs deep — `INFERENCE_DIR` is a single hardcoded path,
`uninstall-state.ts` tracks exactly one `currentVersion`/`previousVersion`
pair, `code-bundle.ts` zips the whole tree, and the setup wizard's
`pickDefaultRelease` assumes every catalog bundle competes on the same
`accuracyWithin50m` metric.

Adding Velle (vehicle recognition) and Wanda (weather/time-of-day/season)
as new installable "expert" models doesn't fit this shape: their loading
logic can be fully generic (a Hugging Face image-classification pipeline,
or CLIP zero-shot classification against custom prompts), so installing a
new version of Wanda should never require swapping Python code or
restarting the inference service — only Lumi Preview's retrieval/
verification backbones genuinely need custom per-version code.

## Goals

- Generalize the model-catalog manifest/install/uninstall/publish system
  to support two coexisting install strategies under one catalog UI:
  - `code-bundle` — today's exact mechanism (swap all of
    `services/inference`, restart, single-level undo), used for Lumi
    Preview retrieval/verification releases. No behavior change for this
    strategy.
  - `generic-classifier` — a new, lightweight strategy: a release is only
    metadata (which Hugging Face model(s) to use, what to classify).
    Installing writes a row to a new Postgres table; no files touched, no
    restart, real multi-level undo (every installed version is a
    retained row, not a single filesystem snapshot).
- Add a raw-bytes VRAM reporting path (`services/inference/vram.py`) and a
  per-model VRAM estimate (measured automatically during the existing
  publish-time benchmark run, not hand-typed), so the catalog UI can show
  a bar: total VRAM, currently free, and where this model's estimated
  footprint would land.
- Ship the generic classifier runtime (an HF-pipeline loader + a CLIP
  zero-shot loader, both driven entirely by manifest data, plus
  `POST /models/{model_id}/classify`) as part of the base
  `services/inference` codebase — a normal commit, not a catalog release.
  Only model-specific *configuration* (which HF checkpoint, which zero-
  shot prompts) is what ships as a `generic-classifier` release.
- Publish Velle v1 and Wanda v1 as the first two `generic-classifier`
  releases, proving the whole path end to end.
- Fix the setup wizard's `pickDefaultRelease` to only ever auto-select
  `kind: "code-bundle"` releases — Wanda/Velle are optional installs from
  Ajustes → Modelos afterward, never part of the mandatory setup flow.

## Non-goals

- The Forensic Vision standalone screen (paused, separate spec if/when
  resumed).
- The benchmark-console ("Consola") UI and the actual benchmark battery
  content for Velle/Wanda — a separate, later spec that builds on this
  one (it needs `/models/{model_id}/classify` to exist first).
- Multi-level undo for the `code-bundle` strategy — that stays exactly as
  today (single snapshot); only `generic-classifier` gets real version
  history, because it's a natural side effect of this design (DB rows,
  not filesystem snapshots), not a retrofit of the existing mechanism.
- General model-catalog robustness (disk-space pre-checks, no-concurrent-
  installs, confirm-before-replacing-active) — Sub-project A's other
  items, still deferred.
- Any UI/mockup work beyond the VRAM bar and the minimal changes needed
  to list/filter releases by `kind` in `ModelosSection.tsx`.

## Architecture

**Manifest (`apps/web/lib/model-catalog/manifest.ts`):**
`ModelCatalogManifest` gains a required `kind: "code-bundle" |
"generic-classifier"` field. A `code-bundle` manifest keeps today's exact
shape (`bundleId`, `backbones`, `verificationModelId?`, etc.) unchanged. A
`generic-classifier` manifest instead requires `modelId` (e.g.
`"wanda-v1"`), `hfModelIds: string[]`, and `facets: { facet: string;
strategy: "pipeline" | "clip-zero-shot"; prompts?: string[] }[]` (`prompts`
required when `strategy` is `"clip-zero-shot"`, absent otherwise). Both
kinds keep `version`, `benchmark`, `description`. `benchmark` gains
`vramEstimateBytes: number | null`.

**New table (`db/migrations/<ts>_installed_classification_models.js`):**
```sql
CREATE TABLE installed_classification_models (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id     text NOT NULL,        -- e.g. "wanda-v1"
  manifest     jsonb NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  installed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON installed_classification_models (model_id, active);
```
Every install is a new row; uninstall sets `active = false` on the current
row and, if an earlier row for the same `model_id` exists, sets it back to
`active = true` — a real linear history per `model_id`, not a single
global snapshot. `services/inference` reads only `active = true` rows.

**`services/inference` — generic classifier runtime:**
- `models/registry.py`'s `CLASSIFICATION_MODELS` stops being a hardcoded
  Python list — a new `get_active_classification_models(conn)` (mirroring
  `get_active_model_ids`) reads `installed_classification_models` where
  `active = true`.
- `loader.py` gains two generic loaders: `load_hf_pipeline_classifier(hf_model_id)`
  (wraps `transformers.pipeline("image-classification", model=hf_model_id)`)
  and `load_clip_zero_shot_classifier(hf_model_id, prompts)` (wraps
  `transformers.CLIPModel`/`CLIPProcessor` zero-shot scoring against
  `prompts`). A manifest's `facets` list drives which loader(s) an
  installed model needs; a model with multiple facets (Wanda) loads
  multiple sub-models under one `model_id`, exposing one `.classify(image)
  -> list[ClassifyGroup]` that runs every facet and merges the results —
  same uniform interface `main.py` already expects from `RomaMatcher`.
- `main.py`'s `_ensure_active_model` is generalized from a fixed 2-value
  `kind` enum to an arbitrary string key — `"retrieval"`, `"verification"`,
  or any installed classification `model_id`. In low-VRAM mode, activating
  any of these still unloads whichever was active before (same shared
  single-resident-model slot, just generalized — this was confirmed
  explicitly with you as the desired behavior).
- New endpoint `POST /models/{model_id}/classify`: looks up `model_id`
  against the live DB-backed registry (404 if not installed/active),
  decodes the image, calls `_ensure_active_model(model_id)`, runs
  `.classify()`, returns `{ groups: [{ facet, labels: [{name, score}] }] }`
  — a facet-based envelope so any future classifier (however many facets
  it has) fits the same response shape without a new Pydantic model per
  model. Reuses the existing OOM→503 handling.

**Install/uninstall/publish dispatch (`apps/web/app/api/model-catalog/*`):**
- `POST install`: reads `manifest.kind` first. `code-bundle` → today's
  exact flow, unchanged. `generic-classifier` → validates the manifest,
  `INSERT`s into `installed_classification_models`, returns `201`
  immediately — no file writes, no `restart-inference` call. HF weights
  download lazily on first `/models/{model_id}/classify` call, same lazy
  pattern as MegaLoc/RoMa today.
- `POST uninstall`: `code-bundle` → unchanged (single snapshot restore).
  `generic-classifier` → deactivates the current row for that `model_id`
  and reactivates the immediately-preceding row for the same `model_id`,
  if one exists.
- `POST publish`: branches on which kind is being published. A
  `code-bundle` publish is unchanged (zips all of `services/inference`).
  A `generic-classifier` publish uploads only the manifest as a release
  asset — there's no code to zip.
- `GET /api/model-catalog`: unchanged shape, but every returned *release*
  now carries its manifest's `kind` (a single GitHub repo could in
  principle host releases of either kind over time, so `kind` lives on
  the release, not the bundle/repo); `ModelosSection.tsx` groups/filters
  on it (Lumi Preview releases vs. installed experts) instead of assuming
  one flat list of the same kind of thing.

**VRAM bar:**
- `vram.py` gains `gpu_memory_bytes(cuda_available) -> tuple[int, int] |
  None` (total, free) via `torch.cuda.mem_get_info()`. `GET /model-status`
  exposes `gpuTotalBytes`/`gpuFreeBytes` (both `null` without CUDA)
  alongside the existing `gpuNote` string.
- `benchmark.ts` runs entirely over HTTP against `services/inference` (it
  has no direct access to `torch`), so it can't call
  `torch.cuda.max_memory_allocated()` itself. Instead: right before
  starting its accuracy run, it calls `GET /model-status` and records
  `gpuFreeBytes` as a baseline; right after the run finishes (model still
  loaded/resident), it calls `GET /model-status` again. The drop in
  `gpuFreeBytes` between those two calls is written into the manifest's
  `benchmark.vramEstimateBytes` — measured via the same HTTP boundary
  everything else in `benchmark.ts` already uses, not a direct Python
  call. This only works cleanly because `benchmark.ts` runs right after a
  fresh load with nothing else competing for the GPU; noted as a known
  approximation, not a lab-grade measurement. Older manifests published
  before this change simply have `null` here.
- The catalog detail panel renders a horizontal bar: full width =
  `gpuTotalBytes`, one segment = `gpuFreeBytes` (available now), a
  differently-colored segment = where `vramEstimateBytes` would land.
  When `vramEstimateBytes` is `null` or there's no GPU, the bar is
  replaced by a plain text line — never an empty/broken bar.

**Setup wizard (`apps/web/app/setup/steps/CatalogModelsStep.tsx`):**
`pickDefaultRelease` adds an explicit `bundle.releases.filter(r =>
r.kind === "code-bundle")` (or equivalent bundle-level filter) before
picking the best-accuracy release — so a `generic-classifier` release can
never be auto-selected as "the" model during setup, regardless of what
`accuracyWithin50m`-shaped number it might carry. Installing Wanda/Velle
during initial setup is out of scope; they're always a later, optional
Ajustes → Modelos action.

## Testing

- `services/inference`: unit tests (mocked `transformers.pipeline`/
  `CLIPModel`, no real downloads) for the two generic loaders; tests
  extending the existing `_ensure_active_model` suite to cover arbitrary
  `model_id` strings, not just the 2 historical kinds; endpoint tests for
  `/models/{model_id}/classify` (404 unknown/inactive id, 200 happy path
  with the `groups` shape, 503 via the existing OOM path); a test that the
  classifier registry is read from the DB, not a hardcoded list.
- `apps/web`: `manifest.ts` validation tests for both `kind` shapes
  (rejects a `generic-classifier` manifest missing `hfModelIds`/`facets`,
  rejects a `code-bundle` manifest carrying those fields); `install`/
  `uninstall`/`publish` route tests covering both strategies, explicitly
  asserting the `generic-classifier` path never calls the
  `restart-inference` step; a multi-level-undo test (install v1 → v2 →
  uninstall → back to v1, not the pre-install state); `vram.py`'s new raw-
  bytes function; `pickDefaultRelease` explicitly rejecting a
  `generic-classifier` bundle even when it has the highest
  `accuracyWithin50m`-shaped number.
- No automated test can exercise a real Hugging Face download or real GPU
  VRAM measurement — verified manually in the implementation plan
  (install Wanda for real, call `/models/wanda-v1/classify` against a real
  photo, confirm the VRAM bar renders against a real GPU).
