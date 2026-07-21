// apps/web/lib/search/persist.ts
import type { Pool } from "pg";
import type { SearchResponse, SearchRegion, SearchCandidate } from "@netryx/shared-types";
import type { RetrievedCandidate } from "./retrieval";
import type { ClusteredRegion } from "./cluster";

export interface PersistSearchArgs {
  queryImagePath: string;
  queryEmbedding: number[];
  candidates: RetrievedCandidate[]; // already re-ranked, best-first
  regions: ClusteredRegion[];
  /** Not persisted to the DB — passed straight through into the returned
   * SearchResponse (spec: docs/superpowers/specs/2026-07-21-results-
   * layout-and-time-of-day-design.md). */
  timeOfDay?: { label: string; score: number } | null;
}

/**
 * Writes searches/search_regions/search_candidates in one transaction and
 * returns the assembled Pass 1 response. Rank is the global re-ranked order
 * (1-based). verification_score/status stay at Pass-1 defaults (spec §9.2).
 */
export async function persistSearch(
  pool: Pool,
  args: PersistSearchArgs
): Promise<SearchResponse> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const search = await client.query(
      `INSERT INTO searches (query_image_path, query_embedding)
       VALUES ($1, $2) RETURNING id`,
      [args.queryImagePath, `[${args.queryEmbedding.join(",")}]`]
    );
    const searchId = search.rows[0].id as string;

    // Insert regions, remembering which memberIds each DB region id owns.
    const regionOut: SearchRegion[] = [];
    const regionIdByMember = new Map<string, string>();
    for (const r of args.regions) {
      const inserted = await client.query(
        `INSERT INTO search_regions (search_id, centroid, radius_m, aggregate_score, candidate_count)
         VALUES ($1, ST_GeogFromText($2), $3, $4, $5) RETURNING id`,
        [searchId, `POINT(${r.centroid.lng} ${r.centroid.lat})`, r.radiusM, r.aggregateScore, r.memberIds.length]
      );
      const regionId = inserted.rows[0].id as string;
      regionOut.push({
        id: regionId,
        centroid: r.centroid,
        radiusM: r.radiusM,
        aggregateScore: r.aggregateScore,
        candidateCount: r.memberIds.length,
      });
      for (const m of r.memberIds) regionIdByMember.set(m, regionId);
    }

    const candidatesByRegion: Record<string, SearchCandidate[]> = {};
    for (let i = 0; i < args.candidates.length; i++) {
      const c = args.candidates[i];
      const regionId = regionIdByMember.get(c.indexedImageId) ?? null;
      const rank = i + 1;
      const inserted = await client.query(
        `INSERT INTO search_candidates
           (search_id, region_id, indexed_image_id, similarity_score, rank, status)
         VALUES ($1, $2, $3, $4, $5, 'unreviewed') RETURNING id`,
        [searchId, regionId, c.indexedImageId, c.similarity, rank]
      );
      const candidate: SearchCandidate = {
        id: inserted.rows[0].id,
        regionId,
        indexedImageId: c.indexedImageId,
        panoId: c.panoId,
        heading: c.heading,
        lat: c.lat,
        lng: c.lng,
        similarityScore: c.similarity,
        verificationScore: null,
        rank,
        status: "unreviewed",
      };
      if (regionId) {
        (candidatesByRegion[regionId] ??= []).push(candidate);
      }
    }

    await client.query("COMMIT");
    return { searchId, regions: regionOut, candidatesByRegion, timeOfDay: args.timeOfDay ?? null };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}