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

export interface GenericClassifierBenchmark {
  sampleCount: number;
  ranAt: string;
  vramEstimateBytes: number | null;
}

export interface ClassifierFacet {
  facet: string;
  hfModelId: string;
  strategy: "pipeline" | "clip-zero-shot";
  // Required when strategy is "clip-zero-shot", absent for "pipeline" —
  // validated below, not enforced by the type system alone.
  prompts?: string[];
}

export interface CodeBundleManifest {
  kind: "code-bundle";
  bundleId: string;
  version: string;
  backbones: BackboneReference[];
  benchmark: ModelCatalogBenchmark;
  description: string;
  // The verification model id this release provides/activates, if any —
  // undefined means this release doesn't touch verification (e.g. a
  // retrieval-only update). Written by publish/route.ts from the
  // currently-active VERIFICATION_MODEL setting; consumed by
  // install/route.ts to activate it after a successful install.
  verificationModelId?: string;
}

export interface GenericClassifierManifest {
  kind: "generic-classifier";
  modelId: string;
  version: string;
  facets: ClassifierFacet[];
  benchmark: GenericClassifierBenchmark;
  description: string;
}

/**
 * Discriminated union on `kind` (spec: docs/superpowers/specs/2026-07-20-
 * unified-model-catalog-design.md) — code-bundle releases (Lumi Preview,
 * swap+restart) and generic-classifier releases (Velle/Wanda, metadata-
 * only, no restart) share one catalog UI but have entirely different
 * manifest shapes and benchmark semantics.
 */
export type ModelCatalogManifest = CodeBundleManifest | GenericClassifierManifest;

function validateBackbones(raw: unknown): BackboneReference[] {
  if (!Array.isArray(raw)) {
    throw new Error("manifest.backbones must be an array");
  }
  return raw.map((b, i) => {
    if (typeof b !== "object" || b === null) throw new Error(`manifest.backbones[${i}] must be an object`);
    const entry = b as Record<string, unknown>;
    if (typeof entry.name !== "string" || typeof entry.source !== "string") {
      throw new Error(`manifest.backbones[${i}] must have string name/source`);
    }
    return { name: entry.name, source: entry.source };
  });
}

function validateCodeBundleManifest(raw: Record<string, unknown>): CodeBundleManifest {
  if (typeof raw.bundleId !== "string" || raw.bundleId.length === 0) {
    throw new Error("manifest.bundleId must be a non-empty string");
  }
  if (typeof raw.version !== "string" || raw.version.length === 0) {
    throw new Error("manifest.version must be a non-empty string");
  }
  const backbones = validateBackbones(raw.backbones);

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

  if (raw.verificationModelId !== undefined && typeof raw.verificationModelId !== "string") {
    throw new Error("manifest.verificationModelId must be a string when present");
  }

  return {
    kind: "code-bundle",
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
    verificationModelId: typeof raw.verificationModelId === "string" ? raw.verificationModelId : undefined,
  };
}

function validateFacets(raw: unknown): ClassifierFacet[] {
  if (!Array.isArray(raw)) {
    throw new Error("manifest.facets must be an array");
  }
  return raw.map((f, i) => {
    if (typeof f !== "object" || f === null) throw new Error(`manifest.facets[${i}] must be an object`);
    const entry = f as Record<string, unknown>;
    if (typeof entry.facet !== "string" || entry.facet.length === 0) {
      throw new Error(`manifest.facets[${i}].facet must be a non-empty string`);
    }
    if (typeof entry.hfModelId !== "string" || entry.hfModelId.length === 0) {
      throw new Error(`manifest.facets[${i}].hfModelId must be a non-empty string`);
    }
    if (entry.strategy !== "pipeline" && entry.strategy !== "clip-zero-shot") {
      throw new Error(`manifest.facets[${i}].strategy must be "pipeline" or "clip-zero-shot"`);
    }
    if (entry.strategy === "clip-zero-shot") {
      if (!Array.isArray(entry.prompts) || entry.prompts.length === 0 || !entry.prompts.every((p) => typeof p === "string")) {
        throw new Error(`manifest.facets[${i}].prompts is required (non-empty string array) for a clip-zero-shot facet`);
      }
    }
    return {
      facet: entry.facet,
      hfModelId: entry.hfModelId,
      strategy: entry.strategy,
      prompts: entry.strategy === "clip-zero-shot" ? (entry.prompts as string[]) : undefined,
    };
  });
}

function validateGenericClassifierManifest(raw: Record<string, unknown>): GenericClassifierManifest {
  if (typeof raw.modelId !== "string" || raw.modelId.length === 0) {
    throw new Error("manifest.modelId must be a non-empty string");
  }
  if (typeof raw.version !== "string" || raw.version.length === 0) {
    throw new Error("manifest.version must be a non-empty string");
  }
  const facets = validateFacets(raw.facets);

  if (typeof raw.benchmark !== "object" || raw.benchmark === null) {
    throw new Error("manifest.benchmark is required");
  }
  const benchmarkRaw = raw.benchmark as Record<string, unknown>;
  if (typeof benchmarkRaw.sampleCount !== "number" || typeof benchmarkRaw.ranAt !== "string") {
    throw new Error("manifest.benchmark has missing or wrongly-typed fields");
  }
  if (benchmarkRaw.vramEstimateBytes !== null && typeof benchmarkRaw.vramEstimateBytes !== "number") {
    throw new Error("manifest.benchmark.vramEstimateBytes must be a number or null");
  }

  return {
    kind: "generic-classifier",
    modelId: raw.modelId,
    version: raw.version,
    facets,
    benchmark: {
      sampleCount: benchmarkRaw.sampleCount,
      ranAt: benchmarkRaw.ranAt,
      vramEstimateBytes: (benchmarkRaw.vramEstimateBytes as number | null) ?? null,
    },
    description: typeof raw.description === "string" ? raw.description : "",
  };
}

/**
 * Strictly validates a decrypted model-catalog manifest, dispatching on
 * `kind` — same discipline as the dataset catalog's own manifest validator:
 * reject malformed/missing fields outright, never return a partially-valid
 * result.
 */
export function validateModelCatalogManifest(data: unknown): ModelCatalogManifest {
  if (typeof data !== "object" || data === null) {
    throw new Error("manifest must be an object");
  }
  const raw = data as Record<string, unknown>;

  if (raw.kind === "code-bundle") return validateCodeBundleManifest(raw);
  if (raw.kind === "generic-classifier") return validateGenericClassifierManifest(raw);
  throw new Error(`manifest.kind must be "code-bundle" or "generic-classifier", got: ${JSON.stringify(raw.kind)}`);
}