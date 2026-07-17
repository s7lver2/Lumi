import { describe, it, expect } from "vitest";
import { recommendedBundles, USE_CASES } from "./model-recommendations";

describe("recommendedBundles", () => {
  it("recommends lumi-preview for each individual use case", () => {
    for (const useCase of USE_CASES) {
      const bundles = recommendedBundles([useCase.id]);
      expect(bundles.map((b) => b.id)).toEqual(["lumi-preview"]);
    }
  });

  it("dedupes when multiple use cases map to the same bundle", () => {
    const bundles = recommendedBundles(["image-recognition", "geolocation"]);
    expect(bundles.map((b) => b.id)).toEqual(["lumi-preview"]);
  });

  it("returns an empty array for an empty selection", () => {
    expect(recommendedBundles([])).toEqual([]);
  });
});
