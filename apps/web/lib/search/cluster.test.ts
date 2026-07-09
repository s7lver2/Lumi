// apps/web/lib/search/cluster.test.ts
import { describe, it, expect } from "vitest";
import { clusterCandidates } from "./cluster";
import type { RetrievedCandidate } from "./retrieval";

function at(id: string, lat: number, lng: number, similarity: number): RetrievedCandidate {
  return { indexedImageId: id, panoId: id, heading: 0, lat, lng, similarity, embedding: [] };
}

describe("clusterCandidates", () => {
  it("groups nearby candidates into one region and distant ones into another", () => {
    const candidates = [
      at("a", 40.4168, -3.7038, 0.95), // Madrid
      at("b", 40.4169, -3.7039, 0.80), // ~15m from a
      at("c", 41.3874, 2.1686, 0.60), // Barcelona, far away
    ];
    const regions = clusterCandidates(candidates, 150);
    expect(regions).toHaveLength(2);
    const madrid = regions.find((r) => r.memberIds.includes("a"))!;
    expect(madrid.memberIds.sort()).toEqual(["a", "b"]);
    // aggregate score is the best member's score
    expect(madrid.aggregateScore).toBeCloseTo(0.95, 5);
  });

  it("returns no regions for no candidates", () => {
    expect(clusterCandidates([], 150)).toEqual([]);
  });
});