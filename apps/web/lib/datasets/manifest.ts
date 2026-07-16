// apps/web/lib/datasets/manifest.ts

/** Naming convention for release assets — used consistently by publish
 * (Task 14), discovery (Task 15) and install (Task 16). */
export const BUNDLE_ASSET_NAME = "bundle.zip.enc";
export const METADATA_ASSET_NAME = "metadata.json.enc";

const SAFE_PANO_ID = /^[A-Za-z0-9_-]+$/;

export interface ModelTag {
  id: string;
  version: string;
  embeddingDim: number;
}

export interface DatasetManifestImage {
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  streetViewDate: string | null;
  embedding: number[] | null;
  hasFile: boolean;
}

export interface DatasetManifestPoint {
  panoId: string;
  lat: number;
  lng: number;
  embedding: number[] | null;
}

export interface DatasetManifestArea {
  name: string | null;
  geometryWkt: string;
  areaKm2: number;
  status: string;
  pointsEstimated: number;
  pointsCaptured: number;
  pointsFailed: number;
  imagesEmbedded: number;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  images: DatasetManifestImage[];
  points: DatasetManifestPoint[];
}

export interface DatasetManifest {
  version: number;
  exportedAt: string;
  model: ModelTag;
  areas: DatasetManifestArea[];
}

export interface DatasetMetadata {
  title: string;
  description: string;
  model: ModelTag;
  stats: { pointsCaptured: number; imagesEmbedded: number };
}

export function buildDatasetMetadata(
  title: string,
  description: string,
  model: ModelTag,
  stats: { pointsCaptured: number; imagesEmbedded: number }
): DatasetMetadata {
  return { title, description, model, stats };
}

function validateImage(
  imgData: unknown,
  areaIndex: number,
  imgIndex: number,
  embeddingDim: number
): DatasetManifestImage {
  if (typeof imgData !== "object" || imgData === null) {
    throw new Error(`manifest.areas[${areaIndex}].images[${imgIndex}] must be an object`);
  }
  const img = imgData as Record<string, unknown>;
  if (typeof img.panoId !== "string" || !SAFE_PANO_ID.test(img.panoId)) {
    throw new Error(`manifest.areas[${areaIndex}].images[${imgIndex}].panoId is missing or invalid`);
  }
  if (typeof img.heading !== "number") {
    throw new Error(`manifest.areas[${areaIndex}].images[${imgIndex}].heading must be a number`);
  }
  if (img.embedding !== null && !Array.isArray(img.embedding)) {
    throw new Error(`manifest.areas[${areaIndex}].images[${imgIndex}].embedding must be an array or null`);
  }
  if (Array.isArray(img.embedding) && img.embedding.length !== embeddingDim) {
    throw new Error(
      `manifest.areas[${areaIndex}].images[${imgIndex}].embedding has length ${img.embedding.length}, expected ${embeddingDim}`
    );
  }
  return {
    panoId: img.panoId,
    heading: img.heading,
    lat: Number(img.lat),
    lng: Number(img.lng),
    streetViewDate: (img.streetViewDate as string | null) ?? null,
    embedding: (img.embedding as number[] | null) ?? null,
    hasFile: Boolean(img.hasFile),
  };
}

function validatePoint(
  ptData: unknown,
  areaIndex: number,
  ptIndex: number,
  embeddingDim: number
): DatasetManifestPoint {
  if (typeof ptData !== "object" || ptData === null) {
    throw new Error(`manifest.areas[${areaIndex}].points[${ptIndex}] must be an object`);
  }
  const pt = ptData as Record<string, unknown>;
  if (typeof pt.panoId !== "string" || !SAFE_PANO_ID.test(pt.panoId)) {
    throw new Error(`manifest.areas[${areaIndex}].points[${ptIndex}].panoId is missing or invalid`);
  }
  if (pt.embedding !== null && !Array.isArray(pt.embedding)) {
    throw new Error(`manifest.areas[${areaIndex}].points[${ptIndex}].embedding must be an array or null`);
  }
  if (Array.isArray(pt.embedding) && pt.embedding.length !== embeddingDim) {
    throw new Error(
      `manifest.areas[${areaIndex}].points[${ptIndex}].embedding has length ${pt.embedding.length}, expected ${embeddingDim}`
    );
  }
  return {
    panoId: pt.panoId,
    lat: Number(pt.lat),
    lng: Number(pt.lng),
    embedding: (pt.embedding as number[] | null) ?? null,
  };
}

function validateArea(areaData: unknown, areaIndex: number, embeddingDim: number): DatasetManifestArea {
  if (typeof areaData !== "object" || areaData === null) {
    throw new Error(`manifest.areas[${areaIndex}] must be an object`);
  }
  const area = areaData as Record<string, unknown>;
  if (typeof area.geometryWkt !== "string") {
    throw new Error(`manifest.areas[${areaIndex}].geometryWkt must be a string`);
  }
  if (!Array.isArray(area.images)) {
    throw new Error(`manifest.areas[${areaIndex}].images must be an array`);
  }
  if (!Array.isArray(area.points)) {
    throw new Error(`manifest.areas[${areaIndex}].points must be an array`);
  }

  return {
    name: (area.name as string | null) ?? null,
    geometryWkt: area.geometryWkt,
    areaKm2: Number(area.areaKm2),
    status: String(area.status ?? "indexed"),
    pointsEstimated: Number(area.pointsEstimated ?? 0),
    pointsCaptured: Number(area.pointsCaptured ?? 0),
    pointsFailed: Number(area.pointsFailed ?? 0),
    imagesEmbedded: Number(area.imagesEmbedded ?? 0),
    estimatedCostUsd: area.estimatedCostUsd === undefined || area.estimatedCostUsd === null ? null : Number(area.estimatedCostUsd),
    actualCostUsd: area.actualCostUsd === undefined || area.actualCostUsd === null ? null : Number(area.actualCostUsd),
    images: area.images.map((img, i) => validateImage(img, areaIndex, i, embeddingDim)),
    points: area.points.map((pt, i) => validatePoint(pt, areaIndex, i, embeddingDim)),
  };
}

/**
 * Strictly validates a decrypted dataset bundle's manifest.json (spec's
 * Security section — replaces the original export/import routes' loose
 * `as ManifestArea[]` cast). Throws a descriptive Error on any violation;
 * never returns a partially-valid result.
 */
export function validateDatasetManifest(data: unknown, knownModelIds: ReadonlySet<string>): DatasetManifest {
  if (typeof data !== "object" || data === null) {
    throw new Error("manifest must be an object");
  }
  const raw = data as Record<string, unknown>;

  if (typeof raw.version !== "number") throw new Error("manifest.version must be a number");
  if (typeof raw.exportedAt !== "string") throw new Error("manifest.exportedAt must be a string");

  if (typeof raw.model !== "object" || raw.model === null) {
    throw new Error("manifest.model must be an object");
  }
  const model = raw.model as Record<string, unknown>;
  if (typeof model.id !== "string" || !knownModelIds.has(model.id)) {
    throw new Error(`manifest.model.id ${JSON.stringify(model.id)} is not a known model`);
  }
  if (typeof model.version !== "string" || model.version.length === 0) {
    throw new Error("manifest.model.version must be a non-empty string");
  }
  if (typeof model.embeddingDim !== "number" || !Number.isInteger(model.embeddingDim) || model.embeddingDim <= 0) {
    throw new Error("manifest.model.embeddingDim must be a positive integer");
  }
  const modelTag: ModelTag = { id: model.id, version: model.version, embeddingDim: model.embeddingDim };

  if (!Array.isArray(raw.areas)) throw new Error("manifest.areas must be an array");

  return {
    version: raw.version,
    exportedAt: raw.exportedAt,
    model: modelTag,
    areas: raw.areas.map((area, i) => validateArea(area, i, modelTag.embeddingDim)),
  };
}
