# Lumi Preview / Laila unification (Epic C) — design spec

Status: approved (design phase) — implementation not started.
Related: `docs/superpowers/backlog/2026-07-14-api-first-model-catalog-initiative.md`
(Epic C) — depends on nothing yet built; the not-yet-built Epic B (model
catalog) will later build on top of this epic's `MODEL_BUNDLES` registry.

## Context

The user asked to "unify Lumi Preview and Laila into one model, Lumi
Preview." A grounding fact changed the shape of this ask: the codebase and
master spec (`docs/2026-07-08-astra-fork-spec(2).md` §15) already treat
"Lumi Preview" and "Laila" as the separate brand names of the retrieval
model (MegaLoc wrapper, `RETRIEVAL_MODELS`) and verification model (RoMa
wrapper, `VERIFICATION_MODELS`) respectively — fully implemented,
independently selectable via `RETRIEVAL_MODEL`/`VERIFICATION_MODEL`
settings. So this isn't a greenfield unification.

**Explicit scoping decision:** this is a **product/catalog-level**
unification — "Lumi Preview" becomes the single name/entry a user sees and
selects, while under the hood it's still MegaLoc-for-retrieval + RoMa-for-
verification running in sequence, exactly as today. A real neural-
architecture merge (one model doing both jobs) was explicitly considered
and rejected: MegaLoc and RoMa are fundamentally different frozen backbones
for fundamentally different tasks (embedding similarity vs. dense geometric
matching), and this project has a hard constraint of training nothing from
scratch (master spec §2) — a real merge isn't a realistic scope here.

## Goals

- One place a user picks "Lumi Preview" (today's only bundle) instead of
  independently picking a retrieval model and a verification model —
  removing the ability to pick a mismatched pair, since there's no longer a
  control that could express one.
- The underlying `RETRIEVAL_MODEL`/`VERIFICATION_MODEL` settings and
  `services/inference`'s behavior are **completely unchanged** — this is
  an additive web/shared-types-layer concept, not a re-architecture.
- The new registry (`MODEL_BUNDLES`) is exactly what the future model
  catalog (Epic B) will list — this epic's UI is explicitly an interim
  surface Epic B replaces later, not throwaway work.

## Non-goals

- Any change to `services/inference` — it keeps reading `RETRIEVAL_MODEL`/
  `VERIFICATION_MODEL` independently, exactly as today.
- Any change to the already-planned API-first architecture (Epic A,
  `docs/superpowers/plans/2026-07-14-api-first-architecture.md`) — its
  `/api/models/{modelId}/...` namespace already uses `"lumi-preview"`,
  which is also this epic's bundle id, so nothing there needs touching.
- Uploading new model versions, mandatory benchmarks, owner-only upload
  gating, or any other model-catalog feature — that's Epic B, built later
  on top of `MODEL_BUNDLES`, not part of this epic.
- A dedicated "model page" — considered and explicitly deferred; the
  interim UI stays inside Settings as one dropdown, per user decision.

## Architecture

### `MODEL_BUNDLES` registry

New file, `packages/shared-types/src/model-bundles.ts` (kept separate from
`models.ts` rather than added to it — one clear responsibility per file,
and `models.ts` already has two registries of its own):

```ts
export interface ModelBundleDefinition {
  id: string;
  displayName: string;
  retrievalModelId: string;
  verificationModelId: string;
  version: string;
  status: "preview" | "stable" | "deprecated";
}

export const MODEL_BUNDLES: ModelBundleDefinition[] = [
  {
    id: "lumi-preview",
    displayName: "Lumi Preview",
    retrievalModelId: "lumi-preview",
    verificationModelId: "laila",
    version: "1.0",
    status: "preview",
  },
];
```

`id` is deliberately the same string as `RETRIEVAL_MODELS[0].id` —
Epic A's already-planned `/api/models/{modelId}/...` namespace needs no
change at all, since the bundle id and the id it already uses are
identical.

A resolver function pairs with this registry:

```ts
export function resolveModelBundle(
  retrievalModelId: string,
  verificationModelId: string
): ModelBundleDefinition | null {
  return (
    MODEL_BUNDLES.find(
      (b) => b.retrievalModelId === retrievalModelId && b.verificationModelId === verificationModelId
    ) ?? null
  );
}
```

Used by the Settings UI to figure out which bundle (if any) the two
currently-saved settings correspond to.

### Settings UI: one "Modelo" dropdown

`apps/web/app/settings/sections.ts`'s `"models"` section's generic,
schema-driven rendering (in `SettingsPanel.tsx`) stops rendering
`RETRIEVAL_MODEL`/`VERIFICATION_MODEL` as two independent `<Menu>` rows.
Both settings keep existing exactly as they are in `SETTINGS_SCHEMA` and
`system_settings` — only the rendering changes.

New component, `apps/web/app/components/ModelBundleRow.tsx` (same pattern
as `LowVramModeRow.tsx` from the low-VRAM-mode epic: a special case inside
`SettingsPanel.tsx`'s generic per-setting loop, keyed off
`def.key === "RETRIEVAL_MODEL"`, which also suppresses the separate
`VERIFICATION_MODEL` row entirely):

- Renders a single dropdown of `MODEL_BUNDLES` (today: one option, "Lumi
  Preview").
- Selecting a bundle sets **both** `dirty["RETRIEVAL_MODEL"]` and
  `dirty["VERIFICATION_MODEL"]` in `SettingsPanel.tsx`'s existing dirty-
  state — saved together by the existing "Guardar cambios" button, via the
  existing `PATCH /api/settings` (already accepts multiple keys in one
  body — no backend change).
- The displayed selection is resolved via `resolveModelBundle(currentRetrieval,
  currentVerification)`. If it returns `null` (only reachable today by
  editing `system_settings` directly, not through this UI), the row shows
  a short warning ("La combinación actual de modelos no corresponde a
  ningún paquete conocido") instead of a broken/incorrect dropdown state.
- The existing restart-required warning line ("Cambiar de modelo requiere
  reiniciar el servicio de inferencia para aplicarse") is unchanged — it
  already reads in the singular, no wording change needed.

## Error handling

The only new failure mode is the "no matching bundle" state described
above — surfaced as an inline warning, never a crash or a silently wrong
selection. Everything else (setting validation, persistence) reuses
`validateSettingValue`/`PATCH /api/settings` unchanged.

## Testing

- Unit: `MODEL_BUNDLES` has at least one entry with the expected shape
  (mirrors the existing `RETRIEVAL_MODELS` schema test).
- Unit: `resolveModelBundle` returns the matching bundle for a known pair,
  and `null` for an unknown/mismatched pair.
- Manual: change the "Modelo" dropdown in Settings, save, confirm both
  `RETRIEVAL_MODEL` and `VERIFICATION_MODEL` land in `system_settings`
  together; confirm the restart-required warning still appears.

## Relationship to Epic B

`MODEL_BUNDLES` is exactly the data the future catalog page (Epic B) will
list. When that page exists, it replaces `ModelBundleRow` as the selection
surface (same registry, same "write both settings together" mechanism) —
nothing built here is thrown away. Epic B adds on top: uploading new model
versions, mandatory benchmarks, and owner-only publish gating — none of
that is built in this epic.
