// apps/web/lib/datasets/active-model.ts
import { RETRIEVAL_MODELS } from "@netryx/shared-types";
import { getSettingsRepo } from "../settings-repo";
import type { ModelTag } from "./manifest";

/** Resolves which retrieval model is active locally right now (spec §15.3)
 * to a full {id, version, embeddingDim} tag — used both to label anything
 * this instance publishes and to check an installing dataset's own tag
 * against it. */
export async function getActiveModelTag(): Promise<ModelTag> {
  const modelId = (await getSettingsRepo().getSetting("RETRIEVAL_MODEL")) ?? "lumi-preview";
  const entry = RETRIEVAL_MODELS.find((m) => m.id === modelId);
  if (!entry) {
    throw new Error(`Active RETRIEVAL_MODEL "${modelId}" is not in the local model registry`);
  }
  return { id: entry.id, version: entry.version, embeddingDim: entry.embeddingDim };
}
