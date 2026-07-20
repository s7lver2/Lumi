import { describe, it, expect } from "vitest";
import { flattenDatasetAreas, flattenModelBundles } from "./catalog-types";
import type { DatasetArea, CatalogBundle } from "./catalog-types";

describe("flattenDatasetAreas", () => {
  it("produces one item per release, keyed by owner/repo#tag", () => {
    const areas: DatasetArea[] = [
      {
        owner: "inigo",
        repo: "lumi-madrid",
        releases: [
          {
            tag: "lumi-preview-v1.0",
            title: "Downtown Madrid",
            description: "",
            model: { id: "lumi-preview", version: "1.0", embeddingDim: 8448 },
            stats: { pointsCaptured: 10, imagesEmbedded: 40 },
            compatible: true,
          },
        ],
      },
    ];
    const items = flattenDatasetAreas(areas);
    expect(items).toEqual([
      { id: "inigo/lumi-madrid#lumi-preview-v1.0", owner: "inigo", repo: "lumi-madrid", release: areas[0].releases[0] },
    ]);
  });
});

describe("flattenModelBundles", () => {
  it("produces one item per release, keyed by owner/repo#tag", () => {
    const bundles: CatalogBundle[] = [
      {
        owner: "inigo",
        repo: "lumi-model-catalog",
        releases: [
          {
            tag: "lumi-preview-v1.0",
            kind: "code-bundle",
            bundleId: "lumi-preview",
            version: "1.0",
            backbones: [],
            benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x", vramEstimate: null },
            description: "",
            isActive: true,
          },
        ],
      },
    ];
    const items = flattenModelBundles(bundles);
    expect(items).toEqual([
      { id: "inigo/lumi-model-catalog#lumi-preview-v1.0", owner: "inigo", repo: "lumi-model-catalog", release: bundles[0].releases[0] },
    ]);
  });
});
