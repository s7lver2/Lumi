import { describe, it, expect } from "vitest";
import { filterDatasetItems, filterModelItems } from "./catalog-filters";
import type { DatasetCatalogItem, ModelCatalogItem } from "./catalog-types";

function makeDatasetItem(compatible: boolean): DatasetCatalogItem {
  return {
    id: `item-${compatible}`,
    owner: "inigo",
    repo: "lumi-madrid",
    release: {
      tag: "lumi-preview-v1.0",
      title: "T",
      description: "D",
      model: { id: "lumi-preview", version: "1.0", embeddingDim: 8448 },
      stats: { pointsCaptured: 10, imagesEmbedded: 40 },
      compatible,
    },
  };
}

function makeModelItem(isActive: boolean): ModelCatalogItem {
  return {
    id: `model-${isActive}`,
    owner: "inigo",
    repo: "lumi-model-catalog",
    release: {
      tag: "lumi-preview-v1.0",
      bundleId: "lumi-preview",
      version: "1.0",
      backbones: [],
      benchmark: { accuracyWithin50m: 0.9, avgDistanceM: 5, sampleCount: 20, ranAt: "x" },
      description: "",
      isActive,
    },
  };
}

describe("filterDatasetItems", () => {
  it("returns everything for 'all'", () => {
    const items = [makeDatasetItem(true), makeDatasetItem(false)];
    expect(filterDatasetItems(items, "all")).toHaveLength(2);
  });

  it("filters to only compatible items", () => {
    const items = [makeDatasetItem(true), makeDatasetItem(false)];
    const result = filterDatasetItems(items, "compatible");
    expect(result).toHaveLength(1);
    expect(result[0].release.compatible).toBe(true);
  });

  it("filters to only incompatible items", () => {
    const items = [makeDatasetItem(true), makeDatasetItem(false)];
    const result = filterDatasetItems(items, "incompatible");
    expect(result).toHaveLength(1);
    expect(result[0].release.compatible).toBe(false);
  });
});

describe("filterModelItems", () => {
  it("returns everything for 'all'", () => {
    const items = [makeModelItem(true), makeModelItem(false)];
    expect(filterModelItems(items, "all")).toHaveLength(2);
  });

  it("filters to only the active release", () => {
    const items = [makeModelItem(true), makeModelItem(false)];
    const result = filterModelItems(items, "active");
    expect(result).toHaveLength(1);
    expect(result[0].release.isActive).toBe(true);
  });
});
