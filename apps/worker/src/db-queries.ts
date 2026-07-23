// apps/worker/src/db-queries.ts
import type { Pool } from "pg";
import type { AreaRow } from "@netryx/shared-types";
import type { IndexedImageInsert } from "./jobs/index-area";
import type { IndexedPointInsert } from "./aggregate";

function embeddingColumn(retrievalModelId: string): "embedding" | "embedding_lumi2" {
  return retrievalModelId === "lumi-2" ? "embedding_lumi2" : "embedding";
}

/** Cooperative-cancellation check: has the web app flagged this area as cancelled? */
export async function isAreaCancelled(pool: Pool, areaId: string): Promise<boolean> {
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM areas WHERE id = $1`,
    [areaId]
  );
  return rows[0]?.status === "cancelled";
}

export async function getArea(pool: Pool, areaId: string): Promise<AreaRow> {
  const { rows } = await pool.query(
    `SELECT id, name, area_km2, status, points_estimated, points_captured,
            points_failed, images_embedded, estimated_cost_usd, actual_cost_usd
     FROM areas WHERE id = $1`,
    [areaId]
  );
  if (rows.length === 0) throw new Error(`Area ${areaId} not found`);
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    areaKm2: Number(r.area_km2),
    status: r.status,
    pointsEstimated: r.points_estimated,
    pointsCaptured: r.points_captured,
    pointsFailed: r.points_failed,
    imagesEmbedded: r.images_embedded,
    estimatedCostUsd: r.estimated_cost_usd === null ? null : Number(r.estimated_cost_usd),
    actualCostUsd: r.actual_cost_usd === null ? null : Number(r.actual_cost_usd),
  };
}

export async function insertIndexedPoints(
  pool: Pool,
  areaId: string,
  points: IndexedPointInsert[],
  retrievalModelId: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const p of points) {
      await client.query(
        `INSERT INTO indexed_points (area_id, pano_id, location, ${embeddingColumn(retrievalModelId)})
         VALUES ($1, $2, ST_GeogFromText($3), $4)
         ON CONFLICT (pano_id) DO NOTHING`,
        [areaId, p.panoId, `POINT(${p.lng} ${p.lat})`, `[${p.embedding.join(",")}]`]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getAreaPolygon(pool: Pool, areaId: string): Promise<[number, number][]> {
  const { rows } = await pool.query(
    `SELECT ST_AsGeoJSON(geometry) AS geojson FROM areas WHERE id = $1`,
    [areaId]
  );
  if (rows.length === 0) throw new Error(`Area ${areaId} not found`);
  const geojson = JSON.parse(rows[0].geojson) as { coordinates: [number, number][][] };
  return geojson.coordinates[0];
}

export async function insertIndexedImages(
  pool: Pool,
  areaId: string,
  images: IndexedImageInsert[],
  retrievalModelId: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const img of images) {
      await client.query(
        `INSERT INTO indexed_images (area_id, pano_id, heading, location, street_view_date, ${embeddingColumn(retrievalModelId)}, image_path, embedded_at)
         VALUES ($1, $2, $3, ST_GeogFromText($4), $5, $6, $7, now())
         ON CONFLICT (pano_id, heading) DO NOTHING`,
        [
          areaId,
          img.panoId,
          img.heading,
          `POINT(${img.lng} ${img.lat})`,
          img.captureDate ? `${img.captureDate}-01` : null,
          `[${img.embedding.join(",")}]`,
          img.imagePath,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface PendingEmbedImage {
  id: string;
  imagePath: string;
}

/** Rows that already have an image on disk but no embedding yet — the
 * state a dataset-catalog install leaves behind when the release's model
 * doesn't match what's locally active (spec's "Completing embeddings
 * after a mismatched install" section). Deliberately does NOT touch
 * loadExistingPanoHeadings' dedup set — this has nothing to do with
 * re-downloading. */
export async function getPendingEmbedImages(
  pool: Pool,
  areaId: string,
  retrievalModelId: string
): Promise<PendingEmbedImage[]> {
  const col = embeddingColumn(retrievalModelId);
  const { rows } = await pool.query<{ id: string; image_path: string }>(
    `SELECT id, image_path FROM indexed_images
     WHERE area_id = $1 AND ${col} IS NULL AND image_path IS NOT NULL`,
    [areaId]
  );
  return rows.map((r) => ({ id: r.id, imagePath: r.image_path }));
}

export async function updateImageEmbeddings(
  pool: Pool,
  updates: { id: string; embedding: number[] }[],
  retrievalModelId: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const update of updates) {
      await client.query(
        `UPDATE indexed_images SET ${embeddingColumn(retrievalModelId)} = $2, embedded_at = now() WHERE id = $1`,
        [update.id, `[${update.embedding.join(",")}]`]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}