// apps/web/lib/model-catalog/manifest.test.ts
import { describe, it, expect } from "vitest";
import { validateModelCatalogManifest } from "./manifest";

function validManifest() {
  return {
    kind: "code-bundle" as const,
    bundleId: "lumi-preview",
    version: "1.1",
    backbones: [
      { name: "MegaLoc", source: "torch.hub:gmberton/MegaLoc" },
      { name: "RoMa", source: "pip:romatch" },
    ],
    benchmark: { accuracyWithin50m: 0.89, avgDistanceM: 8.1, sampleCount: 20, ranAt: "2026-07-15T10:00:00.000Z" },
    description: "Better re-ranking.",
  };
}

function validClassifierManifest() {
  return {
    kind: "generic-classifier" as const,
    modelId: "wanda-v1",
    version: "1.0",
    facets: [
      { facet: "weather", hfModelId: "prithivMLmods/Weather-Image-Classification", strategy: "pipeline" as const },
      {
        facet: "time_of_day",
        hfModelId: "openai/clip-vit-base-patch32",
        strategy: "clip-zero-shot" as const,
        prompts: ["foto tomada al amanecer", "foto tomada al mediodía", "foto tomada al atardecer", "foto tomada de noche"],
      },
    ],
    benchmark: { sampleCount: 0, ranAt: "2026-07-20T10:00:00.000Z", vramEstimateBytes: null },
    description: "Clima, hora del día y estación.",
  };
}

describe("validateModelCatalogManifest — generic-classifier", () => {
  it("accepts a well-formed generic-classifier manifest", () => {
    const result = validateModelCatalogManifest(validClassifierManifest());
    expect(result.kind).toBe("generic-classifier");
    if (result.kind === "generic-classifier") {
      expect(result.modelId).toBe("wanda-v1");
      expect(result.facets).toHaveLength(2);
    }
  });

  it("rejects a generic-classifier manifest missing facets", () => {
    const manifest = validClassifierManifest() as any;
    delete manifest.facets;
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/facets/);
  });

  it("rejects a clip-zero-shot facet missing prompts", () => {
    const manifest = validClassifierManifest() as any;
    delete manifest.facets[1].prompts;
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/prompts/);
  });

  it("rejects a pipeline facet that isn't missing prompts (prompts allowed absent)", () => {
    // sanity: a "pipeline" facet with no prompts field at all is valid
    const manifest = validClassifierManifest();
    expect(() => validateModelCatalogManifest(manifest)).not.toThrow();
  });

  it("rejects an unknown kind", () => {
    const manifest = { ...validClassifierManifest(), kind: "not-a-real-kind" } as any;
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/kind/);
  });

  it("rejects a code-bundle manifest missing kind (kind is now required)", () => {
    const manifest = validManifest() as any;
    delete manifest.kind;
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/kind/);
  });
});

describe("validateModelCatalogManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validateModelCatalogManifest(validManifest());
    expect(result.bundleId).toBe("lumi-preview");
    expect(result.benchmark.accuracyWithin50m).toBe(0.89);
  });

  it("rejects a manifest missing the benchmark field entirely", () => {
    const manifest = validManifest() as any;
    delete manifest.benchmark;
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/benchmark/);
  });

  it("rejects a manifest whose backbones isn't an array", () => {
    const manifest = validManifest() as any;
    manifest.backbones = "not-an-array";
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/backbones/);
  });

  it("rejects a non-object top level", () => {
    expect(() => validateModelCatalogManifest(null)).toThrow();
    expect(() => validateModelCatalogManifest("nope")).toThrow();
  });

  it("rejects a missing bundleId/version", () => {
    const manifest = validManifest() as any;
    delete manifest.bundleId;
    expect(() => validateModelCatalogManifest(manifest)).toThrow(/bundleId/);
  });

  it("accepts a manifest with an optional verificationModelId", () => {
    const result = validateModelCatalogManifest({ ...validManifest(), verificationModelId: "roma-verify" });
    expect(result.verificationModelId).toBe("roma-verify");
  });

  it("leaves verificationModelId undefined when the manifest omits it", () => {
    const result = validateModelCatalogManifest(validManifest());
    expect(result.verificationModelId).toBeUndefined();
  });

  it("rejects a non-string verificationModelId", () => {
    expect(() =>
      validateModelCatalogManifest({ ...validManifest(), verificationModelId: 42 })
    ).toThrow();
  });
});
