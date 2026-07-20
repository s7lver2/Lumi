// apps/web/lib/datasets/export-bundle.ts
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import type { ModelTag } from "./manifest";

function parseVector(text: string | null): number[] | null {
  if (!text) return null;
  return text.slice(1, -1).split(",").map(Number);
}

interface ManifestArea {
  images: unknown[];
  points: unknown[];
  [key: string]: unknown;
}

/**
 * Serializes manifest.json without ever building the whole document as one
 * JS string. indexed_images.embedding is a fixed vector(8448) column, so
 * each image/point entry serializes to ~300KB of JSON; a single top-level
 * JSON.stringify() over an area with a few thousand images blows past V8's
 * ~512M-character string limit and crashes with "RangeError: Invalid string
 * length" (confirmed live — reproduces at ~2000 entries). Stringifying one
 * entry at a time keeps every individual JSON.stringify() call small, and
 * concatenating as Buffers (not strings) means the full manifest is never
 * materialized as a single string.
 */
export function serializeManifest(payload: {
  version: number;
  exportedAt: string;
  model: ModelTag;
  areas: ManifestArea[];
}): Buffer {
  const chunks: Buffer[] = [];
  const push = (s: string) => chunks.push(Buffer.from(s, "utf8"));
  const pushArray = (items: unknown[]) => {
    items.forEach((item, i) => {
      if (i > 0) push(",");
      push(JSON.stringify(item));
    });
  };

  push(
    `{"version":${JSON.stringify(payload.version)},` +
      `"exportedAt":${JSON.stringify(payload.exportedAt)},` +
      `"model":${JSON.stringify(payload.model)},"areas":[`
  );
  payload.areas.forEach((area, areaIdx) => {
    if (areaIdx > 0) push(",");
    const { images, points, ...rest } = area;
    // Drop the closing "}" so images/points can be appended field-by-field.
    push(`${JSON.stringify(rest).slice(0, -1)},"images":[`);
    pushArray(images);
    push(`],"points":[`);
    pushArray(points);
    push(`]}`);
  });
  push(`]}`);

  return Buffer.concat(chunks);
}

/**
 * Builds the encrypted-later, zippable bundle for one or more areas —
 * extracted from apps/web/app/api/areas/export/route.ts (spec: "reused as-
 * is, not reimplemented") so both the plain personal-backup export route
 * and the dataset-catalog publish route (Task 14) share one implementation.
 * `model` is stamped into manifest.json's top-level `model` field either
 * way, so a plain export also self-documents which model produced its
 * embeddings.
 */
export async function buildAreasZip(pool: Pool, areaIds: string[], model: ModelTag): Promise<Uint8Array> {
  const { rows: areaRows } = await pool.query(
    `SELECT id, name, ST_AsText(geometry) AS geometry_wkt, area_km2, status,
            points_estimated, points_captured, points_failed, images_embedded,
            estimated_cost_usd, actual_cost_usd
     FROM areas WHERE id = ANY($1)`,
    [areaIds]
  );
  if (areaRows.length === 0) {
    throw new Error("no matching areas");
  }

  const zip = new JSZip();
  const manifestAreas: unknown[] = [];

  for (const area of areaRows) {
    const { rows: images } = await pool.query(
      `SELECT pano_id, heading, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              street_view_date, embedding::text AS embedding_text, image_path
       FROM indexed_images WHERE area_id = $1`,
      [area.id]
    );
    const { rows: points } = await pool.query(
      `SELECT pano_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              embedding::text AS embedding_text
       FROM indexed_points WHERE area_id = $1`,
      [area.id]
    );

    const imageEntries = [];
    for (const img of images) {
      let hasFile = false;
      if (img.image_path) {
        try {
          const bytes = await readFile(img.image_path);
          zip.file(`images/${img.pano_id}_${img.heading}.jpg`, bytes);
          hasFile = true;
        } catch {
          // missing on disk — proceed without the file
        }
      }
      imageEntries.push({
        panoId: img.pano_id,
        heading: img.heading,
        lat: Number(img.lat),
        lng: Number(img.lng),
        streetViewDate: img.street_view_date,
        embedding: parseVector(img.embedding_text),
        hasFile,
      });
    }

    const pointEntries = points.map((p) => ({
      panoId: p.pano_id,
      lat: Number(p.lat),
      lng: Number(p.lng),
      embedding: parseVector(p.embedding_text),
    }));

    manifestAreas.push({
      name: area.name,
      geometryWkt: area.geometry_wkt,
      areaKm2: Number(area.area_km2),
      status: area.status,
      pointsEstimated: area.points_estimated,
      pointsCaptured: area.points_captured,
      pointsFailed: area.points_failed,
      imagesEmbedded: area.images_embedded,
      estimatedCostUsd: area.estimated_cost_usd,
      actualCostUsd: area.actual_cost_usd,
      images: imageEntries,
      points: pointEntries,
    });
  }

  zip.file(
    "manifest.json",
    serializeManifest({ version: 1, exportedAt: new Date().toISOString(), model, areas: manifestAreas as ManifestArea[] })
  );

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
