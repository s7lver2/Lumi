# Low-VRAM mode — design spec

Status: approved (design phase) — implementation not started.
Related: depends on the startup/crash screen feature (design pass #2, not yet
written) for the screen shown while the inference service restarts.

## Context

`services/inference/main.py` loads the retrieval model (MegaLoc/"Lumi
Preview") eagerly at startup and, as of today's bugfix, loads the
verification model (RoMa/"Laila") lazily on the first `/verify` call but
never unloads it afterward. On GPUs with little VRAM (confirmed live on an
RTX 3050, 6GB) even that isn't enough: with both models resident, a single
`/embed` call can OOM inside MegaLoc's own aggregation layer. This spec
generalizes today's fix into an explicit, user-controlled setting that
extends the same load-on-demand discipline to the retrieval model, with a
defined unload policy — rather than the current ad hoc "verification never
unloads" behavior.

## Goals

- A settings toggle, `INFERENCE_LOW_VRAM_MODE`, that governs whether the
  inference service ever holds more than one model resident on GPU at once.
- Sensible, hardware-aware default with manual override.
- Visible, accurate feedback in the UI whenever a request is slow because a
  model is being loaded — not a generic spinner, and not a wrong guess.
- No implicit behavior change for existing large-GPU installs.

## Non-goals

- Dynamically re-reading the setting without an inference-service restart
  (explicitly rejected — matches how model IDs/verification config are
  already read once at startup).
- Fine-grained (e.g. per-model) VRAM budgets or partial offloading. This is
  a binary swap discipline, not a memory allocator.
- The startup/crash screen shown during restart — that's spec #2.

## Setting

`INFERENCE_LOW_VRAM_MODE`, plain (non-secret) entry in `system_settings`, one
of `"auto"` (default) / `"on"` / `"off"`. Added to the settings registry in
`packages/shared-types/src/settings.ts` alongside the existing model-selection
settings.

## Auto-detection

Resolved once, at inference-service startup, only when the setting is
`"auto"`:

- `torch.cuda.is_available()` false (no CUDA device) → resolves to **off**.
  No GPU contention to manage; CPU inference already uses system RAM.
- Otherwise, `torch.cuda.get_device_properties(0).total_memory` compared
  against a fixed **8 GiB** cutoff. `<= 8 GiB` → **on**, above → **off**.

The resolved value (not just "auto") is surfaced back to the settings UI so
the user sees what it actually decided, e.g. "GPU detectada: RTX 3050 (6 GB)
→ se activa automáticamente."

## Runtime behavior — the model swap

Both `get_retrieval_model()` and `get_verification_model()` (FastAPI
dependencies in `main.py`) route through one `_ensure_active_model(kind)`
helper:

1. If `kind` is already the active, loaded model → return it immediately.
   Repeated same-kind calls (e.g. the ~553 chunks of one indexing job) never
   re-pay a load — this was the explicit, confirmed requirement: swapping
   must happen **only on operation switch**, never per-request.
2. If a different kind is currently loaded → unload it (`del` the reference
   + `torch.cuda.empty_cache()`), then load the requested kind, mark it
   active.
3. If effective mode is **off** → unchanged from today: retrieval
   eager-loaded at startup, verification lazy-loaded on first `/verify`,
   neither ever unloaded.

## Apply / restart flow

Flipping the toggle writes the new value to `system_settings` immediately,
but it only takes effect the next time the inference service starts (Setting
→ Non-goals). The settings UI shows a "restart pending" banner comparing the
selected value against the value the running service actually started with.

Clicking **"Reiniciar ahora"**:

1. Calls a new `POST /api/setup/run/restart-inference` (web), which kills the
   currently-running inference process and respawns it — reusing the
   spawn/kill plumbing `run/[step]/route.ts`'s existing `verify-services`
   step already has, not a new mechanism.
2. Immediately navigates the user to the startup/loading screen from spec #2
   (the same screen shown on a cold app start when inference/worker haven't
   finished coming up yet) — the user watches the same "models still
   loading" state rather than staring at a settings page.

## Model-loading notice (search / refine / indexing)

New: `GET /model-status` on the inference service, `{"loading":
"retrieval" | "verification" | null}` — cheap, reads the in-memory state
`_ensure_active_model` already needs to maintain internally.

Frontend behavior, all three reusing the same base copy
(`"Cargando modelo de {recuperación|verificación} ({Lumi Preview|Laila}) —
puede tardar unos segundos"`) plus a shared sweeping-stripe "preparing"
indicator (reusing the `--draw`/`--draw-fg` tokens already used for
indexing's progress meters, not a new color):

- **Búsqueda**: `SearchDashboard.tsx`'s existing "Localizando…" frosted pill
  grows a second line + stripe while `/model-status` reports `loading`.
- **Refinar**: today just a button-label swap to "Refinando…" with no
  explanation for the wait — gains the same frosted-pill overlay pattern as
  Búsqueda (promoting it to a shared piece, not a bespoke one).
- **Indexado**: `JobProgressBar.tsx` gains a new phase, shown before
  "Indexando" starts, with an indeterminate (stripe) meter instead of a
  determinate percentage.

The notice is driven by the real `/model-status` flag, not a timeout guess —
it's never shown for unrelated slowness (busy GPU compute, slow network).

Mockups (approved):
- Settings toggle: `https://claude.ai/code/artifact/c9703494-57db-4e5b-a9dd-7b271edd073d`
- Search/refine/indexing notices: served locally during design, not
  persisted as an artifact URL.

## Error handling

If a swap can't free enough VRAM (e.g. another GPU-heavy app is running —
confirmed live today: a game + Discord + Firefox together ate ~2-3GB),
`/embed` and `/verify` catch `torch.OutOfMemoryError` around the swap and
return `503` with actionable Spanish text instead of a bare 500:
*"No hay memoria de GPU suficiente para cargar el modelo. Cierra otras
aplicaciones que usen la GPU e inténtalo de nuevo."*

## Testing

- `services/inference/test_main.py`: mock `load_retrieval_model` /
  `load_verification_model`; assert repeated same-kind calls don't reload;
  assert switching kind unloads the previous one first; assert the
  VRAM-threshold resolver picks the right default from a mocked
  `get_device_properties`.
- Manual: verified live today that the underlying swap concept (lazy
  verification load) fixes real indexing OOM on the 6GB dev machine; full
  low-VRAM-mode manual verification to happen after implementation.

## Open dependency

The restart flow's redirect target (the startup/loading screen) is defined
by spec #2, not yet written. This spec's "Apply / restart flow" section
should be read as forward-referencing that screen, not duplicating its
design.
