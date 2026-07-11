// packages/shared-types/src/areas.ts
export type AreaStatus = "pending" | "indexing" | "indexed" | "failed" | "cancelled";

export interface AreaRow {
  id: string;
  name: string | null;
  areaKm2: number;
  status: AreaStatus;
  pointsEstimated: number;
  pointsCaptured: number;
  pointsFailed: number;
  imagesEmbedded: number;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
}