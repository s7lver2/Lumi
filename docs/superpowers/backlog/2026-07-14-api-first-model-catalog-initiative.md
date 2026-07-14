# API-first platform + model catalog + Lumi Preview + Claude skill — raw initiative

Status: **captured, not brainstormed**. This document exists purely so a
large, multi-part request survives across sessions without re-explaining it
each time context resets. Do not start implementing anything from this
document without first running it through `superpowers:brainstorming`
epic-by-epic, per the user's explicit instructions below.

Captured verbatim-in-spirit from the user's 2026-07-14 message (originally
in Spanish; paraphrased to English here, meaning preserved exactly).

## The user's own process for this initiative

1. Document the full request (this file) before doing anything else.
2. Determine a **priority order** across all epics below (this hasn't
   happened yet — see "Prioritization" section).
3. Go through the epics **one at a time**: brainstorm, design, build local
   mockups, write a spec, then a plan, then implement — same discipline
   used for the 2026-07-13 features (startup health screens, build.py TUI).
4. This is explicitly a multi-session effort ("sin que tus limites me
   afecten" — so it doesn't matter if a single session's context runs out
   mid-epic).

## Epic A — API-first architecture (foundational, everything else depends on it)

**Core idea:** every capability the project has — today's and anything
built in the future — should be exposed as a real, addressable API. The web
app (`apps/web`) should be a *consumer* of that API like any other client,
not a special-cased caller with direct backend/DB access.

Concrete pieces called out by the user:
- An endpoint listing all downloadable models in the catalog (see Epic B),
  including each model's own endpoints and how to call them.
- An endpoint/route that renders a map at a given set of coordinates —
  intended use case: once a location-estimation model returns candidate
  coordinates, this is what turns them into something visual. Exact tech
  (Leaflet/OpenLayers/static tile render/etc — user said "openbox", likely
  shorthand, not a specific named library) is undecided — a brainstorming
  question, not a decision made yet.
- **Every model gets its own endpoints**, shaped around that model's actual
  input/output contract. Concretely, for the (future, see Epic C) unified
  Lumi Preview model:
  - **Estimation endpoint**: input = an image; output = a list of
    "suspect" location objects, each with coordinates + probability/score
    (i.e. today's retrieval-model behavior, but as a standalone documented
    API contract).
  - **Refinement endpoint**: input = one or more of those suspect objects
    (from the estimation endpoint); output = refined coordinates + a
    certainty/confidence percentage (i.e. today's verification-model
    behavior, standalone documented API contract).
  - **Result/map endpoint**: takes the refined result and both (a) shows
    those values in the generated map, and (b) is less "an endpoint" and
    more **a generated subpage** for that specific request — i.e. a
    shareable rendered page/URL for one estimation+refinement run, not just
    raw JSON.

This is the foundation the Claude skill (Epic D) is built on top of, and
what the model catalog (Epic B) and Lumi Preview unification (Epic C) both
assume exists.

## Epic B — Model catalog

A catalog of downloadable models, **layout only** inspired by the Factorio
mod portal (per this project's existing convention — see the already-built
`docs/superpowers/specs/2026-07-13-dataset-catalog-design.md`, which used
the same layout reference for a *different* feature — see "Relationship to
existing specs" below).

- Initially contains exactly one entry: **Lumi Preview** (Epic C).
- Future model versions get added to the catalog over time as they're
  released.
- Each model's catalog detail page has: a description, and **benchmark
  results that are run automatically and are mandatory** before a model
  version can be uploaded — i.e. you cannot publish a model to the catalog
  without the benchmark suite having run and produced results attached to
  that listing.
- **Only the user (project owner) can upload models** to this catalog —
  this is not a community-upload system (unlike the area/dataset catalog
  in the existing 2026-07-13 spec, which *is* community-facing). Auth/
  authorization model for "only me can upload" is undecided — brainstorming
  question.
- **(2026-07-14, from the dataset-catalog model-scoping work)** The model
  registry (`services/inference/models/registry.py` /
  `packages/shared-types/src/models.ts`) already gained a `version` field
  as part of adapting the dataset catalog for per-model datasets — this
  epic should treat that field as already-existing groundwork, not
  something to design from scratch.

## Epic C — Unify Lumi + Laila into one model: "Lumi Preview"

Today's retrieval model (internally "Lumi") and verification model
(internally "Laila") become **one released, catalog-listed unit** called
**Lumi Preview** — the first (and initially only) entry in the model
catalog from Epic B.

**Important grounding fact found 2026-07-14 (while brainstorming the
dataset-catalog model-scoping change):** the codebase and the master spec
(`docs/2026-07-08-astra-fork-spec(2).md` §15) already treat "Lumi Preview"
and "Laila" as the **brand names of the separate retrieval and verification
models**, not a merger of the two — `RETRIEVAL_MODELS` has a `lumi-preview`
entry (MegaLoc wrapper) and `VERIFICATION_MODELS` has a `laila` entry (RoMa
wrapper), fully implemented, independently selectable in Settings. This
means Epic C, as the user described it on 2026-07-14, is a **rename/
reframe of an already-shipped naming scheme**, not a greenfield unification
— worth surfacing explicitly at brainstorming time so the two aren't
conflated: is "Lumi Preview" meant to become a single model that does both
estimation and verification internally (a real architectural merge), or is
it meant to be a single *product-facing/catalog* entry that still runs two
separate wrapped models under the hood (a packaging/naming change only)?
This wasn't resolved before this document was written and should be the
first question asked when this epic's brainstorming starts.

Open question carried over from the 2026-07-13 session (not yet resolved,
worth checking before brainstorming this epic): there was an in-flight
`deep-research` workflow investigating runtime-optimization and
alternative-pretrained-model options for what was then being called "Lumi
3.1" (retrieval) / "Laila 4.1" (verification) as *separately* optimized
models. Whether that research is still directly reusable or needs
reframing given the naming/unification question above is a brainstorming-
time question — check whether that workflow run (`wf_4f4e7932-f53`) ever
finished and what it found before starting this epic's brainstorm, so that
work isn't wasted or ignored.

## Epic D — Claude skill for interacting with the project via the API

A Claude Code (or Claude Agent SDK) **skill** that teaches Claude how to
use the Epic A API end-to-end, so a user can hand Claude a photo and ask
"where was this taken?" and Claude:
1. Calls the estimation endpoint with the image → gets candidate locations.
2. Calls the refinement endpoint with those candidates → gets refined
   coordinates + confidence.
3. Calls the result/map endpoint with the refined coordinates → gets a
   generated subpage/URL for that result.
4. Shows the user that URL (or embeds it), rather than just dumping raw
   coordinates.

This epic is entirely dependent on Epic A existing first (there's nothing
for the skill to call otherwise).

## Relationship to existing specs/work (important — don't conflate these)

- `docs/superpowers/specs/2026-07-13-dataset-catalog-design.md` ("publish
  weights" dataset catalog) is a **different feature** from Epic B here,
  despite both citing the Factorio mod portal as a layout reference:
  - The existing spec catalogs **indexed areas** (Street View captures a
    user has indexed locally) and is explicitly **community-upload**
    (any Lumi user can publish/share their own indexed area).
  - Epic B here catalogs **model versions** (weights) and is explicitly
    **owner-upload-only** (only the project owner publishes new model
    releases).
  - Both may end up sharing UI patterns (list/detail layout, GitHub-backed
    storage, etc) — worth a brainstorming-time question, not assumed.
  - **(2026-07-14)** The dataset catalog spec was revised to tag each
    published dataset release with `{modelId, modelVersion, embeddingDim}`
    so datasets from incompatible models/versions don't silently corrupt
    local search — this is the direct link between the two catalogs: a
    dataset release's model tag should, in principle, correspond to an
    entry a user could look up in Epic B's model catalog once it exists.
    Epic B doesn't need to exist for the dataset catalog to work (the tag
    is self-contained metadata), but the two should stay consistent in
    naming/versioning once both exist.
- Low-VRAM mode (`docs/superpowers/specs/2026-07-13-low-vram-mode-design.md`)
  remains designed-only, not implemented, and is not mentioned in this new
  request — still a valid backlog item, just not part of this initiative.
- The Docker-full-packaging idea (from the 2026-07-13 session, "que la app
  pueda comenzar a funcionar completamente en docker de alguna manera") is
  still pending and still not part of this initiative — a separate backlog
  item to prioritize alongside these.
- The app update-system idea was explicitly discarded by the user
  (2026-07-13: "vamos a descartar el sistema de actualizaciones") — not a
  backlog item, don't resurrect it.

## Prioritization

**Not decided yet.** This is explicitly the first collaborative step,
per the user's own process above — to be done at the start of the next
work session on this initiative, before any single epic's brainstorming
begins. Candidate list to prioritize (this initiative's 4 epics, plus
still-open items from before):

- Epic A — API-first architecture
- Epic B — Model catalog
- Epic C — Unify Lumi + Laila → Lumi Preview (see the naming/reframe
  question raised above — resolve that first, it changes the scope)
- Epic D — Claude skill for API interaction
- (carried over, still pending) Full Docker packaging
- (carried over, still pending) Low-VRAM mode implementation (designed only)
- (carried over, still pending) Dataset/area catalog implementation
  (designed, and as of 2026-07-14 revised for per-model scoping, but still
  not implemented)

Likely dependency constraint worth surfacing at prioritization time (not a
decision, just an observation): Epic D needs Epic A; Epic B's first real
listing needs Epic C to exist; Epic A's per-model endpoints are easiest to
shape correctly if Epic C (the unified contract) is decided first rather
than retrofitted after building A around the old two-model split.

A prioritization proposal was floated in conversation on 2026-07-14
(A → C → B → D, with Docker/low-VRAM/dataset-catalog independent of that
order) but never explicitly confirmed by the user — still open.
