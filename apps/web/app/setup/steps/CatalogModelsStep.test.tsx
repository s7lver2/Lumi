// apps/web/app/setup/steps/CatalogModelsStep.test.tsx
import { describe, it, expect } from "vitest";
import { pickDefaultRelease, pickRecommendedClassifiers } from "./CatalogModelsStep";

describe("pickDefaultRelease", () => {
  it("picks the highest-benchmark release across all bundles", () => {
    const bundles = [
      { owner: "a", repo: "r1", releases: [{ kind: "code-bundle", tag: "t1", version: "1.0", benchmark: { accuracyWithin50m: 0.7 } }] },
      { owner: "a", repo: "r2", releases: [{ kind: "code-bundle", tag: "t2", version: "1.0", benchmark: { accuracyWithin50m: 0.9 } }] },
    ];
    const picked = pickDefaultRelease(bundles as any);
    expect(picked?.repo).toBe("r2");
  });

  it("returns null when there are no releases at all", () => {
    expect(pickDefaultRelease([])).toBeNull();
  });
});

describe("pickRecommendedClassifiers", () => {
  function classifierRelease(modelId: string, tag: string) {
    return { kind: "generic-classifier", tag, modelId, version: "1.0", facets: [{ facet: "weather", hfModelId: "x", strategy: "pipeline" }], benchmark: { sampleCount: 0, ranAt: "x", vramEstimateBytes: null }, description: "", isActive: false };
  }

  it("picks the first generic-classifier release per distinct modelId, across multiple bundles", () => {
    const bundles = [
      { owner: "a", repo: "r1", releases: [classifierRelease("wanda-v1", "wanda-v1.1"), classifierRelease("wanda-v1", "wanda-v1.0")] },
      { owner: "a", repo: "r2", releases: [classifierRelease("velle-v1", "velle-v1.0")] },
    ];
    const picked = pickRecommendedClassifiers(bundles as any);
    expect(picked).toHaveLength(2);
    expect(picked.find((p) => p.release.modelId === "wanda-v1")?.release.tag).toBe("wanda-v1.1");
    expect(picked.find((p) => p.release.modelId === "velle-v1")?.release.tag).toBe("velle-v1.0");
  });

  it("ignores code-bundle releases entirely", () => {
    const bundles = [
      { owner: "a", repo: "r1", releases: [{ kind: "code-bundle", tag: "t1", version: "1.0", benchmark: { accuracyWithin50m: 0.9 } }, classifierRelease("wanda-v1", "wanda-v1.0")] },
    ];
    const picked = pickRecommendedClassifiers(bundles as any);
    expect(picked).toHaveLength(1);
    expect(picked[0].release.modelId).toBe("wanda-v1");
  });

  it("returns [] when there are no classifier releases", () => {
    const bundles = [{ owner: "a", repo: "r1", releases: [{ kind: "code-bundle", tag: "t1", version: "1.0", benchmark: { accuracyWithin50m: 0.9 } }] }];
    expect(pickRecommendedClassifiers(bundles as any)).toEqual([]);
  });

  it("never lets a later release for an already-seen modelId replace the first one picked", () => {
    const bundles = [
      { owner: "a", repo: "r1", releases: [classifierRelease("wanda-v1", "wanda-v1.5")] },
      { owner: "a", repo: "r2", releases: [classifierRelease("wanda-v1", "wanda-v1.9")] },
    ];
    const picked = pickRecommendedClassifiers(bundles as any);
    expect(picked).toHaveLength(1);
    expect(picked[0].release.tag).toBe("wanda-v1.5");
  });
});