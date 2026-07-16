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
];

export const VERIFICATION_MODELS: VerificationModelDefinition[] = [
  {
    id: "laila",
    displayName: "Laila",
    baseModel: "RoMa (frozen)",
    status: "stable",
  },
];