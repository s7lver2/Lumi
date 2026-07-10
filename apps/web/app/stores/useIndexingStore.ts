// apps/web/app/stores/useIndexingStore.ts
import { create } from "zustand";
import type { AreaStatus } from "@netryx/shared-types";

export interface Estimate {
  pointsEstimated: number;
  estimatedCostUsd: number;
}
export interface JobProgress {
  status: AreaStatus;
  pointsEstimated: number;
  pointsCaptured: number;
  pointsFailed: number;
  imagesEmbedded: number;
}

interface IndexingState {
  drawnPolygon: [number, number][] | null;
  areaKm2: number;
  estimate: Estimate | null;
  activeJobId: string | null;
  jobProgress: JobProgress | null;
  setDrawnPolygon: (polygon: [number, number][], areaKm2: number) => void;
  clearPolygon: () => void;
  setEstimate: (estimate: Estimate | null) => void;
  startJob: (areaId: string) => void;
  updateProgress: (progress: JobProgress) => void;
  reset: () => void;
}

const INITIAL = {
  drawnPolygon: null,
  areaKm2: 0,
  estimate: null,
  activeJobId: null,
  jobProgress: null,
};

export const useIndexingStore = create<IndexingState>((set) => ({
  ...INITIAL,
  setDrawnPolygon: (drawnPolygon, areaKm2) => set({ drawnPolygon, areaKm2, estimate: null }),
  clearPolygon: () => set({ ...INITIAL }),
  setEstimate: (estimate) => set({ estimate }),
  startJob: (activeJobId) => set({ activeJobId }),
  updateProgress: (jobProgress) => set({ jobProgress }),
  reset: () => set({ ...INITIAL }),
}));