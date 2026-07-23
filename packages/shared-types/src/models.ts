// packages/shared-types/src/models.ts

export interface RetrievalModelDefinition {
  id: string;
  displayName: string;
  baseModel: string;
  status: "preview" | "stable" | "deprecated";
  embeddingDim: number;
  version: string;
}

export interface VerificationModelDefinition {
  id: string;
  displayName: string;
  baseModel: string;
  status: "preview" | "stable" | "deprecated";
}

// Kept in manual sync with services/inference/models/registry.py —
// adding a future model means adding an entry here AND there, nothing else.
export const RETRIEVAL_MODELS: RetrievalModelDefinition[] = [
  {
    id: "lumi-preview",
    displayName: "Lumi Preview",
    baseModel: "MegaLoc (frozen)",
    status: "preview",
    embeddingDim: 8448,
    version: "1.0",
  },
  {
    id: "lumi-2",
    displayName: "Lumi 2",
    baseModel: "BoQ + DINOv2 (frozen)",
    status: "preview",
    embeddingDim: 12288,
    version: "1.0",
  },
];

// Ships empty on purpose — verification models are installed from the
// model-catalog marketplace at runtime (apps/web/app/api/model-catalog),
// never hardcoded here. A fresh clone has retrieval only, until an
// operator installs a release that provides verification.
export const VERIFICATION_MODELS: VerificationModelDefinition[] = [];