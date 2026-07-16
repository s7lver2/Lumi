// apps/web/lib/model-catalog/manifest.ts

export const BUNDLE_CODE_ASSET_NAME = "code.zip.enc";
export const MODEL_CATALOG_METADATA_ASSET_NAME = "metadata.json.enc";

export interface BackboneReference {
  name: string;
  source: string;
}

export interface ModelCatalogBenchmark {
  accuracyWithin50m: number;
  avgDistanceM: number;
  sampleCount: number;
  ranAt: string;
}

export interface ModelCatalogManifest {
  bundleId: string;
  version: string;
  backbones: BackboneReference[];
  benchmark: ModelCatalogBenchmark;
  description: string;
}

/**
 * Strictly validates a decrypted model-catalog manifest — same discipline
 * as the dataset catalog's own manifest validator (spec's Architecture
 * section): reject malformed/missing fields outright, never return a
 * partially-valid result.
 */
export function validateModelCatalogManifest(data: unknown): ModelCatalogManifest {
  if (typeof data !== "object" || data === null) {
    throw new Error("manifest must be an object");
  }
  const raw = data as Record<string, unknown>;

  if (typeof raw.bundleId !== "string" || raw.bundleId.length === 0) {
    throw new Error("manifest.bundleId must be a non-empty string");
  }
  if (typeof raw.version !== "string" || raw.version.length === 0) {
    throw new Error("manifest.version must be a non-empty string");
  }
  if (!Array.isArray(raw.backbones)) {
    throw new Error("manifest.backbones must be an array");
  }
  const backbones: BackboneReference[] = raw.backbones.map((b, i) => {
    if (typeof b !== "object" || b === null) throw new Error(`manifest.backbones[${i}] must be an object`);
    const entry = b as Record<string, unknown>;
    if (typeof entry.name !== "string" || typeof entry.source !== "string") {
      throw new Error(`manifest.backbones[${i}] must have string name/source`);
    }
    return { name: entry.name, source: entry.source };
  });

  if (typeof raw.benchmark !== "object" || raw.benchmark === null) {
    throw new Error("manifest.benchmark is required");
  }
  const benchmarkRaw = raw.benchmark as Record<string, unknown>;
  if (
    typeof benchmarkRaw.accuracyWithin50m !== "number" ||
    typeof benchmarkRaw.avgDistanceM !== "number" ||
    typeof benchmarkRaw.sampleCount !== "number" ||
    typeof benchmarkRaw.ranAt !== "string"
  ) {
    throw new Error("manifest.benchmark has missing or wrongly-typed fields");
  }

  return {
    bundleId: raw.bundleId,
    version: raw.version,
    backbones,
    benchmark: {
      accuracyWithin50m: benchmarkRaw.accuracyWithin50m,
      avgDistanceM: benchmarkRaw.avgDistanceM,
      sampleCount: benchmarkRaw.sampleCount,
      ranAt: benchmarkRaw.ranAt,
    },
    description: typeof raw.description === "string" ? raw.description : "",
  };
}
