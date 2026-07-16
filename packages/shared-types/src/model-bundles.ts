// packages/shared-types/src/model-bundles.ts

/**
 * Product/catalog-level pairing of a retrieval model + verification model
 * under one user-facing name (spec: docs/superpowers/specs/2026-07-14-
 * lumi-preview-unification-design.md). Deliberately NOT a re-architecture:
 * services/inference still reads RETRIEVAL_MODEL/VERIFICATION_MODEL
 * independently, exactly as before this file existed — this registry only
 * exists so the web app can present ONE selectable thing instead of two
 * independently-mismatchable settings.
 */
export interface ModelBundleDefinition {
  id: string;
  displayName: string;
  retrievalModelId: string;
  verificationModelId: string;
  version: string;
  status: "preview" | "stable" | "deprecated";
}

// id matches RETRIEVAL_MODELS[0].id deliberately — the already-planned
// API-first architecture's /api/models/{modelId}/... namespace needs no
// change, since the bundle id and the id it already uses are identical.
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

/** Which bundle (if any) the current pair of active settings corresponds
 * to — used by the Settings UI to render the right selection, or a
 * warning if the two settings were changed independently (outside this
 * UI) into a combination no bundle describes. */
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
