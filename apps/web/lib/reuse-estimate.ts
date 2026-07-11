// apps/web/lib/reuse-estimate.ts
import type { Pool } from "pg";
import { polygonToWkt } from "./polygon-wkt";

/**
 * Counts indexed_images rows whose point already falls inside the given
 * polygon — an ESTIMATE of how many of this new area's images are already
 * paid for and stored from an earlier, overlapping area. Not an exact
 * pano_id/heading match (that's only known once each point's Street View
 * metadata call resolves at job-run time — see apps/worker/src/street-view.ts),
 * just "is there already indexed coverage here." Same ST_GeogFromText/
 * geography(Point,4326) pattern apps/worker/src/db-queries.ts's
 * insertIndexedImages already uses against the same column.
 */
export async function countReusableImages(
  pool: Pick<Pool, "query">,
  polygon: [number, number][]
): Promise<number> {
  const wkt = polygonToWkt(polygon);
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM indexed_images
     WHERE ST_Intersects(location, ST_GeogFromText($1))`,
    [wkt]
  );
  return Number(rows[0]?.count ?? "0");
}
