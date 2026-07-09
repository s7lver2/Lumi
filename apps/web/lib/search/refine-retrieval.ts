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
 * All indexed images within a region's radius of its centroid (spec §9.3 step 3),
 * using PostGIS ST_DWithin on the geography column (metres).
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
     FROM search_regions r
     JOIN indexed_images img
       ON ST_DWithin(img.location, r.centroid, r.radius_m)
     WHERE r.id = $1`,
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