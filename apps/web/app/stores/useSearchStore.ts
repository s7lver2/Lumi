// apps/web/app/stores/useSearchStore.ts
import { create } from "zustand";
import type { SearchRegion, SearchCandidate, SearchResponse } from "@netryx/shared-types";

export type RefineStatus = "idle" | "searching" | "refining" | "done" | "error";

/** Live progress for an in-flight refine (Pass 2), from the refine route's SSE stream. */
export interface RefineProgress {
  verified: number;
  total: number;
  etaMs: number | null;
}

interface SearchState {
  currentSearchId: string | null;
  queryImageName: string | null;
  regions: SearchRegion[];
  candidatesByRegion: Record<string, SearchCandidate[]>;
  selectedRegionId: string | null;
  refineStatus: RefineStatus;
  refineProgress: RefineProgress | null;
  error: string | null;
  batchProgress: { done: number; total: number; failed: number } | null;
  setSearching: (imageName: string) => void;
  setSearchResults: (res: SearchResponse, imageName: string) => void;
  selectRegion: (regionId: string) => void;
  setRefineResults: (regionId: string, candidates: SearchCandidate[]) => void;
  setRefining: () => void;
  setRefineProgress: (progress: RefineProgress) => void;
  setBatchProgress: (progress: { done: number; total: number; failed: number } | null) => void;
  setError: (message: string) => void;
  dismissError: () => void;
  reset: () => void;
}

const INITIAL = {
  currentSearchId: null,
  queryImageName: null,
  regions: [] as SearchRegion[],
  candidatesByRegion: {} as Record<string, SearchCandidate[]>,
  selectedRegionId: null as string | null,
  refineStatus: "idle" as RefineStatus,
  refineProgress: null as RefineProgress | null,
  error: null as string | null,
  batchProgress: null as { done: number; total: number; failed: number } | null,
};

export const useSearchStore = create<SearchState>((set) => ({
  ...INITIAL,
  setSearching: (queryImageName) => set({ ...INITIAL, queryImageName, refineStatus: "searching" }),
  setSearchResults: (res, queryImageName) => {
    const regions = [...res.regions].sort((a, b) => b.aggregateScore - a.aggregateScore);
    set({
      currentSearchId: res.searchId,
      queryImageName,
      regions,
      candidatesByRegion: res.candidatesByRegion,
      selectedRegionId: regions[0]?.id ?? null,
      refineStatus: "done",
      refineProgress: null,
      error: null,
    });
  },
  selectRegion: (selectedRegionId) => set({ selectedRegionId }),
  setRefining: () => set({ refineStatus: "refining", refineProgress: null }),
  setRefineProgress: (refineProgress) => set({ refineProgress }),
  setBatchProgress: (progress: { done: number; total: number; failed: number } | null) =>
    set({ batchProgress: progress }),
  setRefineResults: (regionId, candidates) =>
    set((s) => ({
      candidatesByRegion: { ...s.candidatesByRegion, [regionId]: candidates },
      refineStatus: "done",
      refineProgress: null,
    })),
  setError: (error) => set({ error, refineStatus: "error", refineProgress: null }),
  dismissError: () => set({ error: null }),
  reset: () => set({ ...INITIAL }),
}));