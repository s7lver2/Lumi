// apps/web/app/stores/useSearchStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useSearchStore } from "./useSearchStore";
import type { SearchResponse, SearchCandidate } from "@netryx/shared-types";

beforeEach(() => useSearchStore.getState().reset());

const RESPONSE: SearchResponse = {
  searchId: "s1",
  regions: [
    { id: "r1", centroid: { lat: 37.3, lng: -121.9 }, radiusM: 150, aggregateScore: 0.83, candidateCount: 4 },
    { id: "r2", centroid: { lat: 37.5, lng: -122.3 }, radiusM: 150, aggregateScore: 0.68, candidateCount: 1 },
  ],
  candidatesByRegion: {
    r1: [
      { id: "c1", regionId: "r1", indexedImageId: "i1", panoId: "p1", heading: 0, lat: 37.3, lng: -121.9, similarityScore: 0.83, verificationScore: null, rank: 1, status: "unreviewed" },
    ],
  },
};

describe("useSearchStore", () => {
  it("stores results, auto-selects the top region, and lists regions best-first", () => {
    useSearchStore.getState().setSearchResults(RESPONSE, "IMG_1.jpg");
    const s = useSearchStore.getState();
    expect(s.currentSearchId).toBe("s1");
    expect(s.queryImageName).toBe("IMG_1.jpg");
    expect(s.regions[0].id).toBe("r1"); // higher aggregateScore first
    expect(s.selectedRegionId).toBe("r1");
    expect(s.refineStatus).toBe("done");
  });

  it("merges refined candidates back into candidatesByRegion", () => {
    useSearchStore.getState().setSearchResults(RESPONSE, "IMG_1.jpg");
    const refined: SearchCandidate[] = [
      { id: "c9", regionId: "r1", indexedImageId: "i9", panoId: "p9", heading: 0, lat: 37.31, lng: -121.91, similarityScore: 0.8, verificationScore: 0.9, rank: 1, status: "confirmed" },
    ];
    useSearchStore.getState().setRefineResults("r1", refined);
    expect(useSearchStore.getState().candidatesByRegion.r1[0].verificationScore).toBe(0.9);
    expect(useSearchStore.getState().candidatesByRegion.r1[0].status).toBe("confirmed");
  });
});

describe("useSearchStore batchProgress", () => {
  beforeEach(() => useSearchStore.getState().reset());

  it("starts as null", () => {
    expect(useSearchStore.getState().batchProgress).toBeNull();
  });

  it("setBatchProgress updates the field", () => {
    useSearchStore.getState().setBatchProgress({ done: 2, total: 5, failed: 0 });
    expect(useSearchStore.getState().batchProgress).toEqual({ done: 2, total: 5, failed: 0 });
  });

  it("reset() clears batchProgress back to null", () => {
    useSearchStore.getState().setBatchProgress({ done: 1, total: 1, failed: 0 });
    useSearchStore.getState().reset();
    expect(useSearchStore.getState().batchProgress).toBeNull();
  });
});