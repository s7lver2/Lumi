// apps/web/lib/search/rerank.test.ts
import { describe, it, expect } from "vitest";
import { queryExpansionRerank } from "./rerank";
import type { RetrievedCandidate } from "./retrieval";

function cand(id: string, embedding: number[], similarity: number): RetrievedCandidate {
  return { indexedImageId: id, panoId: id, heading: 0, lat: 0, lng: 0, similarity, embedding };
}

describe("queryExpansionRerank", () => {
  it("re-scores candidates against the expanded query and sorts best-first", () => {
    const query = [1, 0];
    const candidates = [
      cand("a", [1, 0], 0.9),
      cand("b", [0.8, 0.6], 0.7),
      cand("c", [0, 1], 0.1),
    ];
    const out = queryExpansionRerank(query, candidates, 2);
    expect(out.map((c) => c.indexedImageId)).toEqual(["a", "b", "c"]);
    // scores are cosine similarities in [-1, 1], sorted descending
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].similarity).toBeGreaterThanOrEqual(out[i].similarity);
    }
  });

  it("returns an empty array unchanged", () => {
    expect(queryExpansionRerank([1, 0], [], 5)).toEqual([]);
  });
});