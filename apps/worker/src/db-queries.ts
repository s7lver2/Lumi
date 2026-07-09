// apps/worker/src/db-queries.ts
import type { Pool } from "pg";
import type { AreaRow } from "@netryx/shared-types";
import type { IndexedImageInsert } from "./jobs/index-area";
import type { IndexedPointInsert } from "./aggregate";


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
  points: IndexedPointInsert[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const p of points) {
      await client.query(
        `INSERT INTO indexed_points (area_id, pano_id, location, embedding)
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
  images: IndexedImageInsert[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const img of images) {
      await client.query(
        `INSERT INTO indexed_images (area_id, pano_id, heading, location, street_view_date, embedding, embedded_at)
         VALUES ($1, $2, $3, ST_GeogFromText($4), $5, $6, now())
         ON CONFLICT (pano_id, heading) DO NOTHING`,
        [
          areaId,
          img.panoId,
          img.heading,
          `POINT(${img.lng} ${img.lat})`,
          img.captureDate ? `${img.captureDate}-01` : null,
          `[${img.embedding.join(",")}]`,
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