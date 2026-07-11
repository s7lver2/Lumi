// apps/web/app/stores/useIndexingStore.ts
import { create } from "zustand";
import type { AreaStatus } from "@netryx/shared-types";

export interface Estimate {
  pointsEstimated: number;
  estimatedCostUsd: number;
  reusableImages: number;
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
  // Drawing a new polygon always means "start a new area" — forget any
  // previous job reference (in particular a finished/failed/cancelled one)
  // so the side panel switches back to the estimate/confirm flow instead of
  // staying stuck showing the old job's outcome forever.
  setDrawnPolygon: (drawnPolygon, areaKm2) =>
    set({ drawnPolygon, areaKm2, estimate: null, activeJobId: null, jobProgress: null }),
  clearPolygon: () => set({ ...INITIAL }),
  setEstimate: (estimate) => set({ estimate }),
  startJob: (activeJobId) => set({ activeJobId }),
  updateProgress: (jobProgress) => set({ jobProgress }),
  reset: () => set({ ...INITIAL }),
}));