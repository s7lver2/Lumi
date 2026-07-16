// apps/web/lib/search/get-search-result.test.ts
import { describe, it, expect, vi } from "vitest";
import { getSearchResult } from "./get-search-result";

function makePool(searchRows: any[], regionRows: any[], candidateRows: any[]) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM searches")) return { rows: searchRows };
      if (sql.includes("FROM search_regions")) return { rows: regionRows };
      if (sql.includes("FROM search_candidates")) return { rows: candidateRows };
      throw new Error(`unexpected query: ${sql}`);
    }),
  } as any;
}

describe("getSearchResult", () => {
  it("returns null when the search doesn't exist", async () => {
    const pool = makePool([], [], []);
    expect(await getSearchResult(pool, "missing")).toBeNull();
  });

  it("assembles regions and their candidates, joined against indexed_images for pano/heading/lat/lng", async () => {
    const pool = makePool(
      [{ id: "s1" }],
      [{ id: "r1", lat: "40.42", lng: "-3.70", radius_m: 150, aggregate_score: "0.9", candidate_count: 1 }],
      [
        {
          id: "c1", region_id: "r1", indexed_image_id: "img1",
          similarity_score: "0.8", verification_score: "0.84", rank: 1, status: "confirmed",
          pano_id: "abc123", heading: 0, lat: "40.4201", lng: "-3.7002",
        },
      ]
    );

    const result = await getSearchResult(pool, "s1");

    expect(result).not.toBeNull();
    expect(result!.searchId).toBe("s1");
    expect(result!.regions).toEqual([
      { id: "r1", centroid: { lat: 40.42, lng: -3.7 }, radiusM: 150, aggregateScore: 0.9, candidateCount: 1 },
    ]);
    expect(result!.candidatesByRegion.r1).toEqual([
      {
        id: "c1", regionId: "r1", indexedImageId: "img1",
        panoId: "abc123", heading: 0, lat: 40.4201, lng: -3.7002,
        similarityScore: 0.8, verificationScore: 0.84, rank: 1, status: "confirmed",
      },
    ]);
  });

  it("omits candidates with no region_id from candidatesByRegion (matches persistSearch's own behavior)", async () => {
    const pool = makePool(
      [{ id: "s1" }],
      [],
      [
        {
          id: "c1", region_id: null, indexed_image_id: "img1",
          similarity_score: "0.5", verification_score: null, rank: 1, status: "unreviewed",
          pano_id: "abc123", heading: 0, lat: "40.0", lng: "-3.0",
        },
      ]
    );
    const result = await getSearchResult(pool, "s1");
    expect(result!.candidatesByRegion).toEqual({});
  });
});
