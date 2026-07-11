// apps/web/app/stores/useIndexingStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useIndexingStore } from "./useIndexingStore";

beforeEach(() => useIndexingStore.getState().reset());

describe("useIndexingStore", () => {
  it("stores a drawn polygon with its area and clears it", () => {
    const poly: [number, number][] = [[0, 0], [0, 1], [1, 1], [0, 0]];
    useIndexingStore.getState().setDrawnPolygon(poly, 4.8);
    expect(useIndexingStore.getState().areaKm2).toBe(4.8);
    expect(useIndexingStore.getState().drawnPolygon).toEqual(poly);
    useIndexingStore.getState().clearPolygon();
    expect(useIndexingStore.getState().drawnPolygon).toBeNull();
    expect(useIndexingStore.getState().estimate).toBeNull();
  });

  it("tracks an active job and updates progress", () => {
    useIndexingStore.getState().startJob("area-1");
    expect(useIndexingStore.getState().activeJobId).toBe("area-1");
    useIndexingStore.getState().updateProgress({
      status: "indexing",
      pointsEstimated: 2300,
      pointsCaptured: 1842,
      pointsFailed: 0,
      imagesEmbedded: 6920,
    });
    expect(useIndexingStore.getState().jobProgress?.pointsCaptured).toBe(1842);
  });
  it("sets and clears the estimate", () => {
    useIndexingStore.getState().setEstimate({ pointsEstimated: 100, estimatedCostUsd: 1.5, reusableImages: 0 });
    expect(useIndexingStore.getState().estimate?.pointsEstimated).toBe(100);
    useIndexingStore.getState().setEstimate(null);
    expect(useIndexingStore.getState().estimate).toBeNull();
  });

  it("drawing a new polygon forgets a previous (e.g. failed) job so a new area can be started", () => {
    useIndexingStore.getState().startJob("area-1");
    useIndexingStore.getState().updateProgress({
      status: "failed",
      pointsEstimated: 10,
      pointsCaptured: 10,
      pointsFailed: 0,
      imagesEmbedded: 0,
    });
    expect(useIndexingStore.getState().activeJobId).toBe("area-1");

    useIndexingStore.getState().setDrawnPolygon([[0, 0], [0, 1], [1, 1], [0, 0]], 2.1);

    expect(useIndexingStore.getState().activeJobId).toBeNull();
    expect(useIndexingStore.getState().jobProgress).toBeNull();
    expect(useIndexingStore.getState().drawnPolygon).toEqual([[0, 0], [0, 1], [1, 1], [0, 0]]);
  });
});