// apps/web/lib/search/get-search-result.ts
import type { Pool } from "pg";
import type { SearchResponse, SearchRegion, SearchCandidate } from "@netryx/shared-types";

/**
 * Reads back an already-persisted search (spec: "GET /api/searches/
 * {searchId} + /results/{searchId}" section) — search_candidates doesn't
 * store panoId/heading/lat/lng itself (only indexed_image_id,
 * similarity_score, verification_score, rank, status; see persist.ts/
 * refine-persist.ts), so this JOINs against indexed_images to reconstruct
 * the full SearchCandidate shape. Returns null (not a thrown error) for an
 * unknown searchId — the caller (the route, and the results page) decides
 * how to surface that (404 / notFound()).
 */
export async function getSearchResult(pool: Pool, searchId: string): Promise<SearchResponse | null> {
  const { rows: searchRows } = await pool.query(`SELECT id FROM searches WHERE id = $1`, [searchId]);
  if (searchRows.length === 0) return null;

  const { rows: regionRows } = await pool.query(
    `SELECT id, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng,
            radius_m, aggregate_score, candidate_count
     FROM search_regions WHERE search_id = $1`,
    [searchId]
  );
  const regions: SearchRegion[] = regionRows.map((r) => ({
    id: r.id,
    centroid: { lat: Number(r.lat), lng: Number(r.lng) },
    radiusM: r.radius_m,
    aggregateScore: Number(r.aggregate_score),
    candidateCount: r.candidate_count,
  }));

  const { rows: candidateRows } = await pool.query(
    `SELECT sc.id, sc.region_id, sc.indexed_image_id, sc.similarity_score, sc.verification_score,
            sc.rank, sc.status, ii.pano_id, ii.heading,
            ST_Y(ii.location::geometry) AS lat, ST_X(ii.location::geometry) AS lng
     FROM search_candidates sc
     JOIN indexed_images ii ON ii.id = sc.indexed_image_id
     WHERE sc.search_id = $1
     ORDER BY sc.rank`,
    [searchId]
  );

  const candidatesByRegion: Record<string, SearchCandidate[]> = {};
  for (const r of candidateRows) {
    if (!r.region_id) continue;
    const candidate: SearchCandidate = {
      id: r.id,
      regionId: r.region_id,
      indexedImageId: r.indexed_image_id,
      panoId: r.pano_id,
      heading: r.heading,
      lat: Number(r.lat),
      lng: Number(r.lng),
      similarityScore: Number(r.similarity_score),
      verificationScore: r.verification_score === null ? null : Number(r.verification_score),
      rank: r.rank,
      status: r.status,
    };
    (candidatesByRegion[r.region_id] ??= []).push(candidate);
  }

  return { searchId, regions, candidatesByRegion, timeOfDay: null };
}
