// apps/web/app/stores/useSearchStore.ts
import { create } from "zustand";
import type { SearchRegion, SearchCandidate, SearchResponse } from "@netryx/shared-types";

export type RefineStatus = "idle" | "searching" | "refining" | "done" | "error";

interface SearchState {
  currentSearchId: string | null;
  queryImageName: string | null;
  regions: SearchRegion[];
  candidatesByRegion: Record<string, SearchCandidate[]>;
  selectedRegionId: string | null;
  refineStatus: RefineStatus;
  error: string | null;
  setSearching: (imageName: string) => void;
  setSearchResults: (res: SearchResponse, imageName: string) => void;
  selectRegion: (regionId: string) => void;
  setRefineResults: (regionId: string, candidates: SearchCandidate[]) => void;
  setRefining: () => void;
  setError: (message: string) => void;
  reset: () => void;
}

const INITIAL = {
  currentSearchId: null,
  queryImageName: null,
  regions: [] as SearchRegion[],
  candidatesByRegion: {} as Record<string, SearchCandidate[]>,
  selectedRegionId: null as string | null,
  refineStatus: "idle" as RefineStatus,
  error: null as string | null,
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
      error: null,
    });
  },
  selectRegion: (selectedRegionId) => set({ selectedRegionId }),
  setRefining: () => set({ refineStatus: "refining" }),
  setRefineResults: (regionId, candidates) =>
    set((s) => ({
      candidatesByRegion: { ...s.candidatesByRegion, [regionId]: candidates },
      refineStatus: "done",
    })),
  setError: (error) => set({ error, refineStatus: "error" }),
  reset: () => set({ ...INITIAL }),
}));