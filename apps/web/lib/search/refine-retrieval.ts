import type { Pool } from "pg";

export interface RegionCandidate {
  indexedImageId: string;
  panoId: string;
  heading: number;
  lat: number;
  lng: number;
  imagePath: string | null;
}

/**
 * The actual Pass-1 candidates already clustered into this region
 * (search_candidates.region_id — spec §9.3 step 3), NOT a fresh geographic
 * radius query. This used to re-query ST_DWithin(img.location, r.centroid,
 * r.radius_m) against the whole indexed_images table, which pulls in every
 * indexed image within the fixed clustering radius (150m by default)
 * regardless of whether it was ever a retrieved candidate — confirmed live:
 * a region with 72 actual candidates triggered a "verify 500 images" refine
 * because a dense area easily has hundreds of indexed images (street-view
 * points sampled every ~18m) within 150m of the centroid. Refining must only
 * re-verify the candidates the user is actually looking at.
 */
export async function expandRegionCandidates(
  pool: Pool,
  regionId: string
): Promise<RegionCandidate[]> {
  const { rows } = await pool.query(
    `SELECT img.id, img.pano_id, img.heading,
            ST_Y(img.location::geometry) AS lat,
            ST_X(img.location::geometry) AS lng,
            img.image_path
     FROM search_candidates sc
     JOIN indexed_images img ON img.id = sc.indexed_image_id
     WHERE sc.region_id = $1`,
    [regionId]
  );

  return rows.map((r) => ({
    indexedImageId: r.id,
    panoId: r.pano_id,
    heading: r.heading,
    lat: Number(r.lat),
    lng: Number(r.lng),
    imagePath: r.image_path,
  }));
}