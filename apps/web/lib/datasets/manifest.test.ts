// apps/web/lib/datasets/manifest.test.ts
import { describe, it, expect } from "vitest";
import { validateDatasetManifest, buildDatasetMetadata } from "./manifest";

const KNOWN_MODEL_IDS = new Set(["lumi-preview"]);

function validManifest() {
  return {
    version: 1,
    exportedAt: "2026-07-14T00:00:00.000Z",
    model: { id: "lumi-preview", version: "1.0", embeddingDim: 3 },
    areas: [
      {
        name: "Test area",
        geometryWkt: "POLYGON((0 0,0 1,1 1,1 0,0 0))",
        areaKm2: 1,
        status: "indexed",
        pointsEstimated: 1,
        pointsCaptured: 1,
        pointsFailed: 0,
        imagesEmbedded: 1,
        estimatedCostUsd: null,
        actualCostUsd: null,
        images: [
          {
            panoId: "abc123", heading: 0, lat: 0, lng: 0,
            streetViewDate: null, embedding: [0.1, 0.2, 0.3], hasFile: true,
          },
        ],
        points: [
          { panoId: "abc123", lat: 0, lng: 0, embedding: [0.1, 0.2, 0.3] },
        ],
      },
    ],
  };
}

describe("validateDatasetManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validateDatasetManifest(validManifest(), KNOWN_MODEL_IDS);
    expect(result.model).toEqual({ id: "lumi-preview", version: "1.0", embeddingDim: 3 });
    expect(result.areas).toHaveLength(1);
    expect(result.areas[0].images[0].panoId).toBe("abc123");
  });

  it("rejects an unknown model.id", () => {
    const manifest = validManifest();
    manifest.model.id = "some-other-model";
    expect(() => validateDatasetManifest(manifest, KNOWN_MODEL_IDS)).toThrow(/not a known model/);
  });

  it("rejects an image embedding whose length doesn't match model.embeddingDim", () => {
    const manifest = validManifest();
    manifest.areas[0].images[0].embedding = [0.1, 0.2]; // length 2, declared dim is 3
    expect(() => validateDatasetManifest(manifest, KNOWN_MODEL_IDS)).toThrow(/embedding has length/);
  });

  it("rejects a point embedding whose length doesn't match model.embeddingDim", () => {
    const manifest = validManifest();
    manifest.areas[0].points[0].embedding = [0.1];
    expect(() => validateDatasetManifest(manifest, KNOWN_MODEL_IDS)).toThrow(/embedding has length/);
  });

  it("rejects a panoId that isn't in the safe allowlist", () => {
    const manifest = validManifest();
    manifest.areas[0].images[0].panoId = "../../etc/passwd";
    expect(() => validateDatasetManifest(manifest, KNOWN_MODEL_IDS)).toThrow(/panoId/);
  });

  it("accepts a real Google pano_id ending in a single dot (confirmed live against a real published dataset)", () => {
    const manifest = validManifest();
    manifest.areas[0].images[0].panoId = "CAoSFkNJSE0wb2dLRUlDQWdJQ3N6SXI5QkE.";
    const result = validateDatasetManifest(manifest, KNOWN_MODEL_IDS);
    expect(result.areas[0].images[0].panoId).toBe("CAoSFkNJSE0wb2dLRUlDQWdJQ3N6SXI5QkE.");
  });

  it("still rejects a panoId with two consecutive dots", () => {
    const manifest = validManifest();
    manifest.areas[0].images[0].panoId = "foo..bar";
    expect(() => validateDatasetManifest(manifest, KNOWN_MODEL_IDS)).toThrow(/panoId/);
  });

  it("rejects a non-object top level", () => {
    expect(() => validateDatasetManifest(null, KNOWN_MODEL_IDS)).toThrow();
    expect(() => validateDatasetManifest("nope", KNOWN_MODEL_IDS)).toThrow();
  });

  it("rejects areas that isn't an array", () => {
    const manifest = validManifest() as unknown as Record<string, unknown>;
    manifest.areas = "not-an-array";
    expect(() => validateDatasetManifest(manifest, KNOWN_MODEL_IDS)).toThrow(/areas must be an array/);
  });
});

describe("buildDatasetMetadata", () => {
  it("assembles a metadata object from its parts", () => {
    const model = { id: "lumi-preview", version: "1.0", embeddingDim: 8448 };
    const meta = buildDatasetMetadata("Title", "Desc", model, { pointsCaptured: 10, imagesEmbedded: 40 });
    expect(meta).toEqual({
      title: "Title", description: "Desc", model,
      stats: { pointsCaptured: 10, imagesEmbedded: 40 },
    });
  });
});
