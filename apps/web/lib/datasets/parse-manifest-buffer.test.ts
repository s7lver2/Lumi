// apps/web/lib/datasets/parse-manifest-buffer.test.ts
import { describe, it, expect } from "vitest";
import { parseManifestBuffer } from "./parse-manifest-buffer";
import { serializeManifest } from "./export-bundle";

function makeImage(i: number, embeddingDim: number) {
  return {
    panoId: `pano-${i}`,
    heading: (i % 4) * 90,
    lat: 40 + i * 0.0001,
    lng: -3 - i * 0.0001,
    streetViewDate: "2026-01-01",
    embedding: Array.from({ length: embeddingDim }, (_, d) => (i + d) / 1000),
    hasFile: true,
  };
}

function makePoint(i: number, embeddingDim: number) {
  return {
    panoId: `pano-${i}`,
    lat: 40 + i * 0.0001,
    lng: -3 - i * 0.0001,
    embedding: Array.from({ length: embeddingDim }, (_, d) => (i + d) / 1000),
  };
}

describe("parseManifestBuffer", () => {
  it("matches JSON.parse for a small single-area manifest", () => {
    const payload = {
      version: 1,
      exportedAt: "2026-07-20T10:00:00.000Z",
      model: { id: "lumi-preview", version: "1.0", embeddingDim: 16 },
      areas: [
        {
          name: "Madrid",
          geometryWkt: "POLYGON((0 0,0 1,1 1,1 0,0 0))",
          areaKm2: 1,
          status: "indexed",
          pointsEstimated: 3,
          pointsCaptured: 3,
          pointsFailed: 0,
          imagesEmbedded: 3,
          estimatedCostUsd: 0.5,
          actualCostUsd: 0.4,
          images: [makeImage(0, 16), makeImage(1, 16), makeImage(2, 16)],
          points: [makePoint(0, 16), makePoint(1, 16)],
        },
      ],
    };

    const buf = serializeManifest(payload);
    const expected = JSON.parse(buf.toString("utf8"));
    const actual = parseManifestBuffer(buf);

    expect(actual).toEqual(expected);
  });

  it("matches JSON.parse when images/points are empty arrays", () => {
    const payload = {
      version: 1,
      exportedAt: "2026-07-20T10:00:00.000Z",
      model: { id: "lumi-preview", version: "1.0", embeddingDim: 16 },
      areas: [
        {
          name: null,
          geometryWkt: "POLYGON((0 0,0 1,1 1,1 0,0 0))",
          areaKm2: 1,
          status: "pending",
          pointsEstimated: 0,
          pointsCaptured: 0,
          pointsFailed: 0,
          imagesEmbedded: 0,
          estimatedCostUsd: null,
          actualCostUsd: null,
          images: [],
          points: [],
        },
      ],
    };

    const buf = serializeManifest(payload);
    const expected = JSON.parse(buf.toString("utf8"));
    const actual = parseManifestBuffer(buf);

    expect(actual).toEqual(expected);
  });

  it("matches JSON.parse across multiple areas", () => {
    const payload = {
      version: 1,
      exportedAt: "2026-07-20T10:00:00.000Z",
      model: { id: "lumi-preview", version: "1.0", embeddingDim: 8 },
      areas: [
        {
          name: "Area A", geometryWkt: "POLYGON((0 0,0 1,1 1,1 0,0 0))", areaKm2: 1, status: "indexed",
          pointsEstimated: 1, pointsCaptured: 1, pointsFailed: 0, imagesEmbedded: 1,
          estimatedCostUsd: 0, actualCostUsd: 0,
          images: [makeImage(0, 8)], points: [makePoint(0, 8)],
        },
        {
          name: "Area B", geometryWkt: "POLYGON((2 2,2 3,3 3,3 2,2 2))", areaKm2: 2, status: "indexed",
          pointsEstimated: 2, pointsCaptured: 2, pointsFailed: 0, imagesEmbedded: 2,
          estimatedCostUsd: 1, actualCostUsd: 1,
          images: [makeImage(1, 8), makeImage(2, 8)], points: [makePoint(1, 8)],
        },
      ],
    };

    const buf = serializeManifest(payload);
    const expected = JSON.parse(buf.toString("utf8"));
    const actual = parseManifestBuffer(buf);

    expect(actual).toEqual(expected);
  });

  it("handles a large manifest (thousands of embeddings) without throwing, matching a size where the whole-string approach previously crashed", () => {
    const embeddingDim = 8448;
    const count = 3000;
    const payload = {
      version: 1,
      exportedAt: "2026-07-20T10:00:00.000Z",
      model: { id: "lumi-preview", version: "1.0", embeddingDim },
      areas: [
        {
          name: "Big area", geometryWkt: "POLYGON((0 0,0 1,1 1,1 0,0 0))", areaKm2: 10, status: "indexed",
          pointsEstimated: count, pointsCaptured: count, pointsFailed: 0, imagesEmbedded: count,
          estimatedCostUsd: 5, actualCostUsd: 5,
          images: Array.from({ length: count }, (_, i) => makeImage(i, embeddingDim)),
          points: [],
        },
      ],
    };

    const buf = serializeManifest(payload);
    const actual = parseManifestBuffer(buf) as { areas: { images: unknown[] }[] };

    expect(actual.areas[0].images).toHaveLength(count);
    expect((actual.areas[0].images[0] as { panoId: string }).panoId).toBe("pano-0");
    expect((actual.areas[0].images[count - 1] as { panoId: string }).panoId).toBe(`pano-${count - 1}`);
  });
});
