// apps/web/lib/search/run-search.test.ts
import { describe, it, expect, vi } from "vitest";
import { runSearch } from "./run-search";
import type { RetrievedCandidate } from "./retrieval";
import type { ClusteredRegion } from "./cluster";

describe("runSearch", () => {
  it("embeds, retrieves, re-ranks, clusters, saves the image, and persists — in order", async () => {
    const embedding = [1, 0];
    const retrieved: RetrievedCandidate[] = [
      { indexedImageId: "img-1", panoId: "p", heading: 0, lat: 1, lng: 2, similarity: 0.5, embedding },
    ];
    const reranked: RetrievedCandidate[] = [{ ...retrieved[0], similarity: 0.9 }];
    const regions: ClusteredRegion[] = [
      { centroid: { lat: 1, lng: 2 }, radiusM: 150, aggregateScore: 0.9, memberIds: ["img-1"] },
    ];

    const deps = {
      newSearchId: () => "search-x",
      embedQuery: vi.fn().mockResolvedValue(embedding),
      retrieve: vi.fn().mockResolvedValue(retrieved),
      rerank: vi.fn().mockReturnValue(reranked),
      cluster: vi.fn().mockReturnValue(regions),
      saveImage: vi.fn().mockResolvedValue("/tmp/search-x.jpg"),
      persist: vi.fn().mockResolvedValue({ searchId: "search-x", regions: [], candidatesByRegion: {} }),
    };

    const res = await runSearch(deps, {
      imageBase64: "aaaa",
      imageBytes: Buffer.from([1]),
      imageExt: "jpg",
    });

    expect(deps.embedQuery).toHaveBeenCalledWith("aaaa");
    expect(deps.retrieve).toHaveBeenCalledWith(embedding);
    expect(deps.rerank).toHaveBeenCalledWith(embedding, retrieved);
    expect(deps.cluster).toHaveBeenCalledWith(reranked);
    expect(deps.saveImage).toHaveBeenCalledWith("search-x", expect.any(Buffer), "jpg");
    expect(deps.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        queryImagePath: "/tmp/search-x.jpg",
        queryEmbedding: embedding,
        candidates: reranked,
        regions,
      })
    );
    expect(res.searchId).toBe("search-x");
  });
});