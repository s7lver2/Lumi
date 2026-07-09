// apps/web/lib/search/cluster.ts
import * as turf from "@turf/turf";
import type { RetrievedCandidate } from "./retrieval";

export interface ClusteredRegion {
  centroid: { lat: number; lng: number };
  radiusM: number;
  aggregateScore: number;
  memberIds: string[];
}

/**
 * Greedy radius clustering (spec §9.2). Candidates are processed best-score
 * first; each joins the first existing region within `radiusMeters` of that
 * region's seed, otherwise seeds a new region. aggregateScore is the region's
 * best member score (its seed, since we go best-first).
 */
export function clusterCandidates(
  candidates: RetrievedCandidate[],
  radiusMeters: number
): ClusteredRegion[] {
  const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity);
  const regions: (ClusteredRegion & { seed: [number, number] })[] = [];

  for (const c of sorted) {
    const point: [number, number] = [c.lng, c.lat];
    const region = regions.find(
      (r) => turf.distance(turf.point(r.seed), turf.point(point), { units: "meters" }) <= radiusMeters
    );
    if (region) {
      region.memberIds.push(c.indexedImageId);
    } else {
      regions.push({
        seed: point,
        centroid: { lat: c.lat, lng: c.lng },
        radiusM: radiusMeters,
        aggregateScore: c.similarity,
        memberIds: [c.indexedImageId],
      });
    }
  }

  return regions.map(({ seed: _seed, ...r }) => r);
}