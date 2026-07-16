// apps/web/lib/model-catalog/manifest.test.ts
import { describe, it, expect } from "vitest";
import { validateModelCatalogManifest } from "./manifest";

function validManifest() {
  return {
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
});
