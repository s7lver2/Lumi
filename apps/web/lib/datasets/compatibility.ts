// apps/web/lib/datasets/compatibility.ts
import type { ModelTag } from "./manifest";

/**
 * A dataset release is only safe to import with its embeddings intact when
 * BOTH the model id and its version match exactly — embeddingDim is never
 * compared on its own, because two unrelated models can share a dimension
 * while producing totally incompatible embedding spaces (spec's Security
 * section).
 */
export function isCompatible(datasetModel: ModelTag, activeModel: ModelTag): boolean {
  return datasetModel.id === activeModel.id && datasetModel.version === activeModel.version;
}
