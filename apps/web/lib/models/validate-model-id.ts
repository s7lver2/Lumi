// apps/web/lib/models/validate-model-id.ts

export type ModelIdCheck =
  | { ok: true }
  | { ok: false; status: 404; error: string }
  | { ok: false; status: 409; error: string };

/**
 * Gates every per-model endpoint (spec's "Per-model namespace" section).
 * Unknown modelId -> 404. Known but not the currently-loaded model -> 409,
 * naming which one IS active — only one model can be loaded in the
 * inference service at a time (spec §15.4), so silently running against
 * whatever's active instead of the one the caller asked for would be a
 * worse failure than a clear error.
 */
export function validateModelId(modelId: string, knownIds: string[], activeModelId: string): ModelIdCheck {
  if (!knownIds.includes(modelId)) {
    return { ok: false, status: 404, error: `Unknown model id: ${modelId}` };
  }
  if (modelId !== activeModelId) {
    return {
      ok: false,
      status: 409,
      error: `Model "${modelId}" is not currently active — the active retrieval model is "${activeModelId}".`,
    };
  }
  return { ok: true };
}
