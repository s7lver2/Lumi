# Lumi 2 — Bigger Retrieval Backbone + ANN Index — Design

## Goal

Add a second, larger retrieval model ("Lumi 2") that coexists alongside
the current "Lumi Preview" (MegaLoc), for users who want more precision at
a larger index scale (tens of thousands of indexed images) and accept the
extra compute cost. Alongside it, add an HNSW approximate-nearest-neighbor
index to pgvector — the piece that actually fixes the search latency this
session measured growing much faster than row count (1,000 rows → 10.5ms,
10,000 rows → 442ms, 50,000 rows → ~725ms mean, exact cosine search, no
ANN index today).

## Why both threads belong in one project

A bigger embedding alone doesn't fix "escala grande" — it's the same
exact-search bottleneck, just with bigger vectors (slightly slower per
comparison, not faster). The user confirmed both belong here: the model
gives precision, the index gives scale.

## 1. The model: BoQ on a DINOv2-Large backbone

MegaLoc (the current model) is already DINOv2-Base + SALAD aggregation.
Research this session found BoQ (CVPR 2024, github.com/amaralibey/Bag-of-Queries)
reports better recall than SALAD on standard VPR benchmarks (MSLS,
Pitts30k, Tokyo24/7), and running it on a DINOv2-**Large** backbone
(instead of Base) is a genuine step up in size/compute, not just a
same-size architecture swap — matching the user's explicit ask for "more
compute, bigger."

**Exact embedding dimension:** research this session found one reference
to a 12288-dim BoQ+DINOv2 configuration, but the precise dimension for the
Large-backbone variant must be confirmed against the actual released
checkpoint at implementation time (varies by exact backbone/config) —
this is NOT filled in with a placeholder number; whoever implements this
verifies it by loading the real checkpoint and reading its output shape.

**License:** BoQ's repository license must be verified as compatible with
this project's frozen-weights, no-redistribution-of-weights usage pattern
before implementation — not assumed here.

## 2. Coexistence, not replacement

Lumi Preview stays exactly as-is and remains the default. Lumi 2 is a new
entry in the existing model registry mechanism:

- `services/inference/models/registry.py`'s `RETRIEVAL_MODELS` list gains
  a `{"id": "lumi-2", ...}` entry.
- `packages/shared-types/src/models.ts`'s `RETRIEVAL_MODELS` array gains
  the matching TS-side entry, with its own `embeddingDim`.
- `services/inference/loader.py`'s `load_retrieval_model()` gains an
  `elif model_id == "lumi-2":` branch that loads the BoQ+DINOv2-Large
  checkpoint (mechanism — torch.hub vs. a bundled checkpoint file — to be
  decided at implementation time based on how BoQ's own repo distributes
  weights).
- `/settings`'s existing "RETRIEVAL_MODEL" picker (already renders
  whatever's in `RETRIEVAL_MODELS`) needs no structural change — Lumi 2
  just appears as a second option once registered.

## 3. Schema: per-model embedding columns

`indexed_images.embedding` and `searches.query_embedding` are both
`vector(8448)` today — a fixed width tied to MegaLoc's exact dimension.
Since pgvector requires a declared, fixed dimension per column, and Lumi
2's dimension differs, the two models cannot share a column.

Chosen approach: **new nullable columns**, not a generic
model-keyed table. With exactly two models today, a per-model column
(`embedding_lumi2 vector(N)` on `indexed_images`, `query_embedding_lumi2
vector(N)` on `searches`) is simpler than normalizing into a separate
`image_embeddings(image_id, model_id, embedding)` table — pgvector's
`vector(N)` needs a fixed N per column anyway, so a fully generic table
would still need one column per distinct dimension in practice, buying
no real flexibility for the two models this project actually adds. An
area indexed with Lumi 2 populates `embedding_lumi2` only; retrieval reads
whichever column matches the currently-active model. Revisit this
decision if a third model is ever added.

## 4. ANN index (HNSW)

Add a pgvector `hnsw` index on each embedding column
(`indexed_images.embedding` and `indexed_images.embedding_lumi2`,
independently — different models' vectors aren't comparable to each
other so each needs its own index). Retrieval switches from exact cosine
search to an ANN query using the index for the active model's column.

**Accuracy tradeoff, stated plainly to the user and worth repeating in
the plan:** HNSW typically matches exact search recall@10 in the
95–99% range with reasonable parameters — the rare miss is a near-tie
candidate, not a wildly wrong result, and the existing geometric
verification pass (RoMa/Laila) re-checks the final candidate with exact
precision regardless, so the practical end-to-end accuracy impact is
small. This is accepted, not a hidden risk.

## 5. Hardware reality (explicitly accepted, not solved here)

On the user's own dev machine (RTX 3050 Laptop, 6GB VRAM), MegaLoc +
RoMa already compete for VRAM today (RoMa OOMs if run right after MegaLoc
without freeing memory first — measured live this session). DINOv2-Large
is meaningfully heavier than MegaLoc's DINOv2-Base. The user explicitly
chose to accept that local dev/testing on this hardware may hit OOM more
often or need more manual VRAM management (e.g. via
`INFERENCE_LOW_VRAM_MODE`'s existing swap-on-demand behavior, which
already exists and needs no new work) rather than downsizing the model
choice. Smooth day-to-day use of Lumi 2 assumes more VRAM than this one
laptop has (a desktop GPU or cloud instance) — this project does not
attempt to make Lumi 2 comfortable on 6GB.

## Out of scope

- Real fine-tuning of any model — both Lumi Preview and Lumi 2 use frozen
  pretrained weights, per this project's existing PoC constraint
  (`docs/PROOF_OF_CONCEPT.md`).
- Million-row scale — this project targets tens of thousands of indexed
  images, the scale the user confirmed and the scale already benchmarked
  this session.
- Verifying BoQ's exact license terms and exact embedding dimension in
  detail — confirmed at implementation time against the real released
  checkpoint, not here.
- A third retrieval model, or a fully generic per-model embedding table —
  YAGNI for exactly two models.
